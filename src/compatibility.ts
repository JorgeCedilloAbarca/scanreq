import { PackageInfo } from './pypi';

export interface ConflictDetail {
	packageName: string;         // paquete del requirements.txt que genera el conflicto
	requiredBy: string;          // dependencia que impone el requisito
	requiredSpec: string;        // e.g. "requests>=2.28.0"
	installedVersion: string;    // versión que tiene el usuario
	recommendation: string;      // qué debería hacer
}

export interface CompatibilityReport {
	conflicts: ConflictDetail[];
	safeUpdates: SafeUpdate[];
	pipUnavailable: boolean;
}

export interface SafeUpdate {
	packageName: string;
	currentVersion: string;
	recommendedVersion: string;
	reason: string;
}

interface PyPIPackageData {
	info: {
		version: string;
		requires_dist: string[] | null;
		requires_python: string | null;
	};
	releases: Record<string, unknown[]>;
}

// Cache para evitar re-consultar PyPI el mismo paquete dos veces en el mismo scan
const pypiCache = new Map<string, PyPIPackageData | null>();

async function fetchPyPIData(packageName: string): Promise<PyPIPackageData | null> {
	const key = packageName.toLowerCase();
	if (pypiCache.has(key)) {
		return pypiCache.get(key)!;
	}
	try {
		const response = await fetch(`https://pypi.org/pypi/${key}/json`);
		if (!response.ok) {
			pypiCache.set(key, null);
			return null;
		}
		const data = await response.json() as PyPIPackageData;
		pypiCache.set(key, data);
		return data;
	} catch {
		pypiCache.set(key, null);
		return null;
	}
}

// Parsea un specifier como ">=2.28.0,<3.0" en lista de condiciones
function parseSpecifiers(spec: string): Array<{ op: string; version: string }> {
	return spec.split(',').map(s => {
		const s2 = s.trim();
		const match = s2.match(/^(>=|<=|!=|~=|==|>|<)\s*(.+)$/);
		if (!match) { return null; }
		return { op: match[1], version: match[2].trim() };
	}).filter(Boolean) as Array<{ op: string; version: string }>;
}

function versionToTuple(v: string): number[] {
	return v.replace(/[^\d.]/g, '').split('.').map(n => parseInt(n) || 0);
}

function compareVersions(a: string, b: string): number {
	const ta = versionToTuple(a);
	const tb = versionToTuple(b);
	const len = Math.max(ta.length, tb.length);
	for (let i = 0; i < len; i++) {
		const diff = (ta[i] ?? 0) - (tb[i] ?? 0);
		if (diff !== 0) { return diff; }
	}
	return 0;
}

function satisfiesSpecifier(version: string, op: string, specVersion: string): boolean {
	const cmp = compareVersions(version, specVersion);
	switch (op) {
		case '>=': return cmp >= 0;
		case '<=': return cmp <= 0;
		case '>':  return cmp > 0;
		case '<':  return cmp < 0;
		case '==': return cmp === 0;
		case '!=': return cmp !== 0;
		case '~=': {
			// Compatible release: >= specVersion, == en major.minor
			const parts = versionToTuple(specVersion);
			const floor = parts.slice(0, -1).join('.');
			return cmp >= 0 && version.startsWith(floor + '.');
		}
		default: return true;
	}
}

function versionSatisfiesAllSpecs(version: string, specs: Array<{ op: string; version: string }>): boolean {
	return specs.every(s => satisfiesSpecifier(version, s.op, s.version));
}

// Dada una lista de versiones disponibles, encuentra la más reciente estable que cumple los specs
function findBestVersion(available: string[], specs: Array<{ op: string; version: string }>): string | null {
	const stable = available.filter(v => !v.includes('a') && !v.includes('b') && !v.includes('rc') && !v.includes('dev'));
	const candidates = stable.filter(v => versionSatisfiesAllSpecs(v, specs));
	if (candidates.length === 0) { return null; }
	return candidates.sort((a, b) => compareVersions(b, a))[0];
}

export async function runCompatibilityAnalysis(
	packages: PackageInfo[],
	pipUnavailable: boolean
): Promise<CompatibilityReport> {
	pypiCache.clear();

	const conflicts: ConflictDetail[] = [];
	const safeUpdates: SafeUpdate[] = [];

	// Mapa de nombre -> versión instalada para cruce rápido
	const installedMap = new Map<string, string>();
	for (const pkg of packages) {
		const cleanName = pkg.name.replace(/\[.*?\]/g, '').trim().toLowerCase();
		installedMap.set(cleanName, pkg.installedVersion);
	}

	// Para cada paquete, obtener sus dependencias de PyPI y cruzar con lo instalado
	const analysisPromises = packages.map(async (pkg) => {
		const cleanName = pkg.name.replace(/\[.*?\]/g, '').trim().toLowerCase();
		const data = await fetchPyPIData(cleanName);
		if (!data) { return; }

		const requiresDist = data.info.requires_dist ?? [];

		for (const depSpec of requiresDist) {
			// Formato típico: "requests (>=2.26.0)" o "requests>=2.26.0" o "requests (>=2.0) ; extra == 'security'"
			// Ignoramos extras condicionales para simplificar
			if (depSpec.includes('; extra ==') || depSpec.includes(';extra==')) {
				continue;
			}

			// Parsear nombre y specs del depSpec
			const depMatch = depSpec.match(/^([A-Za-z0-9]([A-Za-z0-9._-]*)?)\s*(?:\(([^)]+)\))?(.*)$/);
			if (!depMatch) { continue; }

			const depName = depMatch[1].toLowerCase().replace(/-/g, '_');
			const specString = (depMatch[3] ?? depMatch[4] ?? '').trim();
			if (!specString) { continue; }

			// ¿Tenemos este paquete en requirements.txt?
			const normalizedDepName = depName.replace(/-/g, '_');
			let installedVersion: string | undefined;
			for (const [key, val] of installedMap.entries()) {
				if (key.replace(/-/g, '_') === normalizedDepName) {
					installedVersion = val;
					break;
				}
			}

			if (!installedVersion || installedVersion === 'desconocida' || installedVersion === 'unknown') {
				continue;
			}

			const specs = parseSpecifiers(specString);
			if (specs.length === 0) { continue; }

			const satisfied = versionSatisfiesAllSpecs(installedVersion, specs);
			if (!satisfied) {
				// Buscar versión recomendada
				const depData = await fetchPyPIData(normalizedDepName);
				const availableVersions = depData ? Object.keys(depData.releases) : [];
				const bestVersion = findBestVersion(availableVersions, specs);

				conflicts.push({
					packageName: normalizedDepName,
					requiredBy: pkg.name,
					requiredSpec: `${normalizedDepName}${specString}`,
					installedVersion,
					recommendation: bestVersion
						? `Actualiza ${normalizedDepName} a ${bestVersion}`
						: `Actualiza ${normalizedDepName} para cumplir ${specString}`
				});
			}
		}

		// Safe updates: si el paquete está desactualizado y sin conflictos conocidos
		if (!pkg.upToDate && pkg.exactVersion) {
			const availableVersions = Object.keys(data.releases);
			// La versión latest ya la tenemos en latestVersion
			safeUpdates.push({
				packageName: pkg.name,
				currentVersion: pkg.installedVersion,
				recommendedVersion: pkg.latestVersion,
				reason: pkg.vulnerabilities.length > 0
					? `Tiene ${pkg.vulnerabilities.length} CVE(s) conocido(s)`
					: 'Versión más reciente disponible'
			});
		}
	});

	await Promise.all(analysisPromises);

	// Deduplicar conflictos por par (packageName, requiredBy)
	const seen = new Set<string>();
	const dedupedConflicts = conflicts.filter(c => {
		const key = `${c.packageName}|${c.requiredBy}`;
		if (seen.has(key)) { return false; }
		seen.add(key);
		return true;
	});

	return {
		conflicts: dedupedConflicts,
		safeUpdates,
		pipUnavailable
	};
}
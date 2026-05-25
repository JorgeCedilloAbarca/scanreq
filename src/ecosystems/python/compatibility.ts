import { PackageResult, CompatibilityReport, ConflictDetail, SafeUpdate, calcMigrationRisk } from '../types';
import { getLocale } from '../../i18n';
import { compareVersions, buildAllSafeUpdates } from '../shared';

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

function findBestVersion(available: string[], specs: Array<{ op: string; version: string }>): string | null {
	const stable = available.filter(v => !v.includes('a') && !v.includes('b') && !v.includes('rc') && !v.includes('dev'));
	const candidates = stable.filter(v => versionSatisfiesAllSpecs(v, specs));
	if (candidates.length === 0) { return null; }
	return candidates.sort((a, b) => compareVersions(b, a))[0];
}

export async function runCompatibilityAnalysis(
	packages: PackageResult[],
	toolUnavailable: boolean
): Promise<CompatibilityReport> {
	pypiCache.clear();
	const locale = getLocale();

	const conflicts: ConflictDetail[] = [];

	const installedMap = new Map<string, string>();
	for (const pkg of packages) {
		const cleanName = pkg.name.replace(/\[.*?\]/g, '').trim().toLowerCase();
		installedMap.set(cleanName, pkg.installedVersion);
	}

	const analysisPromises = packages.map(async (pkg) => {
		const cleanName = pkg.name.replace(/\[.*?\]/g, '').trim().toLowerCase();
		const data = await fetchPyPIData(cleanName);
		if (!data) { return; }

		const requiresDist = data.info.requires_dist ?? [];

		for (const depSpec of requiresDist) {
			if (depSpec.includes('; extra ==') || depSpec.includes(';extra==')) {
				continue;
			}

			const depMatch = depSpec.match(/^([A-Za-z0-9]([A-Za-z0-9._-]*)?)\\s*(?:\\(([^)]+)\\))?(.*)$/);
			if (!depMatch) { continue; }

			const depName = depMatch[1].toLowerCase().replace(/-/g, '_');
			const specString = (depMatch[3] ?? depMatch[4] ?? '').trim();
			if (!specString) { continue; }

			const normalizedDepName = depName.replace(/-/g, '_');
			let installedVersion: string | undefined;
			for (const [key, val] of installedMap.entries()) {
				if (key.replace(/-/g, '_') === normalizedDepName) {
					installedVersion = val;
					break;
				}
			}

			if (!installedVersion || installedVersion === 'unknown') {
				continue;
			}

			const specs = parseSpecifiers(specString);
			if (specs.length === 0) { continue; }

			const satisfied = versionSatisfiesAllSpecs(installedVersion, specs);
			if (!satisfied) {
				const depData = await fetchPyPIData(normalizedDepName);
				const availableVersions = depData ? Object.keys(depData.releases) : [];
				const bestVersion = findBestVersion(availableVersions, specs);

				conflicts.push({
					packageName: normalizedDepName,
					requiredBy: pkg.name,
					requiredSpec: `${normalizedDepName}${specString}`,
					installedVersion,
					recommendation: bestVersion
						? locale === 'es'
							? `Actualiza ${normalizedDepName} a ${bestVersion}`
							: `Update ${normalizedDepName} to ${bestVersion}`
						: locale === 'es'
							? `Actualiza ${normalizedDepName} para cumplir ${specString}`
							: `Update ${normalizedDepName} to satisfy ${specString}`
				});
			}
		}
	});

	await Promise.all(analysisPromises);

	// Fix D1: safeUpdates generados por función compartida
	const safeUpdates = buildAllSafeUpdates(packages, locale);

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
		toolUnavailable
	};
}

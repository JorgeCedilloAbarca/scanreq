import { PackageResult, CompatibilityReport, ConflictDetail, SafeUpdate, calcMigrationRisk } from '../types';
import { getLocale } from '../../i18n';

interface PackagistRelease {
	version: string;
	require?: Record<string, string>;
}

interface PackagistData {
	packages: Record<string, PackagistRelease[]>;
}

// Cache para evitar re-consultar Packagist el mismo paquete dos veces en el mismo scan
const packagistCache = new Map<string, PackagistRelease | null>();

async function fetchPackagistLatest(name: string): Promise<PackagistRelease | null> {
	const key = name.toLowerCase();
	if (packagistCache.has(key)) {
		return packagistCache.get(key)!;
	}

	try {
		const response = await fetch(
			`https://repo.packagist.org/p2/${key}.json`,
			{ headers: { 'User-Agent': 'ScanReq-VSCode-Extension/2.3 (https://scanreq.com)' } }
		);
		if (!response.ok) {
			packagistCache.set(key, null);
			return null;
		}
		const data = await response.json() as PackagistData;
		const releases = data?.packages?.[key];
		if (!Array.isArray(releases) || releases.length === 0) {
			packagistCache.set(key, null);
			return null;
		}
		// El primer release estable
		const latest = findLatestStable(releases);
		packagistCache.set(key, latest);
		return latest;
	} catch {
		packagistCache.set(key, null);
		return null;
	}
}

function findLatestStable(releases: PackagistRelease[]): PackagistRelease | null {
	for (const release of releases) {
		const v = release?.version ?? '';
		if (!v) { continue; }
		if (v.startsWith('dev-') || v.endsWith('-dev')) { continue; }
		const lower = v.toLowerCase();
		if (lower.includes('alpha') || lower.includes('beta') || lower.includes('-rc')) { continue; }
		return release;
	}
	return null;
}

// ─── Comparación de versiones ─────────────────────────────────────────────────

function versionToTuple(v: string): number[] {
	return v.replace(/[^0-9.]/g, '').split('.').map(n => parseInt(n) || 0);
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

/**
 * Comprueba si una versión instalada satisface un specifier Composer.
 * Soporta: ^, ~, >=, <=, >, <, =, exacto, *, OR con ||
 *
 * Composer usa semántica diferente de npm para ^ y ~ cuando el major es 0:
 * ^0.3.0 → >=0.3.0 <0.4.0 (no <1.0.0 como en npm)
 * Para simplificar usamos la regla general: ^ = compatible major, ~ = compatible minor.
 */
function satisfiesComposerSpec(installed: string, spec: string): boolean {
	const s = spec.trim();
	if (s === '*' || s === '') { return true; }

	// OR: "^1.0|^2.0"
	if (s.includes('||') || s.includes(' | ')) {
		const parts = s.split(/\|\||\s\|\s/).map(p => p.trim());
		return parts.some(p => satisfiesComposerSpec(installed, p));
	}

	// AND: ">=1.0.0 <2.0.0"
	const andParts = s.split(/\s+/).filter(Boolean);
	if (andParts.length > 1) {
		return andParts.every(p => satisfiesComposerSpec(installed, p));
	}

	// Wildcard: "1.2.*"
	if (s.includes('*')) {
		const prefix = s.replace('*', '').replace(/\.$/, '');
		const normalizedInstalled = installed.startsWith('v') ? installed.slice(1) : installed;
		return normalizedInstalled.startsWith(prefix);
	}

	// Caret: ^1.2.3
	if (s.startsWith('^')) {
		const specVer = s.slice(1);
		const cmp = compareVersions(installed, specVer);
		if (cmp < 0) { return false; }
		const instMajor = parseInt(installed.split('.')[0], 10) || 0;
		const specMajor = parseInt(specVer.split('.')[0], 10) || 0;
		return instMajor === specMajor;
	}

	// Tilde: ~1.2.3
	if (s.startsWith('~')) {
		const specVer = s.slice(1);
		const cmp = compareVersions(installed, specVer);
		if (cmp < 0) { return false; }
		const instParts  = installed.split('.');
		const specParts  = specVer.split('.');
		return instParts[0] === specParts[0] && instParts[1] === specParts[1];
	}

	// Operadores: >=, <=, !=, >, <, =
	const match = s.match(/^(>=|<=|!=|>|<|={1,2})\s*v?(.+)$/);
	if (match) {
		const op = match[1];
		const specVer = match[2];
		const cmp = compareVersions(installed, specVer);
		switch (op) {
			case '>=':  return cmp >= 0;
			case '<=':  return cmp <= 0;
			case '>':   return cmp > 0;
			case '<':   return cmp < 0;
			case '!=':  return cmp !== 0;
			case '=':
			case '==':  return cmp === 0;
		}
	}

	// Exacto (solo dígitos y puntos, opcionalmente con v)
	const exactMatch = s.match(/^v?(\d[\d.]*)$/);
	if (exactMatch) {
		return compareVersions(installed, exactMatch[1]) === 0;
	}

	return true;
}

// ─── Análisis principal ───────────────────────────────────────────────────────

export async function runCompatibilityAnalysis(
	packages: PackageResult[],
	_toolUnavailable: boolean
): Promise<CompatibilityReport> {
	packagistCache.clear();
	const locale = getLocale();

	const conflicts: ConflictDetail[] = [];
	const safeUpdates: SafeUpdate[] = [];

	// Mapa nombre normalizado → versión instalada
	const installedMap = new Map<string, string>();
	for (const pkg of packages) {
		installedMap.set(pkg.name.toLowerCase(), pkg.installedVersion);
	}

	const analysisPromises = packages.map(async (pkg) => {
		const release = await fetchPackagistLatest(pkg.name);
		if (!release) { return; }

		const require = release.require ?? {};

		for (const [depRaw, spec] of Object.entries(require)) {
			const depName = depRaw.toLowerCase();

			// Ignorar PHP runtime y extensiones
			if (depName === 'php' || depName.startsWith('ext-') || depName.startsWith('lib-')) { continue; }

			const installedVersion = installedMap.get(depName);
			if (!installedVersion || installedVersion === 'unknown') { continue; }

			const satisfied = satisfiesComposerSpec(installedVersion, spec);
			if (!satisfied) {
				conflicts.push({
					packageName: depName,
					requiredBy: pkg.name,
					requiredSpec: `${depName} ${spec}`,
					installedVersion,
					recommendation: locale === 'es'
						? `Actualiza ${depName} para cumplir ${spec} requerido por ${pkg.name}`
						: `Update ${depName} to satisfy ${spec} required by ${pkg.name}`,
				});
			}
		}

		// safeUpdates
		if (!pkg.upToDate && pkg.installedVersion !== 'unknown' && pkg.latestVersion !== 'Not found') {
			safeUpdates.push({
				packageName: pkg.name,
				currentVersion: pkg.exactVersion ? pkg.installedVersion : `∼${pkg.installedVersion}`,
				recommendedVersion: pkg.latestVersion,
				reason: pkg.vulnerabilities.length > 0
					? locale === 'es'
						? `Tiene ${pkg.vulnerabilities.length} CVE(s) conocido(s)`
						: `Has ${pkg.vulnerabilities.length} known CVE(s)`
					: locale === 'es'
						? 'Versión más reciente disponible'
						: 'Newer version available',
					migrationRisk: calcMigrationRisk(pkg.majorVersionJump, pkg.vulnerabilities.length > 0),
				});
						} else if (pkg.upToDate && pkg.vulnerabilities.length > 0) {
			// Paquete al día según el registry pero con CVEs activos.
			// Si OSV reporta fixedVersion, sugerirla directamente.
			const fixedVersions = pkg.vulnerabilities
				.map(v => v.fixedVersion)
				.filter((v): v is string => !!v);

			if (fixedVersions.length > 0) {
				// Tomar la versión más alta entre todos los fixes reportados por OSV
				fixedVersions.sort((a, b) => {
					const pa = a.split(/[.\-]/).map(p => parseInt(p, 10) || 0);
					const pb = b.split(/[.\-]/).map(p => parseInt(p, 10) || 0);
					const len = Math.max(pa.length, pb.length);
					for (let i = 0; i < len; i++) {
						const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
						if (diff !== 0) { return diff; }
					}
					return 0;
				});
				safeUpdates.push({
					packageName: pkg.name,
					currentVersion: pkg.installedVersion,
					recommendedVersion: fixedVersions[0],
					reason: locale === 'es'
						? `Versión parcheada disponible — corrige ${pkg.vulnerabilities.length} CVE(s)`
						: `Patched version available — fixes ${pkg.vulnerabilities.length} CVE(s)`,
					migrationRisk: 'medium',
				});
			} else {
				safeUpdates.push({
					packageName: pkg.name,
					currentVersion: pkg.installedVersion,
					recommendedVersion: pkg.installedVersion,
					reason: locale === 'es'
						? `Sin parche conocido — evalúa mitigar o reemplazar`
						: `No known patch — consider mitigating or replacing`,
					migrationRisk: 'unpatched',
				});
			}
				}
		});

	await Promise.all(analysisPromises);

	// Deduplicar conflictos
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
		toolUnavailable: false,
	};
}

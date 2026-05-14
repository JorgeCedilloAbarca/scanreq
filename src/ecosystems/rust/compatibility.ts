import { PackageResult, CompatibilityReport, ConflictDetail, SafeUpdate, calcMigrationRisk } from '../types';
import { getLocale } from '../../i18n';

const CRATES_USER_AGENT = 'scanreq-vscode/2.2 (https://scanreq.com)';

interface CrateDependency {
	crate_id: string;
	req: string;           // especificador de versión, e.g. "^1.0", ">=0.8, <2.0"
	kind: 'normal' | 'dev' | 'build';
	optional: boolean;
}

// Cache para dependencias de versiones específicas
const crateDepCache = new Map<string, CrateDependency[] | null>();

async function fetchCrateDependencies(
	crateName: string,
	version: string
): Promise<CrateDependency[] | null> {
	const key = `${crateName}@${version}`;
	if (crateDepCache.has(key)) {
		return crateDepCache.get(key)!;
	}
	try {
		const response = await fetch(
			`https://crates.io/api/v1/crates/${encodeURIComponent(crateName)}/${encodeURIComponent(version)}/dependencies`,
			{ headers: { 'User-Agent': CRATES_USER_AGENT, 'Accept': 'application/json' } }
		);
		if (!response.ok) {
			crateDepCache.set(key, null);
			return null;
		}
		const data = await response.json() as any;
		const deps = (data.dependencies ?? []) as CrateDependency[];
		crateDepCache.set(key, deps);
		return deps;
	} catch {
		crateDepCache.set(key, null);
		return null;
	}
}

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

function satisfiesCargoSpec(installed: string, spec: string): boolean {
	if (spec === '*' || spec === '') { return true; }

	// Cargo soporta múltiples requisitos separados por coma: ">=1.0, <2.0"
	const parts = spec.split(',').map(s => s.trim());

	return parts.every(part => {
		const match = part.match(/^(\^|~|>=|<=|>|<|=)?\s*(\d[\d.]*)$/);
		if (!match) { return true; }
		const op = match[1] ?? '^';
		const specVersion = match[2];
		const cmp = compareVersions(installed, specVersion);

		switch (op) {
			case '>=': return cmp >= 0;
			case '<=': return cmp <= 0;
			case '>':  return cmp > 0;
			case '<':  return cmp < 0;
			case '=':  return cmp === 0;
			case '^': {
				const instT = versionToTuple(installed);
				const specT = versionToTuple(specVersion);
				// ^1.2.3 → >=1.2.3 <2.0.0
				// ^0.2.3 → >=0.2.3 <0.3.0
				// ^0.0.3 → >=0.0.3 <0.0.4
				if (specT[0] > 0) { return instT[0] === specT[0] && cmp >= 0; }
				if (specT[1] > 0) { return instT[0] === 0 && instT[1] === specT[1] && cmp >= 0; }
				return instT[0] === 0 && instT[1] === 0 && instT[2] === specT[2] && cmp >= 0;
			}
			case '~': {
				// ~1.2.3 → >=1.2.3 <1.3.0
				const instT = versionToTuple(installed);
				const specT = versionToTuple(specVersion);
				return instT[0] === specT[0] && instT[1] === specT[1] && cmp >= 0;
			}
			default: return true;
		}
	});
}

export async function runCompatibilityAnalysis(
	packages: PackageResult[],
	toolUnavailable: boolean
): Promise<CompatibilityReport> {
	crateDepCache.clear();
	const locale = getLocale();

	const conflicts: ConflictDetail[] = [];
	const safeUpdates: SafeUpdate[] = [];

	const installedMap = new Map<string, string>();
	for (const pkg of packages) {
		installedMap.set(pkg.name.toLowerCase().replace(/-/g, '_'), pkg.installedVersion);
	}

	// Limitamos la concurrencia — crates.io tiene rate limiting
	const CONCURRENCY = 5;
	for (let i = 0; i < packages.length; i += CONCURRENCY) {
		const batch = packages.slice(i, i + CONCURRENCY);
		await Promise.all(batch.map(async (pkg) => {
			if (pkg.installedVersion === 'unknown') { return; }

			const deps = await fetchCrateDependencies(pkg.name, pkg.installedVersion);
			if (!deps) { return; }

			// Solo dependencias normales (no dev, no build) para conflictos
			const normalDeps = deps.filter(d => d.kind === 'normal' && !d.optional);

			for (const dep of normalDeps) {
				const depKey = dep.crate_id.toLowerCase().replace(/-/g, '_');
				const installedVersion = installedMap.get(depKey);
				if (!installedVersion || installedVersion === 'unknown') { continue; }

				const satisfied = satisfiesCargoSpec(installedVersion, dep.req);
				if (!satisfied) {
					conflicts.push({
						packageName: dep.crate_id,
						requiredBy: pkg.name,
						requiredSpec: `${dep.crate_id} ${dep.req}`,
						installedVersion,
						recommendation: locale === 'es'
							? `Actualiza ${dep.crate_id} para cumplir ${dep.req} requerido por ${pkg.name}`
							: `Update ${dep.crate_id} to satisfy ${dep.req} required by ${pkg.name}`
					});
				}
			}

			// safeUpdates
			if (!pkg.upToDate && pkg.installedVersion !== 'unknown' && pkg.latestVersion !== 'Not found') {
				safeUpdates.push({
					packageName: pkg.name,
					currentVersion: pkg.installedVersion,
					recommendedVersion: pkg.latestVersion,
					reason: pkg.vulnerabilities.length > 0
						? locale === 'es'
							? `Tiene ${pkg.vulnerabilities.length} CVE(s) conocido(s)`
							: `Has ${pkg.vulnerabilities.length} known CVE(s)`
						: locale === 'es'
							? 'Versión más reciente disponible'
							: 'Newer version available',
						migrationRisk: calcMigrationRisk(pkg.majorVersionJump, pkg.vulnerabilities.length > 0)
					});
				} else if (pkg.upToDate && pkg.vulnerabilities.length > 0) {
					const fixedVersions = pkg.vulnerabilities
						.map(v => v.fixedVersion)
						.filter((v): v is string => !!v);

					if (fixedVersions.length > 0) {
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
							currentVersion: pkg.exactVersion ? pkg.installedVersion : `∼${pkg.installedVersion}`,
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
		}));
	}

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
		toolUnavailable
	};
}

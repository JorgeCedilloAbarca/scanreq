import { PackageResult, CompatibilityReport, ConflictDetail, SafeUpdate, calcMigrationRisk } from '../types';
import { getLocale } from '../../i18n';
import { compareVersions, versionToTuple, buildAllSafeUpdates } from '../shared';

const CRATES_USER_AGENT = 'scanreq-vscode/2.6 (https://scanreq.com)';

interface CrateDependency {
	crate_id: string;
	req: string;
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

function satisfiesCargoSpec(installed: string, spec: string): boolean {
	if (spec === '*' || spec === '') { return true; }

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
				if (specT[0] > 0) { return instT[0] === specT[0] && cmp >= 0; }
				if (specT[1] > 0) { return instT[0] === 0 && instT[1] === specT[1] && cmp >= 0; }
				return instT[0] === 0 && instT[1] === 0 && instT[2] === specT[2] && cmp >= 0;
			}
			case '~': {
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
		}));
	}

	// Fix D1: safeUpdates generados por función compartida
	const safeUpdates = buildAllSafeUpdates(packages, locale);

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

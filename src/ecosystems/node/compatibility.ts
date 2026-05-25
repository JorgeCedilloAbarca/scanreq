import { PackageResult, CompatibilityReport, ConflictDetail, SafeUpdate, calcMigrationRisk } from '../types';
import { getLocale } from '../../i18n';
import { compareVersions, buildAllSafeUpdates } from '../shared';

interface NpmPackageData {
	version: string;
	peerDependencies?: Record<string, string>;
	dependencies?: Record<string, string>;
}

// Cache para evitar re-consultar npm el mismo paquete dos veces en el mismo scan
const npmCache = new Map<string, NpmPackageData | null>();

async function fetchNpmData(packageName: string): Promise<NpmPackageData | null> {
	const key = packageName.toLowerCase();
	if (npmCache.has(key)) {
		return npmCache.get(key)!;
	}
	try {
		const response = await fetch(
			`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
			{ headers: { 'User-Agent': 'scanreq-vscode/2.6' } }
		);
		if (!response.ok) {
			npmCache.set(key, null);
			return null;
		}
		const data = await response.json() as NpmPackageData;
		npmCache.set(key, data);
		return data;
	} catch {
		npmCache.set(key, null);
		return null;
	}
}

function parseSemverRange(spec: string): { op: string; version: string } | null {
	const s = spec.trim();
	const match = s.match(/^(\^|~|>=|<=|>|<|=)?\s*(\d[\d.]*)$/);
	if (!match) { return null; }
	return { op: match[1] ?? '=', version: match[2] };
}

function versionToTuple(v: string): number[] {
	return v.split('.').map(n => parseInt(n) || 0);
}

function satisfiesSemver(installed: string, op: string, specVersion: string): boolean {
	const cmp = compareVersions(installed, specVersion);
	switch (op) {
		case '>=': return cmp >= 0;
		case '<=': return cmp <= 0;
		case '>':  return cmp > 0;
		case '<':  return cmp < 0;
		case '=':
		case '==': return cmp === 0;
		case '^': {
			const instTuple = versionToTuple(installed);
			const specTuple = versionToTuple(specVersion);
			if (instTuple[0] !== specTuple[0]) { return false; }
			return cmp >= 0;
		}
		case '~': {
			const instTuple = versionToTuple(installed);
			const specTuple = versionToTuple(specVersion);
			if (instTuple[0] !== specTuple[0]) { return false; }
			if (instTuple[1] !== specTuple[1]) { return false; }
			return cmp >= 0;
		}
		default: return true;
	}
}

/**
 * Normaliza un spec de peerDependency separando los términos AND correctamente.
 * Reagrupa tokens consecutivos que son (operador, versión) en un único string.
 */
function normalizeAndParts(part: string): string[] {
	const tokens = part.trim().split(/\s+/);
	const normalized: string[] = [];

	let i = 0;
	while (i < tokens.length) {
		const token = tokens[i];
		const opOnly = /^(>=|<=|!=|>|<|=)$/.test(token);
		if (opOnly && i + 1 < tokens.length && /^\d/.test(tokens[i + 1])) {
			normalized.push(token + tokens[i + 1]);
			i += 2;
		} else {
			normalized.push(token);
			i++;
		}
	}

	return normalized;
}

function checkSatisfied(installedVersion: string, spec: string): boolean {
	if (spec === '*' || spec === '') { return true; }

	const orParts = spec.split('||').map(s => s.trim());
	return orParts.some(part => {
		const andParts = normalizeAndParts(part);
		return andParts.every(p => {
			const parsed = parseSemverRange(p);
			if (!parsed) { return true; }
			return satisfiesSemver(installedVersion, parsed.op, parsed.version);
		});
	});
}

export async function runCompatibilityAnalysis(
	packages: PackageResult[],
	toolUnavailable: boolean
): Promise<CompatibilityReport> {
	npmCache.clear();
	const locale = getLocale();

	const conflicts: ConflictDetail[] = [];

	// Mapa de nombre normalizado → versión instalada
	const installedMap = new Map<string, string>();
	for (const pkg of packages) {
		installedMap.set(pkg.name.toLowerCase(), pkg.installedVersion);
	}

	const analysisPromises = packages.map(async (pkg) => {
		const data = await fetchNpmData(pkg.name);
		if (!data) { return; }

		// Analizar peerDependencies — conflictos más comunes en npm
		const peerDeps = data.peerDependencies ?? {};
		for (const [depName, spec] of Object.entries(peerDeps)) {
			const installedVersion = installedMap.get(depName.toLowerCase());
			if (!installedVersion || installedVersion === 'unknown') { continue; }

			const satisfied = checkSatisfied(installedVersion, spec);
			if (!satisfied) {
				conflicts.push({
					packageName: depName,
					requiredBy: pkg.name,
					requiredSpec: `${depName}@${spec}`,
					installedVersion,
					recommendation: locale === 'es'
						? `Actualiza ${depName} para cumplir ${spec} requerido por ${pkg.name}`
						: `Update ${depName} to satisfy ${spec} required by ${pkg.name}`
				});
			}
		}
	});

	await Promise.all(analysisPromises);

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

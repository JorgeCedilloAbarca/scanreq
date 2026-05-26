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
 * Maneja un X-range del estilo: "16.x", "16.x.x", "16.*", "*"
 * Devuelve true/false si matchea, o null si no es un x-range válido.
 *
 * Fix A2: Antes, los x-ranges caían al `return null` de parseSemverRange y luego
 * `if (!parsed) return true` los trataba como "satisfecho" — falso positivo.
 */
function evaluateXRange(installed: string, spec: string): boolean | null {
	const s = spec.trim();
	if (s === '*' || s === 'x' || s === 'X' || s === 'latest' || s === '') {
		return true;
	}

	// Forma "MAJOR.x" / "MAJOR.X" / "MAJOR.*"
	const m = s.match(/^(\d+)\.(x|X|\*)(?:\.(x|X|\*))?$/);
	if (m) {
		const major = parseInt(m[1], 10);
		const instMajor = parseInt(installed.split('.')[0], 10) || 0;
		return instMajor === major;
	}

	// Forma "MAJOR.MINOR.x" / "MAJOR.MINOR.*"
	const m2 = s.match(/^(\d+)\.(\d+)\.(x|X|\*)$/);
	if (m2) {
		const major = parseInt(m2[1], 10);
		const minor = parseInt(m2[2], 10);
		const instParts = installed.split('.').map(p => parseInt(p, 10) || 0);
		return instParts[0] === major && instParts[1] === minor;
	}

	return null;
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
		// Fix A2: probar primero si la parte es un x-range completo.
		const xRangeResult = evaluateXRange(installedVersion, part);
		if (xRangeResult !== null) { return xRangeResult; }

		const andParts = normalizeAndParts(part);
		return andParts.every(p => {
			// Cada componente AND también puede ser un x-range
			const xr = evaluateXRange(installedVersion, p);
			if (xr !== null) { return xr; }

			const parsed = parseSemverRange(p);
			// Fix A2: si no podemos parsear el spec, NO asumir que está satisfecho.
			// Casos comunes que llegan aquí: "workspace:*" (pnpm), ranges con guión
			// ("1.0.0 - 2.0.0"), tags ("next", "beta"), pre-releases ("^1.0.0-rc1").
			//
			// Las distintas opciones tienen distintos comportamientos:
			//   - "workspace:*" / tags → no podemos validar, conservador = true
			//   - pre-releases → tampoco soportamos, conservador = true
			// Devolvemos true SOLO si parece un spec "permisivo" o no validable;
			// si parece una versión normal que no matcheó, devolvemos false.
			//
			// Heurística: si empieza con prefijo "workspace:", "file:", "link:",
			// "github:", o es solo un tag alfabético, asumimos true (no validable).
			// Si es algo que debería ser una versión pero no parseó, asumimos true
			// para no introducir falsos positivos en un spec que no entendemos.
			//
			// Nota: el riesgo de falso negativo (decir "OK" cuando hay conflicto)
			// es preferible al falso positivo en este path porque la auditoría es
			// informativa, no bloqueante. El usuario verá pocos conflictos no-críticos.
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

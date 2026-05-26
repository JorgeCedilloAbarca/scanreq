import { PackageResult, SafeUpdate, calcMigrationRisk } from './types';

// ─── Comparación de versiones compartida ─────────────────────────────────────
// Estaba duplicada en 8+ archivos de compatibility. Una sola implementación.

/**
 * Convierte una versión a tupla de números para comparación.
 * Elimina sufijos no numéricos. Usado por satisfiesSpecifier de Python (~=)
 * y otros casos donde solo importa la parte numérica.
 */
export function versionToTuple(v: string): number[] {
	return v.replace(/[^0-9.]/g, '').split('.').map(n => parseInt(n) || 0);
}

/**
 * Compara dos versiones siguiendo semántica semver simplificada.
 * Devuelve <0 si a<b, 0 si iguales, >0 si a>b.
 *
 * Fix A1: La implementación anterior usaba `replace(/[^0-9.]/g, '')` que borraba
 * todos los caracteres no numéricos, convirtiendo:
 *   "1.0.0-rc1"  → "1.0.01"  → [1,0,0,1]  ← incorrectamente MAYOR que [1,0,0]
 *   "1.0.0-alpha" → "1.0.0"   → [1,0,0]    ← incorrectamente IGUAL a 1.0.0
 *
 * Esto causaba que un fix "2.0.0-rc1" se recomendara sobre "2.0.0" final,
 * y que pre-releases se considerasen equivalentes a la versión final.
 *
 * Nueva implementación: separa core (X.Y.Z) de pre-release (rc1, alpha, beta...).
 * Reglas semver:
 * - Si los cores son distintos, comparar cores numéricamente
 * - Si los cores son iguales y ambos tienen pre-release, comparar lexicográficamente
 * - Si los cores son iguales y solo uno tiene pre-release, ese es MENOR
 * - Si los cores son iguales y ninguno tiene pre-release, son iguales
 */
export function compareVersions(a: string, b: string): number {
	const { core: coreA, pre: preA } = splitVersion(a);
	const { core: coreB, pre: preB } = splitVersion(b);

	// Comparar core numéricamente
	const len = Math.max(coreA.length, coreB.length);
	for (let i = 0; i < len; i++) {
		const diff = (coreA[i] ?? 0) - (coreB[i] ?? 0);
		if (diff !== 0) { return diff; }
	}

	// Cores iguales — la presencia de pre-release indica menor precedencia
	if (preA === '' && preB === '') { return 0; }
	if (preA === '' && preB !== '') { return  1; }  // a (final) > b (pre)
	if (preA !== '' && preB === '') { return -1; }  // a (pre) < b (final)

	// Ambos tienen pre-release — comparación por componentes
	return comparePreRelease(preA, preB);
}

/**
 * Separa una versión en sus componentes core (X.Y.Z...) y pre-release.
 * Ejemplos:
 *   "1.2.3"           → { core: [1,2,3],   pre: "" }
 *   "1.2.3-rc1"       → { core: [1,2,3],   pre: "rc1" }
 *   "1.2.3-alpha.2"   → { core: [1,2,3],   pre: "alpha.2" }
 *   "v1.0.0"          → { core: [1,0,0],   pre: "" }
 *   "1.0.0+build.5"   → { core: [1,0,0],   pre: "" }   (build metadata se ignora)
 */
function splitVersion(v: string): { core: number[]; pre: string } {
	// Eliminar prefijo "v"
	let s = v.startsWith('v') || v.startsWith('V') ? v.slice(1) : v;

	// Eliminar build metadata (lo que sigue al "+")
	const plusIdx = s.indexOf('+');
	if (plusIdx !== -1) { s = s.slice(0, plusIdx); }

	// Separar pre-release (lo que sigue al primer "-")
	const dashIdx = s.indexOf('-');
	let coreStr: string;
	let pre = '';
	if (dashIdx !== -1) {
		coreStr = s.slice(0, dashIdx);
		pre = s.slice(dashIdx + 1);
	} else {
		coreStr = s;
	}

	const core = coreStr.split('.').map(p => parseInt(p, 10) || 0);
	return { core, pre };
}

/**
 * Compara dos strings de pre-release semánticamente.
 * Reglas: componentes numéricos < no numéricos, comparación natural por componente.
 */
function comparePreRelease(a: string, b: string): number {
	const partsA = a.split('.');
	const partsB = b.split('.');
	const len = Math.max(partsA.length, partsB.length);

	for (let i = 0; i < len; i++) {
		const pa = partsA[i];
		const pb = partsB[i];
		// Si falta uno, el que tiene más componentes es mayor (1.0.0-alpha < 1.0.0-alpha.1)
		if (pa === undefined) { return -1; }
		if (pb === undefined) { return  1; }

		const numA = /^\d+$/.test(pa) ? parseInt(pa, 10) : NaN;
		const numB = /^\d+$/.test(pb) ? parseInt(pb, 10) : NaN;
		const aIsNum = !isNaN(numA);
		const bIsNum = !isNaN(numB);

		if (aIsNum && bIsNum) {
			if (numA !== numB) { return numA - numB; }
		} else if (aIsNum) {
			return -1; // numérico < no numérico
		} else if (bIsNum) {
			return  1;
		} else {
			const cmp = pa.localeCompare(pb);
			if (cmp !== 0) { return cmp; }
		}
	}
	return 0;
}

// ─── Generación de safeUpdates compartida ────────────────────────────────────
// La lógica de generar safeUpdates para paquetes desactualizados y para paquetes
// al día con CVEs activos estaba copiada textualmente en 6 archivos de compatibility
// (python, node, rust, go, php, ruby). Cualquier bug tenía que corregirse 6 veces.

/**
 * Genera safeUpdates para un paquete individual.
 * Cubre dos casos:
 * 1. Paquete desactualizado → recomendar latestVersion
 * 2. Paquete al día pero con CVEs → recomendar fixedVersion de OSV o marcar unpatched
 *
 * Devuelve null si el paquete no necesita safeUpdate.
 */
export function buildSafeUpdate(pkg: PackageResult, locale: string): SafeUpdate | null {
	// Caso 1: paquete desactualizado
	if (!pkg.upToDate && pkg.installedVersion !== 'unknown' && pkg.latestVersion !== 'Not found') {
		return {
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
		};
	}

	// Caso 2: paquete al día pero con CVEs activos
	if (pkg.upToDate && pkg.vulnerabilities.length > 0) {
		const fixedVersions = pkg.vulnerabilities
			.map(v => v.fixedVersion)
			.filter((v): v is string => !!v);

		if (fixedVersions.length > 0) {
			// Tomar la versión más alta entre todos los fixes reportados por OSV.
			// Con el fix A1, compareVersions ahora trata correctamente RCs como menores
			// que la final, así que un "2.0.0" siempre se preferirá a "2.0.0-rc1".
			fixedVersions.sort((a, b) => compareVersions(b, a));
			return {
				packageName: pkg.name,
				currentVersion: pkg.installedVersion,
				recommendedVersion: fixedVersions[0],
				reason: locale === 'es'
					? `Versión parcheada disponible — corrige ${pkg.vulnerabilities.length} CVE(s)`
					: `Patched version available — fixes ${pkg.vulnerabilities.length} CVE(s)`,
				migrationRisk: 'medium',
			};
		} else {
			return {
				packageName: pkg.name,
				currentVersion: pkg.installedVersion,
				recommendedVersion: pkg.installedVersion,
				reason: locale === 'es'
					? `Sin parche conocido — evalúa mitigar o reemplazar`
					: `No known patch — consider mitigating or replacing`,
				migrationRisk: 'unpatched',
			};
		}
	}

	return null;
}

/**
 * Genera safeUpdates para un array completo de paquetes.
 * Wrapper conveniente sobre buildSafeUpdate.
 */
export function buildAllSafeUpdates(packages: PackageResult[], locale: string): SafeUpdate[] {
	const updates: SafeUpdate[] = [];
	for (const pkg of packages) {
		const update = buildSafeUpdate(pkg, locale);
		if (update) { updates.push(update); }
	}
	return updates;
}

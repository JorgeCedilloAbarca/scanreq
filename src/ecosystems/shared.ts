import { PackageResult, SafeUpdate, calcMigrationRisk } from './types';

// ─── Comparación de versiones compartida (fix D2) ────────────────────────────
// Estaba duplicada en 8+ archivos de compatibility. Una sola implementación.

export function versionToTuple(v: string): number[] {
	return v.replace(/[^0-9.]/g, '').split('.').map(n => parseInt(n) || 0);
}

export function compareVersions(a: string, b: string): number {
	const ta = versionToTuple(a);
	const tb = versionToTuple(b);
	const len = Math.max(ta.length, tb.length);
	for (let i = 0; i < len; i++) {
		const diff = (ta[i] ?? 0) - (tb[i] ?? 0);
		if (diff !== 0) { return diff; }
	}
	return 0;
}

// ─── Generación de safeUpdates compartida (fix D1) ───────────────────────────
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
			// Tomar la versión más alta entre todos los fixes reportados por OSV
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

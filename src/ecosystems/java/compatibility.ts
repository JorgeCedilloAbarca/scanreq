import { PackageResult, CompatibilityReport, SafeUpdate, calcMigrationRisk } from '../types';
import { getLocale } from '../../i18n';

/**
 * Análisis de compatibilidad para Java/Maven.
 *
 * Los conflictos de dependencias en Maven requieren resolver el grafo completo
 * de dependencias transitivas, lo que necesita ejecutar `mvn dependency:tree`
 * localmente o descargar y parsear los POMs transitivos desde Maven Central.
 * Esto se implementará en una versión futura cuando detectemos Maven en PATH.
 *
 * Lo que hacemos ahora:
 * - safeUpdates para paquetes desactualizados (siempre disponible)
 * - conflicts: [] — pendiente implementación con mvn dependency:tree
 */
export async function runCompatibilityAnalysis(
	packages: PackageResult[],
	_toolUnavailable: boolean
): Promise<CompatibilityReport> {
	const locale = getLocale();
	const safeUpdates: SafeUpdate[] = [];

	for (const pkg of packages) {
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
				migrationRisk: calcMigrationRisk(pkg.majorVersionJump, pkg.vulnerabilities.length > 0),
			});
		}
	}

	return {
		conflicts: [],   // Requiere `mvn dependency:tree` — pendiente
		safeUpdates,
		toolUnavailable: false,
	};
}

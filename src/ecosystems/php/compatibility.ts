import { PackageResult, CompatibilityReport, SafeUpdate, calcMigrationRisk } from '../types';
import { getLocale } from '../../i18n';

/**
 * Análisis de compatibilidad para PHP (Composer).
 *
 * Lo que sí podemos hacer sin herramientas locales:
 * - Generar safeUpdates para paquetes desactualizados
 * - Detectar conflictos de require/require-dev si la Packagist API expone "require"
 *   (no implementado aquí — se añadirá cuando tengamos los datos del grafo de deps)
 *
 * Composer tiene un mecanismo de resolución SAT — los conflictos reales requieren
 * ejecutar `composer why-not` localmente. Sin esa herramienta, reportamos safeUpdates
 * y dejamos conflicts vacío (igual que Go en v2.2).
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
		conflicts: [],   // Requiere `composer why-not` local — pendiente
		safeUpdates,
		toolUnavailable: false,
	};
}

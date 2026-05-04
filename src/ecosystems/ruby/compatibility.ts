import { PackageResult, CompatibilityReport, SafeUpdate, calcMigrationRisk } from '../types';
import { getLocale } from '../../i18n';

/**
 * Análisis de compatibilidad para Ruby (Bundler).
 *
 * Los conflictos de gems requieren ejecutar `bundle exec` localmente
 * (Bundler usa un solver SAT propio). Sin esa herramienta, reportamos
 * safeUpdates y dejamos conflicts vacío.
 *
 * En una versión futura se puede añadir detección de Ruby/Bundler en PATH.
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
		conflicts: [],   // Requiere `bundle exec` local — pendiente
		safeUpdates,
		toolUnavailable: false,
	};
}

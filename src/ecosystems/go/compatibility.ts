import { PackageResult, CompatibilityReport, SafeUpdate, calcMigrationRisk } from '../types';
import { getLocale } from '../../i18n';

/**
 * Análisis de compatibilidad para Go.
 *
 * Go tiene un modelo de dependencias diferente al resto:
 * - go.mod siempre contiene versiones exactas (no hay rangos)
 * - Los conflictos de dependencias transitivas se resuelven via MVS (Minimum Version Selection)
 *   que requiere ejecutar `go mod graph` con Go instalado localmente
 * - El proxy público no expone el grafo de dependencias de forma que permita resolverlo sin Go
 *
 * Lo que sí podemos hacer sin herramientas locales:
 * - Generar safeUpdates para paquetes desactualizados
 *
 * El análisis de conflictos transitivos se añadirá en v2.3 con detección de Go en PATH.
 */
export async function runCompatibilityAnalysis(
	packages: PackageResult[],
	toolUnavailable: boolean
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
					migrationRisk: calcMigrationRisk(pkg.majorVersionJump, pkg.vulnerabilities.length > 0)
			});
		}
	}

	return {
		conflicts: [],   // Requiere `go mod graph` — pendiente v2.3
		safeUpdates,
		toolUnavailable: false
	};
}

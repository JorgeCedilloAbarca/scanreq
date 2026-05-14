import { PackageResult, CompatibilityReport, SafeUpdate, calcMigrationRisk } from '../types';
import { getLocale } from '../../i18n';
import { versionExistsInMaven } from './registry';

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
 * - safeUpdates para paquetes al día pero con CVEs (con o sin versión parcheada)
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
			// Paquetes con versión no exacta se muestran con ∼ en currentVersion
			// para ser consistentes con la tabla principal y advertir al usuario
			// de que la versión instalada real podría diferir.
			const displayVersion = pkg.exactVersion
				? pkg.installedVersion
				: `∼${pkg.installedVersion}`;

			safeUpdates.push({
				packageName: pkg.name,
				currentVersion: displayVersion,
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
		} else if (pkg.upToDate && pkg.vulnerabilities.length > 0) {
			// Caso nuevo: paquete al día según el registry pero con CVEs activos.
			// Buscar si algún CVE tiene fixedVersion conocida en OSV.
			const fixedVersions = pkg.vulnerabilities
				.map(v => v.fixedVersion)
				.filter((v): v is string => !!v);

			if (fixedVersions.length > 0) {
				// Tomar la versión más alta entre todos los fixes reportados por OSV
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
				const patchVersion = fixedVersions[0];

				// Verificar que esa versión realmente existe en Maven Central
				// para este mismo groupId:artifactId. OSV a veces apunta al fix
				// en un artefacto sucesor con coordenadas distintas.
				const [groupId, artifactId] = pkg.name.split(':');
				const existsInRegistry = groupId && artifactId
					? await versionExistsInMaven(groupId, artifactId, patchVersion)
					: false;

				if (existsInRegistry) {
					safeUpdates.push({
						packageName: pkg.name,
						currentVersion: pkg.installedVersion,
						recommendedVersion: patchVersion,
						reason: locale === 'es'
							? `Versión parcheada disponible — corrige ${pkg.vulnerabilities.length} CVE(s)`
							: `Patched version available — fixes ${pkg.vulnerabilities.length} CVE(s)`,
						migrationRisk: 'medium',
					});
				} else {
					// La fixedVersion no existe en el registry para este artefacto.
					// Puede que el parche esté en un artefacto sucesor o renombrado.
					safeUpdates.push({
						packageName: pkg.name,
						currentVersion: pkg.installedVersion,
						recommendedVersion: pkg.installedVersion,
						reason: locale === 'es'
							? `Sin parche disponible en este artefacto — puede haberse movido a un sucesor`
							: `No patch available for this artifact — may have moved to a successor`,
						migrationRisk: 'unpatched',
					});
				}
			} else {
				// OSV no reporta ningún fixedVersion para ninguno de los CVEs
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
	}

	return {
		conflicts: [],   // Requiere `mvn dependency:tree` — pendiente
		safeUpdates,
		toolUnavailable: false,
	};
}

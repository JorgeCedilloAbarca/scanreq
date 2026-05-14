import { PackageResult, CompatibilityReport, SafeUpdate, ConflictDetail, calcMigrationRisk } from '../types';
import { getLocale } from '../../i18n';
import { checkGoAvailability, runGoModGraph, parseModuleRef } from './gotools';

/**
 * Análisis de compatibilidad para Go.
 *
 * v2.3: Añade detección de conflictos transitivos via `go mod graph`.
 * - Si Go está disponible en PATH → ejecuta go mod graph y analiza el grafo.
 * - Si Go no está disponible → toolUnavailable: true, solo safeUpdates.
 *
 * Estrategia de detección de conflictos:
 * El grafo de go mod graph da aristas "from to@version". Si el mismo módulo
 * aparece requerido con versiones distintas por distintos padres, Go MVS
 * (Minimum Version Selection) elige la versión máxima automáticamente.
 * Un "conflicto" relevante para el usuario es cuando:
 *   - El módulo top-level tiene el módulo en go.mod con versión X
 *   - Pero una dependencia transitiva requiere versión Y > X
 *   - Esto puede indicar que go.mod está desactualizado respecto a lo que se usará
 */
export async function runCompatibilityAnalysis(
	packages: PackageResult[],
	goModPath: string | null,
	_toolUnavailable: boolean
): Promise<CompatibilityReport> {
	const locale = getLocale();
	const safeUpdates: SafeUpdate[] = [];

	// 1. Generar safeUpdates (siempre, sin necesidad de herramientas)
	for (const pkg of packages) {
		if (!pkg.upToDate && pkg.installedVersion !== 'unknown' && pkg.latestVersion !== 'Not found') {
			safeUpdates.push({
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
			});
				} else if (pkg.upToDate && pkg.vulnerabilities.length > 0) {
			// Paquete al día según el registry pero con CVEs activos.
			// Si OSV reporta fixedVersion, sugerirla directamente.
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
				safeUpdates.push({
					packageName: pkg.name,
					currentVersion: pkg.installedVersion,
					recommendedVersion: fixedVersions[0],
					reason: locale === 'es'
						? `Versión parcheada disponible — corrige ${pkg.vulnerabilities.length} CVE(s)`
						: `Patched version available — fixes ${pkg.vulnerabilities.length} CVE(s)`,
					migrationRisk: 'medium',
				});
			} else {
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

	// 2. Conflictos transitivos — requiere Go en PATH y la ruta del go.mod
	const goAvail = await checkGoAvailability();
	if (!goAvail.available || !goModPath) {
		return {
			conflicts: [],
			safeUpdates,
			toolUnavailable: !goAvail.available,
		};
	}

	const conflicts = await detectTransitiveConflicts(packages, goModPath, locale);

	return {
		conflicts,
		safeUpdates,
		toolUnavailable: false,
	};
}

/**
 * Detecta conflictos transitivos usando el grafo de go mod graph.
 *
 * Algoritmo:
 * 1. Ejecutar go mod graph → lista de aristas (from, to@version)
 * 2. Para cada módulo en el grafo, recopilar todas las versiones requeridas
 *    por distintos padres.
 * 3. Si el mismo módulo es requerido en versiones distintas, Go MVS elige
 *    la máxima. Si la versión del go.mod del proyecto es menor que la máxima
 *    transitiva, reportar el conflicto.
 */
async function detectTransitiveConflicts(
	packages: PackageResult[],
	goModPath: string,
	locale: string
): Promise<ConflictDetail[]> {
	const edges = await runGoModGraph(goModPath);
	if (edges.length === 0) { return []; }

	// Mapa: módulo → Set de versiones requeridas por distintos padres
	// { "github.com/foo/bar" → Map<requiredBy, version> }
	const moduleRequirements = new Map<string, Map<string, string>>();

	for (const edge of edges) {
		const { module: toModule, version: toVersion } = parseModuleRef(edge.to);
		if (!toVersion) { continue; }

		const { module: fromModule } = parseModuleRef(edge.from);

		if (!moduleRequirements.has(toModule)) {
			moduleRequirements.set(toModule, new Map());
		}
		// Si el mismo parent ya requiere este módulo, tomamos la mayor
		const existing = moduleRequirements.get(toModule)!;
		const existingVer = existing.get(fromModule);
		if (!existingVer || compareVersions(toVersion, existingVer) > 0) {
			existing.set(fromModule, toVersion);
		}
	}

	// Mapa rápido de los paquetes directos del proyecto (go.mod)
	const directPackageMap = new Map<string, PackageResult>();
	for (const pkg of packages) {
		directPackageMap.set(pkg.name, pkg);
	}

	const conflicts: ConflictDetail[] = [];

	for (const [moduleName, requirers] of moduleRequirements.entries()) {
		if (requirers.size <= 1) { continue; }

		// Encontrar la versión máxima requerida transitivamente
		let maxVersion = '';
		let maxRequiredBy = '';
		for (const [requirer, version] of requirers.entries()) {
			if (!maxVersion || compareVersions(version, maxVersion) > 0) {
				maxVersion = version;
				maxRequiredBy = requirer;
			}
		}

		// Solo reportar si el módulo está en go.mod del proyecto
		// y la versión en go.mod es menor que la máxima transitiva
		const directPkg = directPackageMap.get(moduleName);
		if (!directPkg) { continue; }

		const projectVersion = directPkg.installedVersion;
		if (compareVersions(maxVersion, projectVersion) <= 0) { continue; }

		conflicts.push({
			packageName: moduleName,
			requiredBy: maxRequiredBy,
			requiredSpec: `>= ${maxVersion}`,
			installedVersion: projectVersion,
			recommendation: locale === 'es'
				? `Actualizar a ${maxVersion} o superior para alinear con dependencias transitivas`
				: `Update to ${maxVersion} or higher to align with transitive dependencies`,
		});
	}

	return conflicts;
}

/**
 * Compara dos versiones semver. Devuelve:
 *   > 0 si a > b
 *   < 0 si a < b
 *     0 si a === b
 * Solo compara major.minor.patch — ignora pre-release y build metadata.
 */
function compareVersions(a: string, b: string): number {
	const partsA = a.split('.').map(n => parseInt(n, 10) || 0);
	const partsB = b.split('.').map(n => parseInt(n, 10) || 0);

	const len = Math.max(partsA.length, partsB.length);
	for (let i = 0; i < len; i++) {
		const na = partsA[i] ?? 0;
		const nb = partsB[i] ?? 0;
		if (na !== nb) { return na - nb; }
	}
	return 0;
}

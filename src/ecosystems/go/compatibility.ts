import { PackageResult, CompatibilityReport, SafeUpdate, ConflictDetail, calcMigrationRisk } from '../types';
import { getLocale } from '../../i18n';
import { compareVersions, buildAllSafeUpdates } from '../shared';
import { checkGoAvailability, runGoModGraph, parseModuleRef } from './gotools';

/**
 * Análisis de compatibilidad para Go.
 *
 * Estrategia de detección de conflictos:
 * Si Go está disponible en PATH → ejecuta go mod graph y analiza el grafo.
 * Si Go no está disponible → toolUnavailable: true, solo safeUpdates.
 */
export async function runCompatibilityAnalysis(
	packages: PackageResult[],
	goModPath: string | null,
	_toolUnavailable: boolean
): Promise<CompatibilityReport> {
	const locale = getLocale();

	// Fix D1: safeUpdates generados por función compartida
	const safeUpdates = buildAllSafeUpdates(packages, locale);

	// Conflictos transitivos — requiere Go en PATH y la ruta del go.mod
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
 */
async function detectTransitiveConflicts(
	packages: PackageResult[],
	goModPath: string,
	locale: string
): Promise<ConflictDetail[]> {
	const edges = await runGoModGraph(goModPath);
	if (edges.length === 0) { return []; }

	const moduleRequirements = new Map<string, Map<string, string>>();

	for (const edge of edges) {
		const { module: toModule, version: toVersion } = parseModuleRef(edge.to);
		if (!toVersion) { continue; }

		const { module: fromModule } = parseModuleRef(edge.from);

		if (!moduleRequirements.has(toModule)) {
			moduleRequirements.set(toModule, new Map());
		}
		const existing = moduleRequirements.get(toModule)!;
		const existingVer = existing.get(fromModule);
		if (!existingVer || compareVersions(toVersion, existingVer) > 0) {
			existing.set(fromModule, toVersion);
		}
	}

	const directPackageMap = new Map<string, PackageResult>();
	for (const pkg of packages) {
		directPackageMap.set(pkg.name, pkg);
	}

	const conflicts: ConflictDetail[] = [];

	for (const [moduleName, requirers] of moduleRequirements.entries()) {
		if (requirers.size <= 1) { continue; }

		let maxVersion = '';
		let maxRequiredBy = '';
		for (const [requirer, version] of requirers.entries()) {
			if (!maxVersion || compareVersions(version, maxVersion) > 0) {
				maxVersion = version;
				maxRequiredBy = requirer;
			}
		}

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

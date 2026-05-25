import { PackageResult, CompatibilityReport, ConflictDetail, SafeUpdate, calcMigrationRisk } from '../types';
import { getLocale } from '../../i18n';
import { compareVersions, buildAllSafeUpdates } from '../shared';

interface RubyGemDependency {
	name: string;
	requirements: string;
}

interface RubyGemData {
	version: string;
	dependencies: {
		runtime: RubyGemDependency[];
		development: RubyGemDependency[];
	};
}

// Cache para evitar re-consultar RubyGems el mismo paquete dos veces en el mismo scan
const rubygemsCache = new Map<string, RubyGemData | null>();

async function fetchRubyGemData(name: string): Promise<RubyGemData | null> {
	const key = name.toLowerCase();
	if (rubygemsCache.has(key)) {
		return rubygemsCache.get(key)!;
	}

	try {
		const response = await fetch(
			`https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`,
			{ headers: { 'User-Agent': 'ScanReq-VSCode-Extension/2.6 (https://scanreq.com)' } }
		);
		if (!response.ok) {
			rubygemsCache.set(key, null);
			return null;
		}
		const data = await response.json() as RubyGemData;
		rubygemsCache.set(key, data);
		return data;
	} catch {
		rubygemsCache.set(key, null);
		return null;
	}
}

/**
 * Comprueba si una versión instalada satisface un specifier Ruby/Bundler.
 */
function satisfiesRubySpec(installed: string, requirements: string): boolean {
	if (!requirements || requirements.trim() === '>= 0') { return true; }

	const parts = requirements.split(',').map(p => p.trim()).filter(Boolean);

	return parts.every(spec => {
		if (spec.startsWith('~>')) {
			const specVer = spec.slice(2).trim();
			const cmp = compareVersions(installed, specVer);
			if (cmp < 0) { return false; }

			const specParts = specVer.split('.');
			const instParts = installed.split('.');

			if (specParts.length >= 3) {
				return instParts[0] === specParts[0] && instParts[1] === specParts[1];
			} else {
				return instParts[0] === specParts[0];
			}
		}

		const match = spec.match(/^(>=|<=|!=|>|<|=)\s*(.+)$/);
		if (!match) { return true; }

		const op = match[1];
		const specVer = match[2].trim();
		const cmp = compareVersions(installed, specVer);

		switch (op) {
			case '>=': return cmp >= 0;
			case '<=': return cmp <= 0;
			case '>':  return cmp > 0;
			case '<':  return cmp < 0;
			case '!=': return cmp !== 0;
			case '=':  return cmp === 0;
		}

		return true;
	});
}

// ─── Análisis principal ───────────────────────────────────────────────────────

export async function runCompatibilityAnalysis(
	packages: PackageResult[],
	_toolUnavailable: boolean
): Promise<CompatibilityReport> {
	rubygemsCache.clear();
	const locale = getLocale();

	const conflicts: ConflictDetail[] = [];

	const installedMap = new Map<string, string>();
	for (const pkg of packages) {
		installedMap.set(pkg.name.toLowerCase(), pkg.installedVersion);
		installedMap.set(pkg.name.toLowerCase().replace(/-/g, '_'), pkg.installedVersion);
	}

	const analysisPromises = packages.map(async (pkg) => {
		const data = await fetchRubyGemData(pkg.name);
		if (!data) { return; }

		const runtimeDeps: RubyGemDependency[] = data.dependencies?.runtime ?? [];

		for (const dep of runtimeDeps) {
			const depName = dep.name.toLowerCase();
			const requirements = dep.requirements;

			if (!requirements || requirements.trim() === '>= 0') { continue; }

			const installedVersion =
				installedMap.get(depName) ??
				installedMap.get(depName.replace(/-/g, '_'));

			if (!installedVersion || installedVersion === 'unknown') { continue; }

			const satisfied = satisfiesRubySpec(installedVersion, requirements);
			if (!satisfied) {
				conflicts.push({
					packageName: dep.name,
					requiredBy: pkg.name,
					requiredSpec: `${dep.name} ${requirements}`,
					installedVersion,
					recommendation: locale === 'es'
						? `Actualiza ${dep.name} para cumplir ${requirements} requerido por ${pkg.name}`
						: `Update ${dep.name} to satisfy ${requirements} required by ${pkg.name}`,
				});
			}
		}
	});

	await Promise.all(analysisPromises);

	// Fix D1: safeUpdates generados por función compartida
	const safeUpdates = buildAllSafeUpdates(packages, locale);

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
		toolUnavailable: false,
	};
}

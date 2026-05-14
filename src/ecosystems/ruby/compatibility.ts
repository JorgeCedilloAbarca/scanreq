import { PackageResult, CompatibilityReport, ConflictDetail, SafeUpdate, calcMigrationRisk } from '../types';
import { getLocale } from '../../i18n';

interface RubyGemDependency {
	name: string;
	requirements: string;   // e.g. ">= 1.0", "~> 2.3", "= 1.5.0"
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
			{ headers: { 'User-Agent': 'ScanReq-VSCode-Extension/2.3 (https://scanreq.com)' } }
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

// ─── Comparación de versiones ─────────────────────────────────────────────────

function versionToTuple(v: string): number[] {
	return v.replace(/[^0-9.]/g, '').split('.').map(n => parseInt(n) || 0);
}

function compareVersions(a: string, b: string): number {
	const ta = versionToTuple(a);
	const tb = versionToTuple(b);
	const len = Math.max(ta.length, tb.length);
	for (let i = 0; i < len; i++) {
		const diff = (ta[i] ?? 0) - (tb[i] ?? 0);
		if (diff !== 0) { return diff; }
	}
	return 0;
}

/**
 * Comprueba si una versión instalada satisface un specifier Ruby/Bundler.
 *
 * RubyGems API devuelve requirements como strings como:
 *   ">= 1.0.0"
 *   "~> 2.3"         (pessimistic — compatible minor)
 *   "~> 2.3.0"       (pessimistic — compatible patch)
 *   "= 1.5.0"
 *   ">= 0"           (sin restricción práctica)
 *
 * Puede haber múltiples especificadores separados por coma:
 *   ">= 1.0, < 2.0"
 */
function satisfiesRubySpec(installed: string, requirements: string): boolean {
	if (!requirements || requirements.trim() === '>= 0') { return true; }

	// Múltiples specs separadas por coma
	const parts = requirements.split(',').map(p => p.trim()).filter(Boolean);

	return parts.every(spec => {
		// Pessimistic: ~> X.Y → >= X.Y && < X+1.0
		//              ~> X.Y.Z → >= X.Y.Z && < X.Y+1.0
		if (spec.startsWith('~>')) {
			const specVer = spec.slice(2).trim();
			const cmp = compareVersions(installed, specVer);
			if (cmp < 0) { return false; }

			const specParts = specVer.split('.');
			const instParts = installed.split('.');

			if (specParts.length >= 3) {
				// ~> X.Y.Z — compatible patch: major y minor deben coincidir
				return instParts[0] === specParts[0] && instParts[1] === specParts[1];
			} else {
				// ~> X.Y — compatible minor: solo major debe coincidir
				return instParts[0] === specParts[0];
			}
		}

		// Operadores estándar
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
	const safeUpdates: SafeUpdate[] = [];

	// Mapa nombre normalizado → versión instalada
	// Ruby normaliza guiones y underscores indistintamente en algunos gems
	const installedMap = new Map<string, string>();
	for (const pkg of packages) {
		installedMap.set(pkg.name.toLowerCase(), pkg.installedVersion);
		// Alias con guiones convertidos a underscores (e.g. factory_bot ↔ factory-bot)
		installedMap.set(pkg.name.toLowerCase().replace(/-/g, '_'), pkg.installedVersion);
	}

	const analysisPromises = packages.map(async (pkg) => {
		const data = await fetchRubyGemData(pkg.name);
		if (!data) { return; }

		// Solo analizamos runtime dependencies (no development)
		const runtimeDeps: RubyGemDependency[] = data.dependencies?.runtime ?? [];

		for (const dep of runtimeDeps) {
			const depName = dep.name.toLowerCase();
			const requirements = dep.requirements;

			// Sin restricción práctica — no es un conflicto relevante
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

		// safeUpdates
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
		});

	await Promise.all(analysisPromises);

	// Deduplicar conflictos
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

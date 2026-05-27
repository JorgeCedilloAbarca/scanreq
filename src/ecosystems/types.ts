// ─── Ecosistemas soportados ───────────────────────────────────────────────────

export type EcosystemId = 'python' | 'node' | 'rust' | 'go' | 'php' | 'ruby' | 'java' | 'gradle';

export type OsvEcosystem = 'PyPI' | 'npm' | 'crates.io' | 'Go' | 'Packagist' | 'RubyGems' | 'Maven';

// Severidad de un CVE. UNKNOWN para CVEs sin severity asignada por OSV
// (común en Go-Vuln IDs como GO-XXXX-XXXX que no tienen database_specific.severity).
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'MODERATE' | 'LOW' | 'UNKNOWN';

// Severidades que disparan riesgo alto de migración (Phase 3) aunque no haya major jump.
// CRITICAL + HIGH significan "actuar pronto"; MEDIUM/MODERATE/LOW se mantienen en Phase 2.
const URGENT_SEVERITIES: ReadonlySet<string> = new Set(['CRITICAL', 'HIGH']);

// ─── Resultado por paquete ────────────────────────────────────────────────────

export interface Vulnerability {
	id: string;
	summary: string;
	severity: string;
	fixedVersion?: string;  // versión en la que se parchó el CVE, si OSV la conoce
	// Plataforma específica si el CVE solo afecta a un OS (común en golang.org/x/sys).
	// Por ejemplo: el CVE de NewNTUnicodeString solo afecta a /windows. Detectado
	// buscando "/windows", "/linux", "/darwin", etc. en summary y details de OSV.
	platform?: string;
}

export interface PackageResult {
	name: string;
	installedVersion: string;
	latestVersion: string;
	upToDate: boolean;
	exactVersion: boolean;
	vulnerabilities: Vulnerability[];
	detectedByTool: boolean;
	ecosystem: EcosystemId;
	majorVersionJump: number;
	// true cuando la consulta a OSV falló (timeout, 429, 5xx) y no pudimos
	// confirmar si hay CVEs. Diferente de vulnerabilities.length === 0 (que
	// significa "confirmado sin CVEs"). Sin este flag, un fallo de OSV se
	// muestra como "✓ Sin CVEs" — un falso negativo de seguridad.
	cveCheckFailed: boolean;
}

// ─── Compatibilidad (Pro) ─────────────────────────────────────────────────────

export interface ConflictDetail {
	packageName: string;
	requiredBy: string;
	requiredSpec: string;
	installedVersion: string;
	recommendation: string;
}

export interface SafeUpdate {
	packageName: string;
	currentVersion: string;
	recommendedVersion: string;
	reason: string;
	migrationRisk: 'low' | 'medium' | 'high' | 'unpatched';
}

export interface CompatibilityReport {
	conflicts: ConflictDetail[];
	safeUpdates: SafeUpdate[];
	toolUnavailable: boolean;
}

// ─── Resultado de un ecosistema completo ─────────────────────────────────────

export interface ScanResult {
	ecosystem: EcosystemId;
	filePath: string;
	packages: PackageResult[];
	compatReport: CompatibilityReport | null;
}

// ─── Interfaz que implementa cada adapter ────────────────────────────────────

export interface EcosystemAdapter {
	id: EcosystemId;
	filePatterns: string[];
	displayName: string;
	scan(filePath: string, isPro: boolean): Promise<ScanResult>;
}

// ─── Utilidades compartidas ───────────────────────────────────────────────────

/**
 * Detecta versionado tipo Calendar Versioning (CalVer).
 *
 * Algunas librerías usan fechas como versión en lugar de SemVer:
 *   - org.json:json → 20231013, 20250517 (YYYYMMDD)
 *   - paquetes Ubuntu → 22.04, 24.04 (YY.MM)
 *
 * Para CalVer, calcular "major version jump" no tiene sentido: pasar de 20231013
 * a 20250517 NO son 19504 majors, es solo una actualización de mantenimiento.
 *
 * Detectamos los patrones más comunes:
 *   - YYYYMMDD (8 dígitos puros)            → org.json
 *   - YYYYMMDD.NN (formato con build)       → algunos paquetes Maven legacy
 *   - YYYY.MM.DD                            → algunos paquetes Python
 *   - YY.MM (con punto)                     → Ubuntu, openSSL
 */
function isCalVer(version: string): boolean {
	const v = version.trim();
	// YYYYMMDD o YYYYMMDD.NN — el componente principal es de 8 dígitos
	if (/^\d{8}(\.\d+)?$/.test(v)) { return true; }
	// YYYY.MM.DD — primer componente es año (>= 1990) con 4 dígitos exactos
	const yyyymmdd = v.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/);
	if (yyyymmdd) {
		const year = parseInt(yyyymmdd[1], 10);
		if (year >= 1990 && year <= 2099) { return true; }
	}
	return false;
}

/**
 * Calcula el salto de versión mayor entre la versión instalada y la latest.
 *
 * Fix JM1: las versiones CalVer (org.json:json usa YYYYMMDD) devuelven 0 porque
 * tratar "20231013 → 20250517" como un salto de 19504 majors confunde al usuario
 * y mete la dependencia en Phase 3 sin razón.
 *
 * Fix G3: para versiones 0.X.Y, en SemVer la zona 0.X se trata como "salvaje
 * oeste" — cualquier cambio en X puede ser breaking. Si la versión instalada
 * empieza por 0., devolvemos el salto en el segundo componente (X) como si
 * fuera el mayor. Así, 0.28 → 0.45 da 17, suficiente para que vaya a Phase 3.
 */
export function calcMajorVersionJump(from: string, to: string): number {
	// CalVer: no aplicar lógica de major jump
	if (isCalVer(from) || isCalVer(to)) { return 0; }

	const fromParts = from.split('.');
	const toParts   = to.split('.');
	const fromMajor = parseInt(fromParts[0], 10);
	const toMajor   = parseInt(toParts[0], 10);
	if (isNaN(fromMajor) || isNaN(toMajor)) { return 0; }

	// Fix G3: zona 0.x — usar el segundo componente como "major" efectivo.
	// Si ambos están en 0.X, el salto en X es lo que cuenta.
	// Si saltamos de 0.X a 1.0+ (o viceversa), eso ya es un major real y va por la rama normal.
	if (fromMajor === 0 && toMajor === 0) {
		const fromMinor = parseInt(fromParts[1] ?? '0', 10) || 0;
		const toMinor   = parseInt(toParts[1] ?? '0', 10) || 0;
		return Math.max(0, toMinor - fromMinor);
	}

	return Math.max(0, toMajor - fromMajor);
}

/**
 * Calcula el riesgo de migración de un paquete.
 *
 * Reglas:
 * 1. CVE CRITICAL o HIGH presente → high (Phase 3) sin importar el major jump.
 *    Razón: el peligro de mantenerlo en producción supera el coste de migración.
 * 2. Major jump >= 1 → high (incluye casos de zona 0.x con salto en X según G3).
 * 3. Tiene CVEs (de cualquier severidad menor) → medium.
 * 4. Sin nada de lo anterior → low.
 *
 * Fix JM2: antes, un CVE CRITICAL en un paquete al día caía en Phase 2 (medium)
 * porque la función solo aceptaba un booleano hasCVEs. Ahora acepta la severidad
 * máxima para promover correctamente vulnerabilidades urgentes.
 */
export function calcMigrationRisk(
	majorJump: number,
	hasCVEs: boolean,
	maxSeverity?: string
): 'low' | 'medium' | 'high' {
	// Fix JM2: CVE crítico o alto siempre fuerza Phase 3
	if (maxSeverity && URGENT_SEVERITIES.has(maxSeverity.toUpperCase())) {
		return 'high';
	}
	// Major jump siempre es riesgo alto, independientemente de CVEs
	if (majorJump >= 1) { return 'high'; }
	// Sin major jump pero con CVEs → riesgo medio
	if (hasCVEs) { return 'medium'; }
	return 'low';
}

/**
 * Devuelve la severidad máxima de un array de vulnerabilidades.
 * Útil para pasar a calcMigrationRisk.
 */
export function maxSeverityOf(vulns: Vulnerability[]): string | undefined {
	const order: Record<string, number> = {
		CRITICAL: 0, HIGH: 1, MEDIUM: 2, MODERATE: 2, LOW: 3, UNKNOWN: 4,
	};
	let maxSev: string | undefined;
	let maxRank = 99;
	for (const v of vulns) {
		const sev = v.severity?.toUpperCase() ?? 'UNKNOWN';
		const rank = order[sev] ?? 5;
		if (rank < maxRank) {
			maxRank = rank;
			maxSev = sev;
		}
	}
	return maxSev;
}

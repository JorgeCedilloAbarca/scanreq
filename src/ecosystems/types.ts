// ─── Ecosistemas soportados ───────────────────────────────────────────────────

export type EcosystemId = 'python' | 'node' | 'rust' | 'go' | 'php' | 'ruby';

export type OsvEcosystem = 'PyPI' | 'npm' | 'crates.io' | 'Go' | 'Packagist' | 'RubyGems';

// ─── Resultado por paquete ────────────────────────────────────────────────────

export interface Vulnerability {
	id: string;
	summary: string;
	severity: string;
}

export interface PackageResult {
	name: string;
	installedVersion: string;    // versión del archivo de dependencias o detectada por tool
	latestVersion: string;       // versión más reciente en el registry
	upToDate: boolean;
	exactVersion: boolean;       // true si el specifier es exacto (==, version fija)
	vulnerabilities: Vulnerability[];
	detectedByTool: boolean;     // true si la versión fue detectada con pip/node_modules/etc.
	ecosystem: EcosystemId;
	majorVersionJump: number;    // saltos de versión mayor entre installedVersion y latestVersion (Pro)
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
	migrationRisk: 'low' | 'medium' | 'high';  // riesgo de breaking changes al actualizar
}

export interface CompatibilityReport {
	conflicts: ConflictDetail[];
	safeUpdates: SafeUpdate[];
	toolUnavailable: boolean;    // pip/npm/etc. no disponible en PATH
}

// ─── Resultado de un ecosistema completo ─────────────────────────────────────

export interface ScanResult {
	ecosystem: EcosystemId;
	filePath: string;            // ruta absoluta del archivo escaneado
	packages: PackageResult[];
	compatReport: CompatibilityReport | null;  // null en Free o si no aplica
}

// ─── Interfaz que implementa cada adapter ────────────────────────────────────

export interface EcosystemAdapter {
	id: EcosystemId;
	filePatterns: string[];      // patrones glob, e.g. ['requirements.txt']
	displayName: string;         // nombre legible para el panel, e.g. 'Python'
	scan(filePath: string, isPro: boolean): Promise<ScanResult>;
}

// ─── Utilidades compartidas ───────────────────────────────────────────────────

/**
 * Calcula cuántas versiones mayores hay entre dos versiones.
 * Ejemplos: "1.2.3" → "2.0.0" = 1, "3.0.0" → "7.0.0" = 4, "1.2.3" → "1.5.0" = 0
 */
export function calcMajorVersionJump(from: string, to: string): number {
	const fromMajor = parseInt(from.split('.')[0], 10);
	const toMajor   = parseInt(to.split('.')[0], 10);
	// Si alguna versión no es numérica (e.g. 'unknown', 'Not found') devolvemos 0
	if (isNaN(fromMajor) || isNaN(toMajor)) { return 0; }
	return Math.max(0, toMajor - fromMajor);
}

/**
 * Calcula el migrationRisk de una actualización basándose en el salto de versión mayor
 * y la presencia de CVEs.
 */
export function calcMigrationRisk(
	majorJump: number,
	hasCVEs: boolean
): 'low' | 'medium' | 'high' {
	if (majorJump >= 2) { return 'high'; }
	if (majorJump === 1 || hasCVEs) { return 'medium'; }
	return 'low';
}

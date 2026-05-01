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

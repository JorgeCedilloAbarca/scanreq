// ─── Ecosistemas soportados ───────────────────────────────────────────────────

export type EcosystemId = 'python' | 'node' | 'rust' | 'go' | 'php' | 'ruby' | 'java' | 'gradle';

export type OsvEcosystem = 'PyPI' | 'npm' | 'crates.io' | 'Go' | 'Packagist' | 'RubyGems' | 'Maven';

// ─── Resultado por paquete ────────────────────────────────────────────────────

export interface Vulnerability {
	id: string;
	summary: string;
	severity: string;
	fixedVersion?: string;  // versión en la que se parchó el CVE, si OSV la conoce
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

export function calcMajorVersionJump(from: string, to: string): number {
	const fromMajor = parseInt(from.split('.')[0], 10);
	const toMajor   = parseInt(to.split('.')[0], 10);
	if (isNaN(fromMajor) || isNaN(toMajor)) { return 0; }
	return Math.max(0, toMajor - fromMajor);
}

export function calcMigrationRisk(majorJump: number, hasCVEs: boolean): 'low' | 'medium' | 'high' {
	// Major jump siempre es riesgo alto, independientemente de CVEs
	if (majorJump >= 1) { return 'high'; }
	// Sin major jump pero con CVEs → riesgo medio
	if (hasCVEs) { return 'medium'; }
	return 'low';
}

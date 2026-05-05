import { PackageResult, EcosystemId, Vulnerability } from '../types';
import { checkCVEs } from '../../osv';
import { calcMajorVersionJump } from '../types';

const ECOSYSTEM: EcosystemId = 'java';
const OSV_ECOSYSTEM = 'Maven';

/**
 * Consulta Maven Central Search API para un artefacto Java.
 *
 * Problema conocido: algunos artefactos legacy (como commons-io) tienen versiones
 * publicadas con formato de fecha (20030203.000550) que Maven Central indexa como
 * "latestVersion" porque numéricamente son mayores que las versiones semver reales.
 * En estos casos, buscamos la versión semver estable más reciente entre todas las
 * versiones disponibles en lugar de confiar ciegamente en "latestVersion".
 */
export async function checkMaven(
	name: string,
	groupId: string,
	artifactId: string,
	installedVersion: string,
	exactVersion: boolean,
	isPro: boolean
): Promise<PackageResult> {
	const notFound: PackageResult = {
		name,
		installedVersion,
		latestVersion: 'Not found',
		// Si la versión es exacta y no encontramos en el registry, no es un problema real
		upToDate: exactVersion && installedVersion !== 'unknown',
		exactVersion,
		vulnerabilities: [],
		detectedByTool: false,
		ecosystem: ECOSYSTEM,
		majorVersionJump: 0,
	};

	try {
		const query = `g:${encodeURIComponent(groupId)}+AND+a:${encodeURIComponent(artifactId)}`;
		const url   = `https://search.maven.org/solrsearch/select?q=${query}&rows=1&wt=json`;

		const response = await fetch(url, {
			headers: { 'User-Agent': 'ScanReq-VSCode-Extension/2.4 (https://scanreq.com)' }
		});

		if (!response.ok) { return notFound; }

		const data = await response.json() as any;
		const docs: any[] = data?.response?.docs;
		if (!Array.isArray(docs) || docs.length === 0) { return notFound; }

		let latestVersion: string = docs[0]?.latestVersion;
		if (!latestVersion || typeof latestVersion !== 'string') { return notFound; }

		// Si latestVersion es una fecha legacy o un pre-release (milestone, alpha, beta, RC),
		// buscar la versión semver estable más reciente entre todas las versiones del artefacto.
		// Ejemplos afectados: commons-io (20030203.000550), junit-jupiter (5.13.0-M3)
		if (isDateVersion(latestVersion) || !isStableSemver(latestVersion)) {
			const semverLatest = await findLatestSemverVersion(groupId, artifactId);
			if (semverLatest) {
				latestVersion = semverLatest;
			}
		}

		// Si la versión instalada es mayor que la "latest" del registro,
		// el paquete está al día (el registro puede estar desactualizado para releases muy recientes).
		// Evita sugerir downgrades.
		if (installedVersion !== 'unknown' && compareSemver(installedVersion, latestVersion) > 0) {
			latestVersion = installedVersion;
		}

		const upToDate        = installedVersion !== 'unknown' && installedVersion === latestVersion;
		const majorVersionJump = calcMajorVersionJump(installedVersion, latestVersion);

		let vulnerabilities: Vulnerability[] = [];
		if (exactVersion || isPro) {
			vulnerabilities = await checkCVEs(name, installedVersion, OSV_ECOSYSTEM);
		}

		return {
			name,
			installedVersion,
			latestVersion,
			upToDate,
			exactVersion,
			vulnerabilities,
			detectedByTool: false,
			ecosystem: ECOSYSTEM,
			majorVersionJump,
		};
	} catch {
		return notFound;
	}
}

/**
 * Detecta si una versión tiene formato de fecha legacy (YYYYMMDD.HHMMSS o YYYYMMDD).
 * Ejemplos: "20030203.000550", "20041127.091804"
 */
function isDateVersion(version: string): boolean {
	return /^\d{8}(\.\d+)?$/.test(version);
}

/**
 * Busca la versión semver estable más reciente de un artefacto en Maven Central.
 * Usa el endpoint de versiones (core=gav) que devuelve todas las versiones.
 * Filtra: versiones fecha, SNAPSHOT, alpha, beta, RC, M (milestone).
 * Ordena por semver descendente y devuelve la más alta.
 */
async function findLatestSemverVersion(groupId: string, artifactId: string): Promise<string | null> {
	try {
		const query = `g:${encodeURIComponent(groupId)}+AND+a:${encodeURIComponent(artifactId)}`;
		const url   = `https://search.maven.org/solrsearch/select?q=${query}&core=gav&rows=50&wt=json`;

		const response = await fetch(url, {
			headers: { 'User-Agent': 'ScanReq-VSCode-Extension/2.4 (https://scanreq.com)' }
		});

		if (!response.ok) { return null; }

		const data = await response.json() as any;
		const docs: any[] = data?.response?.docs;
		if (!Array.isArray(docs) || docs.length === 0) { return null; }

		const versions = docs
			.map((d: any) => d.v as string)
			.filter(v => v && isStableSemver(v));

		if (versions.length === 0) { return null; }

		// Ordenar semver descendente y devolver el mayor
		versions.sort((a, b) => compareSemver(b, a));
		return versions[0];
	} catch {
		return null;
	}
}

/**
 * Comprueba si una versión es semver estable (no fecha, no snapshot, no pre-release).
 */
function isStableSemver(version: string): boolean {
	if (isDateVersion(version)) { return false; }
	const lower = version.toLowerCase();
	if (lower.includes('snapshot')) { return false; }
	if (lower.includes('alpha'))    { return false; }
	if (lower.includes('beta'))     { return false; }
	if (lower.includes('-rc'))      { return false; }
	if (lower.includes('-m') && /\-m\d/i.test(lower)) { return false; } // milestone: -M1, -M2
	if (lower.includes('-ea'))      { return false; } // early access: 25-ea+21
	if (lower.includes('+'))        { return false; } // build metadata: 25-ea+21
	if (version === 'LATEST' || version === 'RELEASE') { return false; }
	// Debe empezar por dígito
	return /^\d/.test(version);
}

/**
 * Compara dos versiones semver. Devuelve >0 si a>b, <0 si a<b, 0 si iguales.
 */
function compareSemver(a: string, b: string): number {
	const partsA = a.split(/[.\-]/).map(p => parseInt(p, 10) || 0);
	const partsB = b.split(/[.\-]/).map(p => parseInt(p, 10) || 0);
	const len = Math.max(partsA.length, partsB.length);
	for (let i = 0; i < len; i++) {
		const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
		if (diff !== 0) { return diff; }
	}
	return 0;
}

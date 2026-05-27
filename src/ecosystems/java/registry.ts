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
	isPro: boolean,
	hasPrivateRepos: boolean = false
): Promise<PackageResult> {
	// Determinar label según el motivo de no encontrar el artefacto.
	const unavailableLabel = installedVersion.toUpperCase().includes('SNAPSHOT')
		? 'Dynamic version'
		: hasPrivateRepos
			? 'Private repository'
			: 'Not available';

	const notFound: PackageResult = {
		name,
		installedVersion,
		latestVersion: unavailableLabel,
		// Marcar siempre como upToDate para evitar que aparezca en safeUpdates
		// con un label no-versión como "Dynamic version" o "Private repository".
		upToDate: true,
		exactVersion,
		vulnerabilities: [],
		detectedByTool: false,
		ecosystem: ECOSYSTEM,
		majorVersionJump: 0,
		cveCheckFailed: false,
	};

	const controller = new AbortController();
	const timeoutId  = setTimeout(() => controller.abort(), 10_000);

	try {
		const query = `g:${encodeURIComponent(groupId)}+AND+a:${encodeURIComponent(artifactId)}`;
		const url   = `https://search.maven.org/solrsearch/select?q=${query}&rows=1&wt=json`;

		const response = await fetch(url, {
			headers: { 'User-Agent': 'ScanReq-VSCode-Extension/2.6 (https://scanreq.com)' },
			signal: controller.signal,
		});

		if (!response.ok) { return notFound; }

		const data = await response.json() as any;
		const docs: any[] = data?.response?.docs;
		if (!Array.isArray(docs) || docs.length === 0) { return notFound; }

		let latestVersion: string = docs[0]?.latestVersion;
		if (!latestVersion || typeof latestVersion !== 'string') { return notFound; }

		// Si latestVersion es una fecha legacy o un pre-release (milestone, alpha, beta, RC),
		// buscar la versión semver estable más reciente entre todas las versiones del artefacto.
		if (isDateVersion(latestVersion) || !isStableSemver(latestVersion)) {
			const semverLatest = await findLatestSemverVersion(groupId, artifactId);
			if (semverLatest) {
				latestVersion = semverLatest;
			}
		}

		// Si la versión instalada es mayor que la "latest" del registro,
		// el paquete está al día. Evita sugerir downgrades.
		if (installedVersion !== 'unknown' && compareSemver(installedVersion, latestVersion) > 0) {
			latestVersion = installedVersion;
		}

		const upToDate        = installedVersion !== 'unknown' && compareSemver(installedVersion, latestVersion) === 0;
		const majorVersionJump = calcMajorVersionJump(installedVersion, latestVersion);

		let vulnerabilities: Vulnerability[] = [];
		let cveCheckFailed = false;
		// Fix PN1: antes era `exactVersion || isPro`, lo cual buscaba CVEs en versiones
		// no exactas (e.g. versiones resueltas desde BOM o propiedades Maven que podrían
		// no ser la versión real instalada). Sin detectedByTool para Java (no lee el
		// lockfile de Maven/Gradle), solo buscamos CVEs para versiones exactas.
		if (exactVersion) {
			const cveResult = await checkCVEs(name, installedVersion, OSV_ECOSYSTEM);
			vulnerabilities = cveResult.vulnerabilities;
			cveCheckFailed = cveResult.failed;
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
			cveCheckFailed,
		};
	} catch {
		return notFound;
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Detecta si una versión tiene formato de fecha legacy (YYYYMMDD.HHMMSS o YYYYMMDD).
 */
function isDateVersion(version: string): boolean {
	return /^\d{8}(\.\d+)?$/.test(version);
}

/**
 * Verifica si una versión específica existe en Maven Central para un artefacto.
 * Usado por compatibility.ts para validar fixedVersions de OSV antes de sugerirlas.
 */
export async function versionExistsInMaven(
	groupId: string,
	artifactId: string,
	version: string
): Promise<boolean> {
	const controller = new AbortController();
	const timeoutId  = setTimeout(() => controller.abort(), 10_000);

	try {
		const query = `g:${encodeURIComponent(groupId)}+AND+a:${encodeURIComponent(artifactId)}+AND+v:${encodeURIComponent(version)}`;
		const url   = `https://search.maven.org/solrsearch/select?q=${query}&core=gav&rows=1&wt=json`;

		const response = await fetch(url, {
			headers: { 'User-Agent': 'ScanReq-VSCode-Extension/2.6 (https://scanreq.com)' },
			signal: controller.signal,
		});

		if (!response.ok) { return false; }

		const data = await response.json() as any;
		const docs: any[] = data?.response?.docs;
		return Array.isArray(docs) && docs.length > 0;
	} catch {
		return false;
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Busca la versión semver estable más reciente de un artefacto en Maven Central.
 */
async function findLatestSemverVersion(groupId: string, artifactId: string): Promise<string | null> {
	const controller = new AbortController();
	const timeoutId  = setTimeout(() => controller.abort(), 10_000);

	try {
		const query = `g:${encodeURIComponent(groupId)}+AND+a:${encodeURIComponent(artifactId)}`;
		const url   = `https://search.maven.org/solrsearch/select?q=${query}&core=gav&rows=50&wt=json`;

		const response = await fetch(url, {
			headers: { 'User-Agent': 'ScanReq-VSCode-Extension/2.6 (https://scanreq.com)' },
			signal: controller.signal,
		});

		if (!response.ok) { return null; }

		const data = await response.json() as any;
		const docs: any[] = data?.response?.docs;
		if (!Array.isArray(docs) || docs.length === 0) { return null; }

		const versions = docs
			.map((d: any) => d.v as string)
			.filter(v => v && isStableSemver(v));

		if (versions.length === 0) { return null; }

		versions.sort((a, b) => compareSemver(b, a));
		return versions[0];
	} catch {
		return null;
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Comprueba si una versión es semver estable (no fecha, no snapshot, no pre-release).
 */
function isStableSemver(version: string): boolean {
	if (isDateVersion(version)) { return false; }
	const lower = version.toLowerCase();
	if (lower.includes('snapshot'))                        { return false; }
	if (lower.includes('alpha'))                           { return false; }
	if (lower.includes('beta'))                            { return false; }
	if (lower.includes('-rc') && /\-rc\d*/i.test(lower))  { return false; }
	if (/\-m\d/i.test(lower))                             { return false; }
	if (lower.includes('-ea'))                             { return false; }
	if (lower.includes('-preview'))                        { return false; }
	if (lower.includes('-incubating'))                     { return false; }
	if (lower.includes('+'))                               { return false; }
	if (version === 'LATEST' || version === 'RELEASE')     { return false; }
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

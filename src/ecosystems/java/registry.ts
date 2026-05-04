import { PackageResult, EcosystemId, Vulnerability } from '../types';
import { checkCVEs } from '../../osv';
import { calcMajorVersionJump } from '../types';

const ECOSYSTEM: EcosystemId = 'java';
const OSV_ECOSYSTEM = 'Maven';

/**
 * Consulta Maven Central Search API para un artefacto Java.
 *
 * Endpoint:
 *   https://search.maven.org/solrsearch/select?q=g:{groupId}+AND+a:{artifactId}&rows=1&wt=json
 *
 * La respuesta incluye "latestVersion" en el primer resultado.
 *
 * El nombre del paquete en ScanReq es "groupId:artifactId"
 * (e.g. "org.springframework:spring-core") — mismo formato que en OSV.dev.
 */
export async function checkMaven(
	name: string,               // "groupId:artifactId"
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
		upToDate: false,
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
			headers: {
				'User-Agent': 'ScanReq-VSCode-Extension/2.4 (https://scanreq.com)',
			}
		});

		if (!response.ok) { return notFound; }

		const data = await response.json() as any;
		const docs: any[] = data?.response?.docs;

		if (!Array.isArray(docs) || docs.length === 0) { return notFound; }

		const latestVersion: string = docs[0]?.latestVersion;
		if (!latestVersion || typeof latestVersion !== 'string') { return notFound; }

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

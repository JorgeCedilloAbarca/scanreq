import { PackageResult, EcosystemId, Vulnerability } from '../types';
import { checkCVEs } from '../../osv';
import { calcMajorVersionJump } from '../types';

const ECOSYSTEM: EcosystemId = 'ruby';
const OSV_ECOSYSTEM = 'RubyGems';

/**
 * Consulta RubyGems API para una gem.
 *
 * Endpoint: https://rubygems.org/api/v1/gems/{gem}.json
 *
 * La respuesta incluye "version" con el latest estable.
 */
export async function checkRubyGem(
	name: string,
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
		cveCheckFailed: false,
	};

	const controller = new AbortController();
	const timeoutId  = setTimeout(() => controller.abort(), 10_000);

	try {
		const url = `https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`;
		const response = await fetch(url, {
			headers: { 'User-Agent': 'ScanReq-VSCode-Extension/2.6 (https://scanreq.com)' },
			signal: controller.signal,
		});

		if (!response.ok) { return notFound; }

		const data = await response.json() as any;

		const latestVersion: string = data?.version;
		if (!latestVersion || typeof latestVersion !== 'string') { return notFound; }

		const upToDate = installedVersion !== 'unknown' && installedVersion === latestVersion;
		const majorVersionJump = calcMajorVersionJump(installedVersion, latestVersion);

		let vulnerabilities: Vulnerability[] = [];
		let cveCheckFailed = false;
		if (exactVersion || isPro) {
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

import { checkCVEs } from '../../osv';
import { PackageResult, calcMajorVersionJump } from '../types';
import { getInstalledVersionFromNodeModules } from './nodetools';

export async function checkNpm(
	packageName: string,
	specifiedVersion: string,
	exactVersion: boolean,
	isPro: boolean
): Promise<PackageResult> {
	let effectiveVersion = specifiedVersion;
	let detectedByTool = false;

	// Pro: si la versión no es exacta, intentar detectar la real desde node_modules
	if (isPro && !exactVersion) {
		const localVersion = await getInstalledVersionFromNodeModules(packageName);
		if (localVersion) {
			effectiveVersion = localVersion;
			detectedByTool = true;
		}
	}

	try {
		// npm registry: GET https://registry.npmjs.org/{package}/latest
		const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
			headers: {
				// npm recomienda un User-Agent identificativo
				'User-Agent': 'scanreq-vscode/2.1'
			}
		});

		if (!response.ok) {
			throw new Error(`npm registry responded ${response.status}`);
		}

		const data = await response.json() as any;
		const latestVersion: string = data.version ?? 'unknown';

		// CVEs: en Free solo para versiones exactas. En Pro también para versiones detectadas en node_modules
		const canCheckCVEs = exactVersion || (isPro && detectedByTool);
		const vulnerabilities = canCheckCVEs && effectiveVersion !== 'unknown'
			? await checkCVEs(packageName, effectiveVersion, 'npm')
			: [];

		return {
			name: packageName,
			installedVersion: effectiveVersion,
			latestVersion,
			upToDate: effectiveVersion !== 'unknown'
				? effectiveVersion === latestVersion
				: false,
			exactVersion,
			vulnerabilities,
			detectedByTool,
			majorVersionJump: calcMajorVersionJump(effectiveVersion, latestVersion),
			ecosystem: 'node'
		};
	} catch {
		return {
			name: packageName,
			installedVersion: effectiveVersion,
			latestVersion: 'Not found',
			upToDate: false,
			exactVersion,
			vulnerabilities: [],
			detectedByTool,
			majorVersionJump: 0,
			ecosystem: 'node'
		};
	}
}

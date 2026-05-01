import { checkCVEs } from '../../osv';
import { PackageResult } from '../types';
import { getInstalledVersion } from './pip';

export async function checkPyPI(
	packageName: string,
	installedVersion: string,
	exactVersion: boolean,
	isPro: boolean
): Promise<PackageResult> {
	const cleanName = packageName.replace(/\[.*?\]/g, '').trim();
	let effectiveVersion = installedVersion;
	let detectedByTool = false;

	// Pro: si la versión no es exacta, intentar detectar la versión real instalada
	if (isPro && !exactVersion) {
		const pipVersion = await getInstalledVersion(cleanName);
		if (pipVersion) {
			effectiveVersion = pipVersion;
			detectedByTool = true;
		}
	}

	try {
		const response = await fetch(`https://pypi.org/pypi/${cleanName}/json`);
		const data = await response.json() as any;
		const latestVersion = data.info.version;

		// CVEs: en Free solo para exactas. En Pro también para versiones detectadas por pip
		const canCheckCVEs = exactVersion || (isPro && detectedByTool);
		const vulnerabilities = canCheckCVEs
			? await checkCVEs(cleanName, effectiveVersion, 'PyPI')
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
			ecosystem: 'python'
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
			ecosystem: 'python'
		};
	}
}

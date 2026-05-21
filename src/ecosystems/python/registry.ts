import { checkCVEs } from '../../osv';
import { PackageResult, calcMajorVersionJump } from '../types';
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

	// Timeout de 10 s — evita que un PyPI lento bloquee el scan indefinidamente
	const controller = new AbortController();
	const timeoutId  = setTimeout(() => controller.abort(), 10_000);

	try {
		const response = await fetch(`https://pypi.org/pypi/${cleanName}/json`, {
			signal: controller.signal,
		});
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
			majorVersionJump: calcMajorVersionJump(effectiveVersion, latestVersion),
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
			majorVersionJump: 0,
			ecosystem: 'python'
		};
	} finally {
		clearTimeout(timeoutId);
	}
}

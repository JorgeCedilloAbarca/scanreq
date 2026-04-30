import { checkCVEs, Vulnerability } from './osv';
import { t } from './i18n';
import { getInstalledVersion } from './pip';

export interface PackageInfo {
	name: string;
	installedVersion: string;
	latestVersion: string;
	upToDate: boolean;
	exactVersion: boolean;
	vulnerabilities: Vulnerability[];
	detectedByPip: boolean; // true si la versión instalada fue detectada con pip show
}

export async function checkPyPI(
	packageName: string,
	installedVersion: string,
	exactVersion: boolean,
	isPro: boolean
): Promise<PackageInfo> {
	const cleanName = packageName.replace(/\[.*?\]/g, '').trim();
	let effectiveVersion = installedVersion;
	let detectedByPip = false;

	// Pro: si la versión no es exacta, intentar detectar la versión real instalada
	if (isPro && !exactVersion) {
		const pipVersion = await getInstalledVersion(cleanName);
		if (pipVersion) {
			effectiveVersion = pipVersion;
			detectedByPip = true;
		}
	}

	try {
		const response = await fetch(`https://pypi.org/pypi/${cleanName}/json`);
		const data = await response.json() as any;
		const latestVersion = data.info.version;

		// CVEs: en Free solo para exactas. En Pro también para versiones detectadas por pip
		const canCheckCVEs = exactVersion || (isPro && detectedByPip);
		const vulnerabilities = canCheckCVEs
			? await checkCVEs(cleanName, effectiveVersion)
			: [];

		return {
			name: packageName,
			installedVersion: effectiveVersion,
			latestVersion,
			upToDate: effectiveVersion !== 'desconocida' && effectiveVersion !== 'unknown'
				? effectiveVersion === latestVersion
				: false,
			exactVersion,
			vulnerabilities,
			detectedByPip
		};
	} catch {
		return {
			name: packageName,
			installedVersion: effectiveVersion,
			latestVersion: t('notFound'),
			upToDate: false,
			exactVersion,
			vulnerabilities: [],
			detectedByPip
		};
	}
}
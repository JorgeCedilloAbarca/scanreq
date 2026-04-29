import { checkCVEs, Vulnerability } from './osv';
import { t } from './i18n';

export interface PackageInfo {
	name: string;
	installedVersion: string;
	latestVersion: string;
	upToDate: boolean;
	exactVersion: boolean;
	vulnerabilities: Vulnerability[];
}

export async function checkPyPI(packageName: string, installedVersion: string, exactVersion: boolean): Promise<PackageInfo> {
	const cleanName = packageName.replace(/\[.*?\]/g, '').trim();
	try {
		const response = await fetch(`https://pypi.org/pypi/${cleanName}/json`);
		const data = await response.json() as any;
		const latestVersion = data.info.version;

		const vulnerabilities = exactVersion
			? await checkCVEs(cleanName, installedVersion)
			: [];

		return {
			name: packageName,
			installedVersion,
			latestVersion,
			upToDate: exactVersion ? installedVersion === latestVersion : false,
			exactVersion,
			vulnerabilities
		};
	} catch {
		return {
			name: packageName,
			installedVersion,
			latestVersion: t('notFound'),
			upToDate: false,
			exactVersion,
			vulnerabilities: []
		};
	}
}

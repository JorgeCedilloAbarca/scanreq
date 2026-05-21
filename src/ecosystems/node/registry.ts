import { checkCVEs } from '../../osv';
import { PackageResult, calcMajorVersionJump } from '../types';
import { getInstalledVersionFromNodeModules } from './nodetools';

export async function checkNpm(
	packageName: string,
	specifiedVersion: string,
	exactVersion: boolean,
	isPro: boolean,
	packageDir?: string
): Promise<PackageResult> {
	let effectiveVersion = specifiedVersion;
	let detectedByTool = false;

	// Pro: si la versión no es exacta, intentar detectar la real desde node_modules o lockfile
	// packageDir es la carpeta del package.json — en monorepos es distinta al workspace root
	if (isPro && !exactVersion) {
		const localVersion = await getInstalledVersionFromNodeModules(packageName, packageDir);
		if (localVersion) {
			effectiveVersion = localVersion;
			detectedByTool = true;
		}
	}

	const controller = new AbortController();
	const timeoutId  = setTimeout(() => controller.abort(), 10_000);

	try {
		const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
			headers: { 'User-Agent': 'scanreq-vscode/2.5' },
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`npm registry responded ${response.status}`);
		}

		const data = await response.json() as any;
		const latestVersion: string = data.version ?? 'unknown';

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
	} finally {
		clearTimeout(timeoutId);
	}
}

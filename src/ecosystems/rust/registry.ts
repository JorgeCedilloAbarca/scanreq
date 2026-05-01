import { checkCVEs } from '../../osv';
import { PackageResult } from '../types';

/**
 * crates.io requiere un User-Agent descriptivo por política.
 * https://crates.io/policies#crawlers
 */
const CRATES_USER_AGENT = 'scanreq-vscode/2.2 (https://scanreq.com)';

export async function checkCrate(
	packageName: string,
	specifiedVersion: string,
	exactVersion: boolean,
	isPro: boolean
): Promise<PackageResult> {
	const effectiveVersion = specifiedVersion;

	try {
		// crates.io API: GET https://crates.io/api/v1/crates/{name}
		const response = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(packageName)}`, {
			headers: {
				'User-Agent': CRATES_USER_AGENT,
				'Accept': 'application/json'
			}
		});

		if (!response.ok) {
			throw new Error(`crates.io responded ${response.status}`);
		}

		const data = await response.json() as any;
		const latestVersion: string = data.crate?.newest_version ?? 'unknown';

		// CVEs: en Free solo para versiones exactas
		const canCheckCVEs = exactVersion || isPro;
		const vulnerabilities = canCheckCVEs && effectiveVersion !== 'unknown'
			? await checkCVEs(packageName, effectiveVersion, 'crates.io')
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
			detectedByTool: false,  // Rust no necesita detección via tool — Cargo.toml siempre tiene versión
			ecosystem: 'rust'
		};
	} catch {
		return {
			name: packageName,
			installedVersion: effectiveVersion,
			latestVersion: 'Not found',
			upToDate: false,
			exactVersion,
			vulnerabilities: [],
			detectedByTool: false,
			ecosystem: 'rust'
		};
	}
}

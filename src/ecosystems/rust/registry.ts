import { checkCVEs } from '../../osv';
import { PackageResult, calcMajorVersionJump } from '../types';

/**
 * crates.io requiere un User-Agent descriptivo por política.
 * https://crates.io/policies#crawlers
 */
const CRATES_USER_AGENT = 'scanreq-vscode/2.6 (https://scanreq.com)';

export async function checkCrate(
	packageName: string,
	specifiedVersion: string,
	exactVersion: boolean,
	isPro: boolean
): Promise<PackageResult> {
	const effectiveVersion = specifiedVersion;

	const controller = new AbortController();
	const timeoutId  = setTimeout(() => controller.abort(), 10_000);

	try {
		// crates.io API: GET https://crates.io/api/v1/crates/{name}
		const response = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(packageName)}`, {
			headers: {
				'User-Agent': CRATES_USER_AGENT,
				'Accept': 'application/json'
			},
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`crates.io responded ${response.status}`);
		}

		const data = await response.json() as any;
		const latestVersion: string = data.crate?.newest_version ?? 'unknown';

		// CVEs: en Free solo para versiones exactas
		// Fix PN1: antes era `exactVersion || isPro`, lo cual buscaba CVEs en versiones
		// estimadas del spec (e.g. "1.0" extraído de `serde = { version = "^1.0" }`).
		// En Rust, el formato tabla de Cargo siempre tiene exactVersion: false porque
		// ^ es el operador implícito. Sin Cargo.lock, no podemos saber la versión real.
		// Ahora seguimos el mismo patrón de Python/Node: solo exactas o detectadas por tool.
		const canCheckCVEs = exactVersion;
		let cveCheckFailed = false;

		let vulnerabilities: import("../types").Vulnerability[];
		if (canCheckCVEs && effectiveVersion !== 'unknown') {
			const cveResult = await checkCVEs(packageName, effectiveVersion, 'crates.io');
			vulnerabilities = cveResult.vulnerabilities;
			cveCheckFailed = cveResult.failed;
		} else {
			vulnerabilities = [];
		}

		return {
			name: packageName,
			installedVersion: effectiveVersion,
			latestVersion,
			upToDate: effectiveVersion !== 'unknown'
				? effectiveVersion === latestVersion
				: false,
			exactVersion,
			vulnerabilities,
			detectedByTool: false,
			majorVersionJump: calcMajorVersionJump(effectiveVersion, latestVersion),
			ecosystem: 'rust',
			cveCheckFailed,
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
			majorVersionJump: 0,
			ecosystem: 'rust',
			cveCheckFailed: false,
		};
	} finally {
		clearTimeout(timeoutId);
	}
}

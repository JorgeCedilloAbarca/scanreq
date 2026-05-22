import { checkCVEs } from '../../osv';
import { PackageResult, calcMajorVersionJump } from '../types';

export async function checkGoModule(
	moduleName: string,
	specifiedVersion: string,
	exactVersion: boolean,
	isPro: boolean
): Promise<PackageResult> {
	// Timeout de 10 s — Go proxy puede tardar con módulos poco accedidos
	const controller = new AbortController();
	const timeoutId  = setTimeout(() => controller.abort(), 10_000);

	try {
		// Go module proxy: GET https://proxy.golang.org/{module}/@latest
		// El nombre del módulo debe ir en lowercase para el proxy
		const encodedModule = encodeModulePath(moduleName);
		const response = await fetch(
			`https://proxy.golang.org/${encodedModule}/@latest`,
			{
				headers: { 'Accept': 'application/json' },
				signal: controller.signal,
			}
		);

		// Distinguir módulo privado/no indexado (410 Gone o 404)
		// de errores de red o del proxy (5xx).
		if (!response.ok) {
			const isPrivateOrUnknown = response.status === 404 || response.status === 410;
			const latestVersion = isPrivateOrUnknown ? 'Private / not indexed' : 'Not found';
			return {
				name: moduleName,
				installedVersion: specifiedVersion,
				latestVersion,
				upToDate: isPrivateOrUnknown, // no mostrar como desactualizado si es privado
				exactVersion,
				vulnerabilities: [],
				detectedByTool: false,
				majorVersionJump: 0,
				ecosystem: 'go',
				cveCheckFailed: false,
			};
		}

		const data = await response.json() as any;

		// El proxy devuelve la versión con "v" — la eliminamos para normalizar
		const latestRaw: string = data.Version ?? 'unknown';
		const latestVersion = latestRaw.startsWith('v') ? latestRaw.slice(1) : latestRaw;

		// En Go todas las versiones de go.mod son exactas por definición,
		// así que en Free canCheckCVEs siempre será true mientras exactVersion=true.
		const canCheckCVEs = exactVersion || isPro;
		let cveCheckFailed = false;

		let vulnerabilities: import("../types").Vulnerability[];
		if (canCheckCVEs && specifiedVersion !== 'unknown') {
			const cveResult = await checkCVEs(moduleName, `v${specifiedVersion}`, 'Go');
			vulnerabilities = cveResult.vulnerabilities;
			cveCheckFailed = cveResult.failed;
		} else {
			vulnerabilities = [];
		}

		return {
			name: moduleName,
			installedVersion: specifiedVersion,
			latestVersion,
			upToDate: specifiedVersion !== 'unknown'
				? specifiedVersion === latestVersion
				: false,
			exactVersion,
			vulnerabilities,
			detectedByTool: false,
			majorVersionJump: calcMajorVersionJump(specifiedVersion, latestVersion),
			ecosystem: 'go',
			cveCheckFailed,
		};
	} catch (err: any) {
		if (err?.name === 'AbortError') {
			console.warn(`ScanReq: Go proxy timed out for ${moduleName}`);
		}
		return {
			name: moduleName,
			installedVersion: specifiedVersion,
			latestVersion: 'Not found',
			upToDate: false,
			exactVersion,
			vulnerabilities: [],
			detectedByTool: false,
			majorVersionJump: 0,
			ecosystem: 'go',
			cveCheckFailed: false,
		};
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * El Go module proxy requiere que las letras mayúsculas en rutas de módulos
 * se codifiquen como "!lowercase".
 * Ejemplo: "github.com/BurntSushi/toml" → "github.com/!burnt!sushi/toml"
 */
function encodeModulePath(modulePath: string): string {
	return modulePath.replace(/[A-Z]/g, c => `!${c.toLowerCase()}`);
}

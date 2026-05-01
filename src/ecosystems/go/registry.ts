import { checkCVEs } from '../../osv';
import { PackageResult } from '../types';

export async function checkGoModule(
	moduleName: string,
	specifiedVersion: string,
	exactVersion: boolean,
	isPro: boolean
): Promise<PackageResult> {
	try {
		// Go module proxy: GET https://proxy.golang.org/{module}/@latest
		// El nombre del módulo debe ir en lowercase para el proxy
		const encodedModule = encodeModulePath(moduleName);
		const response = await fetch(
			`https://proxy.golang.org/${encodedModule}/@latest`,
			{ headers: { 'Accept': 'application/json' } }
		);

		if (!response.ok) {
			throw new Error(`Go proxy responded ${response.status}`);
		}

		const data = await response.json() as any;

		// El proxy devuelve la versión con "v" — la eliminamos para normalizar
		const latestRaw: string = data.Version ?? 'unknown';
		const latestVersion = latestRaw.startsWith('v') ? latestRaw.slice(1) : latestRaw;

		// CVEs: en Free solo para versiones exactas (en Go siempre lo son)
		const vulnerabilities = specifiedVersion !== 'unknown'
			? await checkCVEs(moduleName, `v${specifiedVersion}`, 'Go')
			: [];

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
			ecosystem: 'go'
		};
	} catch {
		return {
			name: moduleName,
			installedVersion: specifiedVersion,
			latestVersion: 'Not found',
			upToDate: false,
			exactVersion,
			vulnerabilities: [],
			detectedByTool: false,
			ecosystem: 'go'
		};
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

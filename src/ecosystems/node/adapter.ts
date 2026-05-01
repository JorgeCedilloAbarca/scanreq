import { EcosystemAdapter, ScanResult } from '../types';
import { parsePackageJson } from './parser';
import { checkNpm } from './registry';
import { checkNodeModulesAvailability } from './nodetools';

export const nodeAdapter: EcosystemAdapter = {
	id: 'node',
	displayName: 'Node.js',
	filePatterns: ['package.json'],

	async scan(filePath: string, isPro: boolean): Promise<ScanResult> {
		const parsed = parsePackageJson(filePath);

		// Consultar npm registry para todos los paquetes en paralelo
		const packages = await Promise.all(
			parsed.map(pkg => checkNpm(pkg.name, pkg.version, pkg.exactVersion, isPro))
		);

		// Pro: Node.js no tiene análisis de compatibilidad cruzada implementado todavía (v2.2+).
		// Solo mostramos la sección si node_modules no existe — para avisar al usuario.
		// Si node_modules existe, devolvemos null para no mostrar una sección vacía engañosa.
		let compatReport = null;
		if (isPro) {
			const nodeModulesAvailable = checkNodeModulesAvailability();
			if (!nodeModulesAvailable) {
				compatReport = {
					conflicts: [],
					safeUpdates: [],
					toolUnavailable: true
				};
			}
		}

		return {
			ecosystem: 'node',
			filePath,
			packages,
			compatReport
		};
	}
};

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

		// Pro: aviso si node_modules no existe (versión detectada por tool no disponible)
		let compatReport = null;
		if (isPro) {
			const nodeModulesAvailable = checkNodeModulesAvailability();
			compatReport = {
				conflicts: [],
				safeUpdates: [],
				toolUnavailable: !nodeModulesAvailable
			};
		}

		return {
			ecosystem: 'node',
			filePath,
			packages,
			compatReport
		};
	}
};

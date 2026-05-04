import { EcosystemAdapter, ScanResult } from '../types';
import { parsePackageJson } from './parser';
import { checkNpm } from './registry';
import { checkNodeModulesAvailability, clearLockfileCache } from './nodetools';
import { runCompatibilityAnalysis } from './compatibility';

export const nodeAdapter: EcosystemAdapter = {
	id: 'node',
	displayName: 'Node.js',
	filePatterns: ['package.json'],

	async scan(filePath: string, isPro: boolean): Promise<ScanResult> {
		// Limpiar caché de lockfile al inicio de cada scan
		// para que no persistan datos de un scan anterior o de otro workspace
		clearLockfileCache();

		const parsed = parsePackageJson(filePath);

		const packages = await Promise.all(
			parsed.map(pkg => checkNpm(pkg.name, pkg.version, pkg.exactVersion, isPro))
		);

		let compatReport = null;
		if (isPro) {
			const nodeModulesAvailable = checkNodeModulesAvailability();
			compatReport = await runCompatibilityAnalysis(packages, !nodeModulesAvailable);
		}

		return {
			ecosystem: 'node',
			filePath,
			packages,
			compatReport,
		};
	}
};

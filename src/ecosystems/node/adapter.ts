import * as path from 'path';
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
		clearLockfileCache();

		// Directorio del package.json — en monorepos es distinto al workspace root
		const packageDir = path.dirname(filePath);

		const parsed = parsePackageJson(filePath);

		const packages = await Promise.all(
			parsed.map(pkg => checkNpm(pkg.name, pkg.version, pkg.exactVersion, isPro, packageDir))
		);

		let compatReport = null;
		if (isPro) {
			// Verificar disponibilidad de node_modules/lockfile en la carpeta del package.json
			const nodeModulesAvailable = checkNodeModulesAvailability(packageDir);
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

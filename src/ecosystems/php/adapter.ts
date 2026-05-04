import { EcosystemAdapter, ScanResult } from '../types';
import { parseComposerJson } from './parser';
import { checkPackagist } from './registry';
import { runCompatibilityAnalysis } from './compatibility';

export const phpAdapter: EcosystemAdapter = {
	id: 'php',
	displayName: 'PHP',
	filePatterns: ['composer.json'],

	async scan(filePath: string, isPro: boolean): Promise<ScanResult> {
		const parsed = parseComposerJson(filePath);

		// Packagist no tiene rate limiting estricto documentado,
		// pero limitamos a 10 requests en paralelo por cortesía
		const CONCURRENCY = 10;
		const packages = [];
		for (let i = 0; i < parsed.length; i += CONCURRENCY) {
			const batch = parsed.slice(i, i + CONCURRENCY);
			const results = await Promise.all(
				batch.map(pkg => checkPackagist(pkg.name, pkg.version, pkg.exactVersion, isPro))
			);
			packages.push(...results);
		}

		let compatReport = null;
		if (isPro) {
			compatReport = await runCompatibilityAnalysis(packages, false);
		}

		return {
			ecosystem: 'php',
			filePath,
			packages,
			compatReport,
		};
	}
};

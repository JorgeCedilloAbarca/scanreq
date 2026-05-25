import { EcosystemAdapter, ScanResult } from '../types';
import { parseGoMod } from './parser';
import { checkGoModule } from './registry';
import { runCompatibilityAnalysis } from './compatibility';
import { checkGoAvailability, clearGoCache } from './gotools';

export const goAdapter: EcosystemAdapter = {
	id: 'go',
	displayName: 'Go',
	filePatterns: ['go.mod'],

	async scan(filePath: string, isPro: boolean): Promise<ScanResult> {
		// Fix R1: limpiar caché de Go al inicio de cada scan
		clearGoCache();

		const parsed = parseGoMod(filePath);

		// Go proxy no tiene rate limiting estricto pero limitamos por cortesía
		const CONCURRENCY = 15;
		const packages = [];
		for (let i = 0; i < parsed.length; i += CONCURRENCY) {
			const batch = parsed.slice(i, i + CONCURRENCY);
			const results = await Promise.all(
				batch.map(pkg => checkGoModule(pkg.name, pkg.version, pkg.exactVersion, isPro))
			);
			packages.push(...results);
		}

		let compatReport = null;
		if (isPro) {
			const goAvail = await checkGoAvailability();
			compatReport = await runCompatibilityAnalysis(
				packages,
				filePath,
				!goAvail.available
			);
		}

		return {
			ecosystem: 'go',
			filePath,
			packages,
			compatReport,
		};
	}
};

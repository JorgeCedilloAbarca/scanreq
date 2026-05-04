import { EcosystemAdapter, ScanResult } from '../types';
import { parseGoMod } from './parser';
import { checkGoModule } from './registry';
import { runCompatibilityAnalysis } from './compatibility';
import { checkGoAvailability } from './gotools';

export const goAdapter: EcosystemAdapter = {
	id: 'go',
	displayName: 'Go',
	filePatterns: ['go.mod'],

	async scan(filePath: string, isPro: boolean): Promise<ScanResult> {
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
			// Pasamos filePath para que go mod graph pueda ejecutarse en el directorio correcto.
			// toolUnavailable refleja si Go no está en PATH.
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

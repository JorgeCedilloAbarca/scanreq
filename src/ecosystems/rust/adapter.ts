import { EcosystemAdapter, ScanResult } from '../types';
import { parseCargoToml } from './parser';
import { checkCrate } from './registry';
import { runCompatibilityAnalysis } from './compatibility';

export const rustAdapter: EcosystemAdapter = {
	id: 'rust',
	displayName: 'Rust',
	filePatterns: ['Cargo.toml'],

	async scan(filePath: string, isPro: boolean): Promise<ScanResult> {
		const parsed = parseCargoToml(filePath);

		// crates.io tiene rate limiting — limitamos a 10 requests en paralelo
		const CONCURRENCY = 10;
		const packages = [];
		for (let i = 0; i < parsed.length; i += CONCURRENCY) {
			const batch = parsed.slice(i, i + CONCURRENCY);
			const results = await Promise.all(
				batch.map(pkg => checkCrate(pkg.name, pkg.version, pkg.exactVersion, isPro))
			);
			packages.push(...results);
		}

		let compatReport = null;
		if (isPro) {
			compatReport = await runCompatibilityAnalysis(packages, false);
		}

		return {
			ecosystem: 'rust',
			filePath,
			packages,
			compatReport
		};
	}
};

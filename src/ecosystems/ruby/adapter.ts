import { EcosystemAdapter, ScanResult } from '../types';
import { parseGemfile } from './parser';
import { checkRubyGem } from './registry';
import { runCompatibilityAnalysis } from './compatibility';

export const rubyAdapter: EcosystemAdapter = {
	id: 'ruby',
	displayName: 'Ruby',
	filePatterns: ['Gemfile'],

	async scan(filePath: string, isPro: boolean): Promise<ScanResult> {
		const parsed = parseGemfile(filePath);

		// RubyGems no impone rate limits duros, pero limitamos por cortesía
		const CONCURRENCY = 10;
		const packages = [];
		for (let i = 0; i < parsed.length; i += CONCURRENCY) {
			const batch = parsed.slice(i, i + CONCURRENCY);
			const results = await Promise.all(
				batch.map(pkg => checkRubyGem(pkg.name, pkg.version, pkg.exactVersion, isPro))
			);
			packages.push(...results);
		}

		let compatReport = null;
		if (isPro) {
			compatReport = await runCompatibilityAnalysis(packages, false);
		}

		return {
			ecosystem: 'ruby',
			filePath,
			packages,
			compatReport,
		};
	}
};

import { EcosystemAdapter, ScanResult } from '../types';
import { readFileWithEncoding, parseRequirements } from './parser';
import { checkPyPI } from './registry';
import { checkPipAvailability } from './pip';
import { runCompatibilityAnalysis } from './compatibility';

export const pythonAdapter: EcosystemAdapter = {
	id: 'python',
	displayName: 'Python',
	filePatterns: ['requirements.txt'],

	async scan(filePath: string, isPro: boolean): Promise<ScanResult> {
		const content = readFileWithEncoding(filePath);
		const parsed = parseRequirements(content);

		const packages = await Promise.all(
			parsed.map(pkg => checkPyPI(pkg.name, pkg.version, pkg.exactVersion, isPro))
		);

		let compatReport = null;
		if (isPro) {
			const pip = await checkPipAvailability();
			compatReport = await runCompatibilityAnalysis(packages, !pip.available);
		}

		return {
			ecosystem: 'python',
			filePath,
			packages,
			compatReport
		};
	}
};

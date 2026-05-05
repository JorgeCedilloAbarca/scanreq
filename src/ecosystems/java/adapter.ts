import { EcosystemAdapter, ScanResult } from '../types';
import { parsePomXmlAsync } from './parser';
import { checkMaven } from './registry';
import { runCompatibilityAnalysis } from './compatibility';

export const javaAdapter: EcosystemAdapter = {
	id: 'java',
	displayName: 'Java (Maven)',
	filePatterns: ['pom.xml'],

	async scan(filePath: string, isPro: boolean): Promise<ScanResult> {
		// parsePomXmlAsync resuelve versiones del <parent> Spring Boot via BOM
		const parsed = await parsePomXmlAsync(filePath);

		const CONCURRENCY = 10;
		const packages = [];
		for (let i = 0; i < parsed.length; i += CONCURRENCY) {
			const batch = parsed.slice(i, i + CONCURRENCY);
			const results = await Promise.all(
				batch.map(pkg => checkMaven(
					pkg.name,
					pkg.groupId,
					pkg.artifactId,
					pkg.version,
					pkg.exactVersion,
					isPro
				))
			);
			packages.push(...results);
		}

		let compatReport = null;
		if (isPro) {
			compatReport = await runCompatibilityAnalysis(packages, false);
		}

		return {
			ecosystem: 'java',
			filePath,
			packages,
			compatReport,
		};
	}
};

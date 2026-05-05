import { EcosystemAdapter, ScanResult } from '../types';
import { parseBuildGradleAsync } from './parser';
import { checkMaven } from '../java/registry';
import { runCompatibilityAnalysis } from '../java/compatibility';

export const gradleAdapter: EcosystemAdapter = {
	id: 'gradle',
	displayName: 'Java (Gradle)',
	filePatterns: ['build.gradle', 'build.gradle.kts'],

	async scan(filePath: string, isPro: boolean): Promise<ScanResult> {
		// parseBuildGradleAsync resuelve versiones de BOMs via Maven Central
		const parsed = await parseBuildGradleAsync(filePath);

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
			ecosystem: 'gradle',
			filePath,
			packages,
			compatReport,
		};
	}
};

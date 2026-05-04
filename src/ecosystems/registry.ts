import { EcosystemAdapter } from './types';
import { pythonAdapter } from './python/adapter';
import { nodeAdapter }   from './node/adapter';
import { rustAdapter }   from './rust/adapter';
import { goAdapter }     from './go/adapter';
import { phpAdapter }    from './php/adapter';
import { rubyAdapter }   from './ruby/adapter';
import { javaAdapter }   from './java/adapter';
import { gradleAdapter } from './gradle/adapter';

const adapters: EcosystemAdapter[] = [
	pythonAdapter,
	nodeAdapter,
	rustAdapter,
	goAdapter,
	phpAdapter,
	rubyAdapter,
	javaAdapter,
	gradleAdapter,
];

const patternMap = new Map<string, EcosystemAdapter>();
for (const adapter of adapters) {
	for (const pattern of adapter.filePatterns) {
		patternMap.set(pattern, adapter);
	}
}

export function getAdapterForFile(fileName: string): EcosystemAdapter | null {
	return patternMap.get(fileName) ?? null;
}

export function getAllWatchPatterns(): string[] {
	return Array.from(patternMap.keys());
}

export function getAllAdapters(): EcosystemAdapter[] {
	return [...adapters];
}

import { EcosystemAdapter } from './types';
import { pythonAdapter } from './python/adapter';
import { nodeAdapter } from './node/adapter';
import { rustAdapter } from './rust/adapter';
import { goAdapter }   from './go/adapter';
// import { phpAdapter }  from './php/adapter';    ← v2.3
// import { rubyAdapter } from './ruby/adapter';   ← v2.3

// Lista ordenada de adapters activos.
// El orden determina qué ecosistema aparece primero en el panel si hay varios.
const adapters: EcosystemAdapter[] = [
	pythonAdapter,
	nodeAdapter,
	rustAdapter,
	goAdapter,
];

// Mapa de patrón de archivo → adapter para búsqueda rápida
const patternMap = new Map<string, EcosystemAdapter>();
for (const adapter of adapters) {
	for (const pattern of adapter.filePatterns) {
		patternMap.set(pattern, adapter);
	}
}

/**
 * Devuelve el adapter correspondiente a un nombre de archivo, o null si no hay ninguno registrado.
 * Ejemplo: getAdapterForFile('requirements.txt') → pythonAdapter
 */
export function getAdapterForFile(fileName: string): EcosystemAdapter | null {
	return patternMap.get(fileName) ?? null;
}

/**
 * Devuelve todos los patrones de archivo monitorizados por algún adapter.
 * Usado por el watcher de extension.ts para saber qué archivos observar.
 */
export function getAllWatchPatterns(): string[] {
	return Array.from(patternMap.keys());
}

/**
 * Devuelve todos los adapters activos.
 */
export function getAllAdapters(): EcosystemAdapter[] {
	return [...adapters];
}

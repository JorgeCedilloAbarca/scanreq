import { EcosystemAdapter, ScanResult } from '../types';
import { parseCargoToml, readCargoLock } from './parser';
import { checkCrate } from './registry';
import { runCompatibilityAnalysis } from './compatibility';

export const rustAdapter: EcosystemAdapter = {
	id: 'rust',
	displayName: 'Rust',
	filePatterns: ['Cargo.toml'],

	async scan(filePath: string, isPro: boolean): Promise<ScanResult> {
		const parsed = parseCargoToml(filePath);

		// Leer Cargo.lock subiendo desde el directorio del Cargo.toml.
		// En workspaces, el lock está en la raíz y cubre todos los sub-crates.
		// Si no hay lock (proyecto nuevo o .gitignore), el mapa queda vacío
		// y el comportamiento es idéntico al anterior.
		const lockVersions = readCargoLock(filePath);

		// Enriquecer los paquetes con versiones del lock cuando estén disponibles.
		// Un paquete con specifier "^2.1" en Cargo.toml puede resolverse a "2.1.1"
		// en Cargo.lock — eso nos da exactVersion: true y permite CVE scanning real.
		const enriched = parsed.map(pkg => {
			const locked = lockVersions.get(pkg.name);
			if (locked) {
				return { ...pkg, version: locked, exactVersion: true };
			}
			return pkg;
		});

		// crates.io tiene rate limiting — limitamos a 10 requests en paralelo
		const CONCURRENCY = 10;
		const packages = [];
		for (let i = 0; i < enriched.length; i += CONCURRENCY) {
			const batch = enriched.slice(i, i + CONCURRENCY);
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

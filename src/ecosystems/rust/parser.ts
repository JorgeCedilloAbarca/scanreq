import * as fs from 'fs';

export interface ParsedPackage {
	name: string;
	version: string;
	exactVersion: boolean;
	section: 'dependencies' | 'dev-dependencies' | 'build-dependencies';
}

function isExactVersion(version: string): boolean {
	// Exacta: solo dígitos y puntos, sin prefijos de rango
	return /^\d+(\.\d+)*$/.test(version.trim());
}

function cleanVersion(version: string): string {
	// Cargo usa ^ por defecto (compatible release), también ~, >=, =, *
	// "^1.2.3" → "1.2.3", "~1.2" → "1.2", "=1.0.0" → "1.0.0"
	return version.replace(/^[\^~=*\s]+/, '').split(',')[0].trim();
}

/**
 * Parser minimalista de TOML para Cargo.toml.
 * Soporta los formatos más comunes:
 *   serde = "1.0"
 *   serde = { version = "1.0", features = ["derive"] }
 *   serde = { workspace = true }  ← ignorado (workspace dependency)
 */
export function parseCargoToml(filePath: string): ParsedPackage[] {
	const content = fs.readFileSync(filePath, 'utf8');
	const lines = content.split('\n');
	const results: ParsedPackage[] = [];

	let currentSection: ParsedPackage['section'] | null = null;

	for (const rawLine of lines) {
		const line = rawLine.trim();

		// Detectar sección
		if (line === '[dependencies]') {
			currentSection = 'dependencies';
			continue;
		}
		if (line === '[dev-dependencies]') {
			currentSection = 'dev-dependencies';
			continue;
		}
		if (line === '[build-dependencies]') {
			currentSection = 'build-dependencies';
			continue;
		}
		// Cualquier otra sección — salir del contexto de dependencias
		if (line.startsWith('[') && !line.startsWith('#')) {
			if (
				!line.includes('dependencies]') &&
				!line.startsWith('[profile') &&
				!line.startsWith('[features') &&
				!line.startsWith('[patch')
			) {
				currentSection = null;
			}
			continue;
		}

		if (!currentSection) { continue; }
		if (!line || line.startsWith('#')) { continue; }

		// Formato: name = "version"
		const simpleMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"$/);
		if (simpleMatch) {
			const name = simpleMatch[1];
			const rawVersion = simpleMatch[2];
			const exact = isExactVersion(rawVersion);
			results.push({
				name,
				version: exact ? rawVersion : cleanVersion(rawVersion),
				exactVersion: exact,
				section: currentSection
			});
			continue;
		}

		// Formato: name = { version = "1.0", ... }
		const tableMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{([^}]+)\}/);
		if (tableMatch) {
			const name = tableMatch[1];
			const body = tableMatch[2];

			// Ignorar workspace dependencies
			if (body.includes('workspace') && body.includes('true')) { continue; }
			// Ignorar path dependencies (locales)
			if (body.includes('path')) { continue; }

			const versionMatch = body.match(/version\s*=\s*"([^"]+)"/);
			if (!versionMatch) { continue; }

			const rawVersion = versionMatch[1];
			const exact = isExactVersion(rawVersion);
			results.push({
				name,
				version: exact ? rawVersion : cleanVersion(rawVersion),
				exactVersion: exact,
				section: currentSection
			});
		}
	}

	// Deduplicar por nombre — prioridad: dependencies > dev-dependencies > build-dependencies
	const PRIORITY: Record<ParsedPackage['section'], number> = {
		'dependencies': 0,
		'dev-dependencies': 1,
		'build-dependencies': 2
	};

	const dedupedMap = new Map<string, ParsedPackage>();
	for (const pkg of results) {
		const existing = dedupedMap.get(pkg.name);
		if (!existing || PRIORITY[pkg.section] < PRIORITY[existing.section]) {
			dedupedMap.set(pkg.name, pkg);
		}
	}

	return Array.from(dedupedMap.values());
}

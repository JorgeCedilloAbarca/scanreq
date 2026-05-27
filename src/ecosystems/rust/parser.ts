import * as fs from 'fs';
import * as path from 'path';

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
			// En formato tabla Cargo aplica ^ implícitamente — nunca es exacta
			// salvo que tenga prefijo = explícito (e.g. "=1.0.0"), que es muy raro.
			results.push({
				name,
				version: cleanVersion(rawVersion),
				exactVersion: false,
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

/**
 * Busca Cargo.lock subiendo directorios desde el Cargo.toml dado.
 *
 * En workspaces de Rust, el Cargo.lock está siempre en la raíz del workspace,
 * no en los sub-crates. Este helper sube hasta MAX_DEPTH directorios para
 * encontrarlo, lo que cubre workspaces con hasta 5 niveles de anidamiento.
 *
 * Formato de Cargo.lock (TOML con bloques [[package]]):
 *   [[package]]
 *   name = "async-channel"
 *   version = "2.1.1"
 *   source = "registry+..."
 *
 * Solo se toman paquetes con `source` que contenga "registry" — los
 * paquetes locales (path dependencies) no tienen source y no nos interesan
 * porque no aparecen en crates.io.
 *
 * Cuando hay múltiples entradas del mismo nombre (versiones distintas de un
 * crate en el grafo de dependencias), se toma la primera — que en Cargo.lock
 * es la que satisface el specifier del Cargo.toml que estamos analizando.
 *
 * @param cargoTomlPath  Ruta absoluta o relativa al Cargo.toml
 * @returns Mapa name → version con versiones exactas resueltas, o Map vacío si no hay lock
 */
export function readCargoLock(cargoTomlPath: string): Map<string, string> {
	const MAX_DEPTH = 5;
	const map = new Map<string, string>();

	let dir = path.dirname(path.resolve(cargoTomlPath));

	for (let i = 0; i < MAX_DEPTH; i++) {
		const lockPath = path.join(dir, 'Cargo.lock');

		if (fs.existsSync(lockPath)) {
			let content: string;
			try {
				content = fs.readFileSync(lockPath, 'utf8');
			} catch {
				return map;
			}

			// Parsear bloques [[package]]
			// Dividimos por líneas vacías consecutivas para aislar cada bloque,
			// luego buscamos los que empiezan con [[package]]
			const blocks = content.split(/\n(?=\[\[package\]\])/);

			for (const block of blocks) {
				if (!block.trimStart().startsWith('[[package]]')) { continue; }

				const nameMatch    = block.match(/^name\s*=\s*"([^"]+)"/m);
				const versionMatch = block.match(/^version\s*=\s*"([^"]+)"/m);
				const sourceMatch  = block.match(/^source\s*=\s*"([^"]+)"/m);

				if (!nameMatch || !versionMatch) { continue; }

				// Ignorar dependencias locales (path) — no tienen source o su source es "path+..."
				if (sourceMatch && sourceMatch[1].startsWith('path+')) { continue; }
				if (!sourceMatch) { continue; }

				const name    = nameMatch[1];
				const version = versionMatch[1];

				// Primera aparición gana — es la versión directa del workspace
				if (!map.has(name)) {
					map.set(name, version);
				}
			}

			return map;
		}

		// Subir un nivel
		const parent = path.dirname(dir);
		if (parent === dir) { break; } // llegamos a la raíz del filesystem
		dir = parent;
	}

	return map;
}

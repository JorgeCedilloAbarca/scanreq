import * as fs from 'fs';
import * as path from 'path';

export interface ParsedPackage {
	name: string;       // e.g. "rails"
	version: string;    // e.g. "7.1.2" o "unknown"
	exactVersion: boolean;
	section: string;    // 'gem' | 'group:test' | 'group:development' | etc.
}

/**
 * Parser de Gemfile + Gemfile.lock.
 *
 * Estrategia:
 * 1. Si existe Gemfile.lock en el mismo directorio → usarlo como fuente de verdad
 *    para las versiones instaladas (es el más preciso, siempre tiene versiones exactas).
 * 2. Parsear Gemfile para obtener la lista de gems y sus specifiers.
 * 3. Combinar: nombre y sección del Gemfile, versión del Gemfile.lock si está disponible.
 *
 * Gemfile.lock es el archivo más crítico para Ruby:
 * - Siempre contiene versiones exactas resueltas por Bundler
 * - Permite CVE detection precisa
 * - Si no existe, caemos de vuelta al specifier del Gemfile
 */
export function parseGemfile(filePath: string): ParsedPackage[] {
	// Leer Gemfile.lock primero
	const lockVersions = readGemfileLock(filePath);

	// Parsear Gemfile
	let content: string;
	try {
		content = fs.readFileSync(filePath, 'utf8');
	} catch {
		return [];
	}

	const seen = new Set<string>();
	const results: ParsedPackage[] = [];
	const lines = content.split('\n');

	// Rastrear el grupo activo
	let currentGroup = 'gem';
	let groupDepth = 0;

	for (const rawLine of lines) {
		const line = rawLine.trim();

		// Ignorar comentarios y líneas vacías
		if (!line || line.startsWith('#')) { continue; }

		// Detectar inicio de bloque group :test, :development do
		const groupMatch = line.match(/^group\s+(.+?)\s+do\b/);
		if (groupMatch) {
			// Extraer nombres de grupos: ":test, :development" → "test,development"
			const groups = groupMatch[1]
				.split(',')
				.map(g => g.trim().replace(/^:/, '').replace(/['"]/g, ''))
				.filter(Boolean);
			currentGroup = 'group:' + groups.join(',');
			groupDepth++;
			continue;
		}

		// Fin de bloque end
		if (line === 'end') {
			if (groupDepth > 0) {
				groupDepth--;
				if (groupDepth === 0) {
					currentGroup = 'gem';
				}
			}
			continue;
		}

		// Línea de gem: gem "rails", "~> 7.0"
		const gemMatch = parseGemLine(line);
		if (!gemMatch) { continue; }

		const { name, version, exactVersion } = gemMatch;

		if (seen.has(name)) { continue; }
		seen.add(name);

		// Si tenemos Gemfile.lock, sobreescribir versión con la instalada real
		const lockedVersion = lockVersions.get(name);

		results.push({
			name,
			version: lockedVersion ?? version,
			exactVersion: lockedVersion !== undefined ? true : exactVersion,
			section: currentGroup,
		});
	}

	return results;
}

/**
 * Parsea una línea de gem del Gemfile.
 * Soporta:
 *   gem "rails", "~> 7.0"
 *   gem 'rails', '~> 7.0'
 *   gem "rails"                    → sin versión
 *   gem "rails", ">= 7.0", "< 8"  → rango
 *   gem "rails", require: false    → sin versión con opciones
 */
function parseGemLine(line: string): { name: string; version: string; exactVersion: boolean } | null {
	// Debe comenzar con "gem "
	if (!line.startsWith('gem ') && !line.startsWith('gem\t')) { return null; }

	// Extraer el nombre de la gem (primera cadena entre comillas)
	const nameMatch = line.match(/gem\s+['"]([^'"]+)['"]/);
	if (!nameMatch) { return null; }
	const name = nameMatch[1];

	// Ignorar gems de fuente especial (git, github, path)
	if (line.includes(':git =>') || line.includes('git:') ||
		line.includes(':github =>') || line.includes('github:') ||
		line.includes(':path =>') || line.includes('path:')) {
		return null;
	}

	// Extraer todos los specifiers de versión (pueden ser varios)
	const specMatches = [...line.matchAll(/['"]((?:~>|>=|<=|!=|>|<|=)?\s*[\d][^'"]*)['"]/g)];

	// Filtrar los que son specifiers de versión reales (empiezan con dígito o operador)
	const specs = specMatches
		.map(m => m[1].trim())
		.filter(s => /^(?:~>|>=|<=|!=|>|<|=)?\s*\d/.test(s));

	if (specs.length === 0) {
		return { name, version: 'unknown', exactVersion: false };
	}

	if (specs.length > 1) {
		// Rango compuesto — no es exacto
		const version = extractBaseVersion(specs[0]);
		return { name, version, exactVersion: false };
	}

	const spec = specs[0];
	return { name, ...parseVersionSpec(spec) };
}

/**
 * Parsea un specifier de versión Ruby y devuelve version + exactVersion.
 */
function parseVersionSpec(spec: string): { version: string; exactVersion: boolean } {
	// Exacto: "= 7.1.2" o "7.1.2" (sin operador o con "=")
	const exactRe = /^=?\s*(\d+(?:\.\d+)*)$/;
	const exactMatch = spec.match(exactRe);
	if (exactMatch) {
		return { version: exactMatch[1], exactVersion: true };
	}

	// No exacto — extraer versión base
	const version = extractBaseVersion(spec);
	return { version, exactVersion: false };
}

function extractBaseVersion(spec: string): string {
	const m = spec.match(/(\d+(?:\.\d+)*)/);
	return m ? m[1] : 'unknown';
}

/**
 * Lee Gemfile.lock y devuelve un mapa name → version instalada.
 *
 * Formato de Gemfile.lock (sección GEM):
 *   GEM
 *     remote: https://rubygems.org/
 *     specs:
 *       rails (7.1.2)
 *         actioncable (= 7.1.2)
 *         ...
 *       rake (13.1.0)
 *
 * Indentación real de Bundler (verificada en Bundler 2.x):
 *   - Sección "specs:" indentada con 2 espacios
 *   - Gems top-level indentadas con 4 espacios (e.g. "    rails (7.1.2)")
 *   - Subdependencias indentadas con 6 espacios (e.g. "      actioncable (= 7.1.2)")
 *
 * Solo nos interesa el top-level. La regex usa lookahead negativo para
 * descartar 5+ espacios y filtrar las subdeps limpiamente.
 */
function readGemfileLock(gemfilePath: string): Map<string, string> {
	const map = new Map<string, string>();
	const lockPath = path.join(path.dirname(gemfilePath), 'Gemfile.lock');

	let content: string;
	try {
		content = fs.readFileSync(lockPath, 'utf8');
	} catch {
		return map;
	}

	const lines = content.split('\n');
	let inSpecs = false;

	for (const line of lines) {
		// Detectar inicio de sección specs:
		if (line.trim() === 'specs:') {
			inSpecs = true;
			continue;
		}

		// Salir de specs al encontrar una línea vacía o un encabezado de sección
		if (inSpecs && line.trim() === '') {
			inSpecs = false;
			continue;
		}

		if (!inSpecs) { continue; }

		// Fix M1 + B1: Top-level gems en Gemfile.lock tienen EXACTAMENTE 4 espacios
		// de indentación. Las subdependencias usan 6 espacios (no "8+" como decía
		// el comentario anterior). La regex original /^ {4,6}/ matcheaba ambas y
		// funcionaba "por suerte" porque el primer match se quedaba (las top-level
		// aparecen antes que sus subdeps en Bundler), pero era frágil: si una
		// subdep se procesaba antes que la top-level homónima, se guardaba la
		// versión con prefijo "= " en lugar de la versión limpia.
		//
		// Solución: anclar exactamente 4 espacios con lookahead negativo (?! ) para
		// excluir 5+. Las subdeps (6 espacios) ahora se descartan correctamente.
		const gemLineMatch = line.match(/^ {4}(?! )([a-zA-Z0-9_\-\.]+)\s+\(([^)]+)\)/);
		if (!gemLineMatch) { continue; }

		const name    = gemLineMatch[1];
		const version = gemLineMatch[2];

		// Ignorar versiones con plataformas "1.2.3-x86_64-linux" → tomar solo "1.2.3"
		const cleanVersion = version.split('-')[0].trim();

		if (!map.has(name)) {
			map.set(name, cleanVersion);
		}
	}

	return map;
}

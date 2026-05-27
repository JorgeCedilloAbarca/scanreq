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
 *    Si el Gemfile contiene `eval_gemfile 'ruta'`, parsear ese archivo también
 *    (recursivamente, con protección anti-bucle).
 * 3. Combinar: nombre y sección del Gemfile, versión del Gemfile.lock si está disponible.
 *
 * Gemfile.lock es el archivo más crítico para Ruby:
 * - Siempre contiene versiones exactas resueltas por Bundler
 * - Permite CVE detection precisa
 * - Si no existe, caemos de vuelta al specifier del Gemfile
 * - Cuando se usa eval_gemfile, Bundler genera un único Gemfile.lock
 *   en la raíz que cubre todas las gems de todos los sub-archivos.
 *   Por eso pasamos siempre el lockVersions del archivo raíz.
 */
export function parseGemfile(filePath: string): ParsedPackage[] {
	// Leer Gemfile.lock del directorio raíz (donde vive el Gemfile principal)
	const lockVersions = readGemfileLock(filePath);

	// Parsear recursivamente con set de rutas visitadas para anti-bucle
	const visited = new Set<string>();
	const raw = parseGemfileContent(filePath, lockVersions, visited);

	// Deduplicar por nombre — primera aparición gana (el archivo raíz tiene prioridad)
	const seen = new Set<string>();
	const results: ParsedPackage[] = [];
	for (const pkg of raw) {
		if (!seen.has(pkg.name)) {
			seen.add(pkg.name);
			results.push(pkg);
		}
	}

	return results;
}

/**
 * Parsea el contenido de un Gemfile (o sub-archivo eval_gemfile).
 * Devuelve los paquetes sin deduplicar — la deduplicación la hace parseGemfile.
 *
 * @param filePath   Ruta al archivo a parsear
 * @param lockVersions  Mapa name→version del Gemfile.lock raíz (se reutiliza en todos los niveles)
 * @param visited    Set de rutas ya procesadas (anti-bucle circular)
 */
function parseGemfileContent(
	filePath: string,
	lockVersions: Map<string, string>,
	visited: Set<string>
): ParsedPackage[] {
	const resolvedPath = path.resolve(filePath);

	// Protección anti-bucle
	if (visited.has(resolvedPath)) { return []; }
	visited.add(resolvedPath);

	let content: string;
	try {
		content = fs.readFileSync(resolvedPath, 'utf8');
	} catch {
		return [];
	}

	const results: ParsedPackage[] = [];
	const lines = content.split('\n');
	const dir = path.dirname(resolvedPath);

	// Rastrear el grupo activo
	let currentGroup = 'gem';
	let groupDepth = 0;

	for (const rawLine of lines) {
		const line = rawLine.trim();

		// Ignorar comentarios y líneas vacías
		if (!line || line.startsWith('#')) { continue; }

		// Detectar eval_gemfile 'ruta' o eval_gemfile "ruta"
		const evalMatch = line.match(/^eval_gemfile\s+['"]([^'"]+)['"]/);
		if (evalMatch) {
			const childPath = path.resolve(dir, evalMatch[1]);
			const childPackages = parseGemfileContent(childPath, lockVersions, visited);
			results.push(...childPackages);
			continue;
		}

		// Detectar inicio de bloque group :test, :development do
		const groupMatch = line.match(/^group\s+(.+?)\s+do\b/);
		if (groupMatch) {
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

	// Ignorar gems declaradas para plataformas específicas no-current.
	// Ejemplo:
	//   gem "tzinfo-data", platforms: %i[ windows jruby ]
	//   gem "wdm", ">= 0.1.0", platforms: :windows
	//
	// Bundler omite estas gems del Gemfile.lock en plataformas no coincidentes,
	// por lo que nunca tendrían versión resuelta y aparecerían como ⚠ Unverified.
	// Las filtramos aquí. Si el usuario está en esa plataforma, el lock sí las
	// incluirá y lockVersions.get(name) las cubrirá — este null nunca se alcanza.
	if (line.includes('platforms:')) {
		const platformMatch = line.match(/platforms:\s*(?:%i\[([^\]]+)\]|\[([^\]]+)\]|:(\w+))/);
		if (platformMatch) {
			// Grupo 1: %i[windows jruby]
			// Grupo 2: [:windows, :jruby]
			// Grupo 3: :windows (símbolo único)
			const raw = platformMatch[1] ?? platformMatch[2] ?? platformMatch[3] ?? '';
			const rawPlatforms = raw
				.split(/[\s,]+/)
				.map(s => s.trim().replace(/^:/, '').toLowerCase())
				.filter(Boolean);
			const PLATFORM_SPECIFIC = new Set(['windows', 'jruby', 'mswin', 'mingw', 'x64_mingw']);
			if (rawPlatforms.length > 0 && rawPlatforms.every(p => PLATFORM_SPECIFIC.has(p))) { return null; }
		}
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

		// Top-level gems: exactamente 4 espacios, no 5+
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

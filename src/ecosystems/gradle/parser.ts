import * as fs from 'fs';

export interface ParsedPackage {
	name: string;         // "groupId:artifactId" — mismo formato que Maven
	groupId: string;
	artifactId: string;
	version: string;      // versión exacta, o "unknown"
	exactVersion: boolean;
	section: string;      // 'implementation' | 'api' | 'testImplementation' | etc.
	scope: string;        // normalizado: 'compile' | 'test' | 'provided' | 'runtime'
}

/**
 * Parser de build.gradle (Groovy DSL) y build.gradle.kts (Kotlin DSL).
 *
 * Formatos de dependencia soportados:
 *
 * Groovy DSL (build.gradle):
 *   implementation 'org.springframework:spring-core:6.1.2'
 *   implementation "org.springframework:spring-core:6.1.2"
 *   implementation group: 'org.springframework', name: 'spring-core', version: '6.1.2'
 *   testImplementation 'org.junit.jupiter:junit-jupiter:5.10.1'
 *   api 'com.google.guava:guava:32.1.3-jre'
 *
 * Kotlin DSL (build.gradle.kts):
 *   implementation("org.springframework:spring-core:6.1.2")
 *   testImplementation("org.junit.jupiter:junit-jupiter:5.10.1")
 *   implementation(group = "org.springframework", name = "spring-core", version = "6.1.2")
 *
 * Configuraciones soportadas:
 *   implementation, api, compileOnly, runtimeOnly,
 *   testImplementation, testApi, testCompileOnly, testRuntimeOnly,
 *   androidTestImplementation, debugImplementation, releaseImplementation,
 *   kapt, ksp, annotationProcessor, compile, testCompile, provided
 *
 * Se ignoran:
 *   - project(':module') — dependencias de módulos locales
 *   - files(...), fileTree(...) — dependencias de archivos locales
 *   - platform(...) / enforcedPlatform(...) — BOMs
 *   - Dependencias sin versión resoluble (version catalogs, variables externas)
 */
export function parseBuildGradle(filePath: string): ParsedPackage[] {
	let content: string;
	try {
		content = fs.readFileSync(filePath, 'utf8');
	} catch {
		return [];
	}

	// Eliminar comentarios antes de procesar
	const cleaned = removeComments(content);

	// Extraer variables de versión definidas en el mismo archivo
	const variables = extractVariables(cleaned);

	// Extraer bloque dependencies { ... }
	const depsBlock = extractDependenciesBlock(cleaned);
	if (!depsBlock) { return []; }

	const seen    = new Set<string>();
	const results: ParsedPackage[] = [];

	// ── Formato string — iterar línea por línea ───────────────────────────────
	// Groovy: implementation 'g:a:v'  o  implementation "g:a:v"
	// Kotlin: implementation("g:a:v") o  implementation("g:a:v")
	// La regex con gm consume \n entre matches e impide que ^ funcione en cada
	// línea — por eso procesamos línea a línea.
	const lineStringRe = /^\s*(\w+)\s*\(?\s*['"]([^'"]+)['"]\s*\)?/;

	for (const line of depsBlock.split('\n')) {
		const m = line.match(lineStringRe);
		if (!m) { continue; }

		const config = m[1];
		const coord  = m[2].trim();

		if (!isKnownConfig(config)) { continue; }

		// Ignorar project(), files(), fileTree(), platform(), enforcedPlatform()
		if (/^(?:project|files|fileTree|platform|enforcedPlatform)\s*[:(]/.test(coord)) { continue; }

		// Ignorar referencias kotlin("test") y similares sin groupId:artifactId
		if (!coord.includes(':')) { continue; }

		const parsed = parseCoordinate(coord, variables);
		if (!parsed) { continue; }

		if (seen.has(parsed.name)) { continue; }
		seen.add(parsed.name);

		results.push({ ...parsed, section: config, scope: configToScope(config) });
	}

	// ── Formato named multilínea — group:/name:/version: ─────────────────────
	// Groovy: implementation group: 'g', name: 'a', version: 'v'
	// Kotlin: implementation(group = "g", name = "a", version = "v")
	// Este sí puede ser multilínea por lo que usamos regex sobre el bloque completo
	const namedRe = /^\s*(\w+)\s*[\s(]group\s*[:=]\s*['"]([^'"]+)['"],?\s*name\s*[:=]\s*['"]([^'"]+)['"],?\s*version\s*[:=]\s*['"]([^'"]+)['"]/gm;
	let nm: RegExpExecArray | null;

	while ((nm = namedRe.exec(depsBlock)) !== null) {
		const config     = nm[1];
		const groupId    = nm[2];
		const artifactId = nm[3];
		const version    = nm[4];

		if (!isKnownConfig(config)) { continue; }
		if (!groupId || !artifactId) { continue; }

		const name = `${groupId}:${artifactId}`;
		if (seen.has(name)) { continue; }
		seen.add(name);

		results.push({
			name,
			groupId,
			artifactId,
			version: version || 'unknown',
			exactVersion: isExactVersion(version),
			section: config,
			scope: configToScope(config),
		});
	}

	return results;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function removeComments(content: string): string {
	return content
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/[^\n]*/g, '');
}

function extractDependenciesBlock(content: string): string | null {
	const start = content.search(/\bdependencies\s*\{/);
	if (start === -1) { return null; }

	const openBrace = content.indexOf('{', start);
	if (openBrace === -1) { return null; }

	let depth = 0;
	let i = openBrace;
	while (i < content.length) {
		if (content[i] === '{') { depth++; }
		else if (content[i] === '}') {
			depth--;
			if (depth === 0) {
				return content.slice(openBrace + 1, i);
			}
		}
		i++;
	}
	return null;
}

function extractVariables(content: string): Map<string, string> {
	const map = new Map<string, string>();
	const re  = /(?:def|val|var)\s+(\w+)\s*=\s*['"]([^'"]+)['"]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		map.set(m[1], m[2]);
	}
	return map;
}

function parseCoordinate(
	coord: string,
	variables: Map<string, string>
): Omit<ParsedPackage, 'section' | 'scope'> | null {
	const parts = coord.split(':');
	if (parts.length < 2) { return null; }

	const groupId    = parts[0].trim();
	const artifactId = parts[1].trim();
	let   rawVersion = parts[2]?.trim() ?? '';

	if (!groupId || !artifactId) { return null; }
	if (groupId.startsWith(':') || artifactId.startsWith(':')) { return null; }

	// Resolver variable: ${springVersion} o $springVersion
	if (rawVersion) {
		rawVersion = rawVersion
			.replace(/\$\{(\w+)\}/g, (_, k) => variables.get(k) ?? '')
			.replace(/\$(\w+)/g,     (_, k) => variables.get(k) ?? '');
	}

	const version = rawVersion || 'unknown';

	return {
		name: `${groupId}:${artifactId}`,
		groupId,
		artifactId,
		version,
		exactVersion: isExactVersion(version),
	};
}

const KNOWN_CONFIGS = new Set([
	'implementation', 'api', 'compileOnly', 'runtimeOnly',
	'testImplementation', 'testApi', 'testCompileOnly', 'testRuntimeOnly',
	'androidTestImplementation', 'debugImplementation', 'releaseImplementation',
	'kapt', 'ksp', 'annotationProcessor', 'compile', 'testCompile', 'provided',
]);

function isKnownConfig(config: string): boolean {
	return KNOWN_CONFIGS.has(config);
}

function configToScope(config: string): string {
	if (config.startsWith('test'))         { return 'test'; }
	if (config === 'compileOnly' ||
		config === 'provided')             { return 'provided'; }
	if (config === 'runtimeOnly')          { return 'runtime'; }
	if (config === 'kapt' ||
		config === 'ksp' ||
		config === 'annotationProcessor')  { return 'provided'; }
	return 'compile';
}

function isExactVersion(version: string): boolean {
	if (!version || version === 'unknown') { return false; }
	if (version.includes('$'))             { return false; }
	if (version.toUpperCase().includes('SNAPSHOT')) { return false; }
	if (version === 'LATEST' || version === 'RELEASE') { return false; }
	return /^\d[\d.]*(-[\w.]+)?$/.test(version);
}

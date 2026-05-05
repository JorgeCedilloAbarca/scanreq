import * as fs from 'fs';

export interface ParsedPackage {
	name: string;
	groupId: string;
	artifactId: string;
	version: string;
	exactVersion: boolean;
	section: string;
	scope: string;
}

/**
 * Parser de build.gradle (Groovy DSL) y build.gradle.kts (Kotlin DSL).
 *
 * Además del parsing estático, resuelve versiones de dependencias sin versión
 * que provienen de BOMs declarados con platform() o enforcedPlatform().
 *
 * BOM resolution:
 *   testImplementation(platform("org.junit:junit-bom:5.9.1"))
 *   testImplementation("org.junit.jupiter:junit-jupiter")  ← sin versión
 *   → Se consulta el POM del BOM en Maven Central y se extrae la versión de junit-jupiter
 */

// Caché de BOMs ya consultados para evitar requests repetidos en el mismo scan
const bomCache = new Map<string, Map<string, string>>();

export async function parseBuildGradleAsync(filePath: string): Promise<ParsedPackage[]> {
	let content: string;
	try {
		content = fs.readFileSync(filePath, 'utf8');
	} catch {
		return [];
	}

	const cleaned   = removeComments(content);
	const variables = extractVariables(cleaned);
	const depsBlock = extractDependenciesBlock(cleaned);
	if (!depsBlock) { return []; }

	// 1. Extraer BOMs declarados con platform() o enforcedPlatform()
	const boms = extractBoms(depsBlock, variables);

	// 2. Resolver versiones de todos los BOMs en paralelo
	const bomVersionMaps = await Promise.all(
		boms.map(bom => resolveBomVersions(bom.groupId, bom.artifactId, bom.version))
	);

	// Combinar todos los mapas de versiones de BOMs en uno solo
	// Si hay conflicto, el BOM declarado primero tiene prioridad
	const bomVersions = new Map<string, string>();
	for (const map of bomVersionMaps.reverse()) {
		for (const [k, v] of map) { bomVersions.set(k, v); }
	}

	const seen    = new Set<string>();
	const results: ParsedPackage[] = [];

	// 3. Parsear dependencias línea por línea (formato string)
	const lineStringRe = /^\s*(\w+)\s*\(?\s*['"]([^'"]+)['"]\s*\)?/;

	for (const line of depsBlock.split('\n')) {
		const m = line.match(lineStringRe);
		if (!m) { continue; }

		const config = m[1];
		const coord  = m[2].trim();

		if (!isKnownConfig(config)) { continue; }

		// Ignorar project(), files(), fileTree(), platform(), enforcedPlatform()
		if (/^(?:project|files|fileTree|platform|enforcedPlatform)\s*[:(]/.test(coord)) { continue; }
		if (!coord.includes(':')) { continue; }

		const parsed = parseCoordinate(coord, variables, bomVersions);
		if (!parsed) { continue; }

		if (seen.has(parsed.name)) { continue; }
		seen.add(parsed.name);

		results.push({ ...parsed, section: config, scope: configToScope(config) });
	}

	// 4. Formato named multilínea
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

/**
 * Versión síncrona del parser — para compatibilidad con el adapter actual.
 * No resuelve BOMs (los paquetes sin versión quedan como 'unknown').
 * Usar parseBuildGradleAsync para resolución completa.
 */
export function parseBuildGradle(filePath: string): ParsedPackage[] {
	let content: string;
	try {
		content = fs.readFileSync(filePath, 'utf8');
	} catch {
		return [];
	}

	const cleaned   = removeComments(content);
	const variables = extractVariables(cleaned);
	const depsBlock = extractDependenciesBlock(cleaned);
	if (!depsBlock) { return []; }

	const seen    = new Set<string>();
	const results: ParsedPackage[] = [];

	const lineStringRe = /^\s*(\w+)\s*\(?\s*['"]([^'"]+)['"]\s*\)?/;

	for (const line of depsBlock.split('\n')) {
		const m = line.match(lineStringRe);
		if (!m) { continue; }

		const config = m[1];
		const coord  = m[2].trim();

		if (!isKnownConfig(config)) { continue; }
		if (/^(?:project|files|fileTree|platform|enforcedPlatform)\s*[:(]/.test(coord)) { continue; }
		if (!coord.includes(':')) { continue; }

		const parsed = parseCoordinate(coord, variables, new Map());
		if (!parsed) { continue; }

		if (seen.has(parsed.name)) { continue; }
		seen.add(parsed.name);

		results.push({ ...parsed, section: config, scope: configToScope(config) });
	}

	const namedRe = /^\s*(\w+)\s*[\s(]group\s*[:=]\s*['"]([^'"]+)['"],?\s*name\s*[:=]\s*['"]([^'"]+)['"],?\s*version\s*[:=]\s*['"]([^'"]+)['"]/gm;
	let nm: RegExpExecArray | null;

	while ((nm = namedRe.exec(depsBlock)) !== null) {
		const config = nm[1]; const groupId = nm[2]; const artifactId = nm[3]; const version = nm[4];
		if (!isKnownConfig(config) || !groupId || !artifactId) { continue; }
		const name = `${groupId}:${artifactId}`;
		if (seen.has(name)) { continue; }
		seen.add(name);
		results.push({ name, groupId, artifactId, version: version || 'unknown', exactVersion: isExactVersion(version), section: config, scope: configToScope(config) });
	}

	return results;
}

// ─── BOM extraction y resolution ─────────────────────────────────────────────

interface BomRef {
	groupId: string;
	artifactId: string;
	version: string;
}

/**
 * Extrae los BOMs declarados con platform() o enforcedPlatform() en el bloque de dependencias.
 * Groovy: implementation platform('org.springframework.boot:spring-boot-dependencies:3.2.1')
 * Kotlin: implementation(platform("org.junit:junit-bom:5.9.1"))
 */
function extractBoms(depsBlock: string, variables: Map<string, string>): BomRef[] {
	const boms: BomRef[] = [];
	const platformRe = /(?:platform|enforcedPlatform)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
	let m: RegExpExecArray | null;

	while ((m = platformRe.exec(depsBlock)) !== null) {
		const coord = m[1].trim();
		const parts = coord.split(':');
		if (parts.length < 3) { continue; }

		const groupId    = parts[0].trim();
		const artifactId = parts[1].trim();
		let   version    = parts[2].trim();

		// Resolver variable si es necesario
		version = version
			.replace(/\$\{(\w+)\}/g, (_, k) => variables.get(k) ?? version)
			.replace(/\$(\w+)/g,     (_, k) => variables.get(k) ?? version);

		if (groupId && artifactId && version && !version.includes('$')) {
			boms.push({ groupId, artifactId, version });
		}
	}

	return boms;
}

/**
 * Descarga el POM de un BOM desde Maven Central y extrae el mapa
 * artifactId → version de su sección <dependencyManagement>.
 *
 * El POM de un BOM tiene esta estructura:
 *   <dependencyManagement>
 *     <dependencies>
 *       <dependency>
 *         <groupId>org.junit.jupiter</groupId>
 *         <artifactId>junit-jupiter</artifactId>
 *         <version>5.9.1</version>
 *       </dependency>
 *     </dependencies>
 *   </dependencyManagement>
 */
async function resolveBomVersions(
	groupId: string,
	artifactId: string,
	version: string
): Promise<Map<string, string>> {
	const cacheKey = `${groupId}:${artifactId}:${version}`;
	if (bomCache.has(cacheKey)) {
		return bomCache.get(cacheKey)!;
	}

	const map = new Map<string, string>();

	try {
		// URL del POM en Maven Central
		// e.g. https://repo1.maven.org/maven2/org/junit/junit-bom/5.9.1/junit-bom-5.9.1.pom
		const groupPath = groupId.replace(/\./g, '/');
		const pomUrl    = `https://repo1.maven.org/maven2/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.pom`;

		const response = await fetch(pomUrl, {
			headers: { 'User-Agent': 'ScanReq-VSCode-Extension/2.4 (https://scanreq.com)' }
		});

		if (!response.ok) {
			bomCache.set(cacheKey, map);
			return map;
		}

		const xml = await response.text();

		// Extraer sección dependencyManagement
		const dmStart = xml.indexOf('<dependencyManagement>');
		const dmEnd   = xml.indexOf('</dependencyManagement>');
		if (dmStart === -1 || dmEnd === -1) {
			bomCache.set(cacheKey, map);
			return map;
		}

		const dmSection = xml.slice(dmStart, dmEnd + '</dependencyManagement>'.length);

		// Extraer cada <dependency> del BOM
		const depRe = /<dependency>([\s\S]*?)<\/dependency>/g;
		let dm: RegExpExecArray | null;

		while ((dm = depRe.exec(dmSection)) !== null) {
			const block      = dm[1];
			const depGroupId    = extractTag(block, 'groupId');
			const depArtifactId = extractTag(block, 'artifactId');
			const depVersion    = extractTag(block, 'version');

			if (depGroupId && depArtifactId && depVersion) {
				// Clave: "groupId:artifactId" y también solo "artifactId" para búsqueda rápida
				const fullName = `${depGroupId}:${depArtifactId}`;
				map.set(fullName, depVersion);
				map.set(depArtifactId, depVersion);
			}
		}
	} catch {
		// Si falla la descarga del POM, devolver mapa vacío — el paquete queda como 'unknown'
	}

	bomCache.set(cacheKey, map);
	return map;
}

function extractTag(block: string, tag: string): string | null {
	const re = new RegExp(`<${tag}>\\s*([^<]+)\\s*<\\/${tag}>`);
	const m  = block.match(re);
	return m ? m[1].trim() : null;
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
	let depth = 0, i = openBrace;
	while (i < content.length) {
		if (content[i] === '{') { depth++; }
		else if (content[i] === '}') { depth--; if (depth === 0) { return content.slice(openBrace + 1, i); } }
		i++;
	}
	return null;
}

function extractVariables(content: string): Map<string, string> {
	const map = new Map<string, string>();
	const re  = /(?:def|val|var)\s+(\w+)\s*=\s*['"]([^'"]+)['"]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) { map.set(m[1], m[2]); }
	return map;
}

function parseCoordinate(
	coord: string,
	variables: Map<string, string>,
	bomVersions: Map<string, string>
): Omit<ParsedPackage, 'section' | 'scope'> | null {
	const parts = coord.split(':');
	if (parts.length < 2) { return null; }

	const groupId    = parts[0].trim();
	const artifactId = parts[1].trim();
	let   rawVersion = parts[2]?.trim() ?? '';

	if (!groupId || !artifactId) { return null; }
	if (groupId.startsWith(':') || artifactId.startsWith(':')) { return null; }

	if (rawVersion) {
		rawVersion = rawVersion
			.replace(/\$\{(\w+)\}/g, (_, k) => variables.get(k) ?? '')
			.replace(/\$(\w+)/g,     (_, k) => variables.get(k) ?? '');
	}

	// Si no hay versión, buscar en los BOMs resueltos
	if (!rawVersion) {
		const fromBom = bomVersions.get(`${groupId}:${artifactId}`) ?? bomVersions.get(artifactId);
		if (fromBom) {
			return {
				name: `${groupId}:${artifactId}`,
				groupId,
				artifactId,
				version: fromBom,
				exactVersion: isExactVersion(fromBom),
			};
		}
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

function isKnownConfig(config: string): boolean { return KNOWN_CONFIGS.has(config); }

function configToScope(config: string): string {
	if (config.startsWith('test'))    { return 'test'; }
	if (config === 'compileOnly' || config === 'provided') { return 'provided'; }
	if (config === 'runtimeOnly')     { return 'runtime'; }
	if (config === 'kapt' || config === 'ksp' || config === 'annotationProcessor') { return 'provided'; }
	return 'compile';
}

function isExactVersion(version: string): boolean {
	if (!version || version === 'unknown') { return false; }
	if (version.includes('$'))             { return false; }
	if (version.toUpperCase().includes('SNAPSHOT')) { return false; }
	if (version === 'LATEST' || version === 'RELEASE') { return false; }
	return /^\d[\d.]*(-[\w.]+)?$/.test(version);
}

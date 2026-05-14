import * as fs from 'fs';

export interface ParsedPackage {
	name: string;         // "groupId:artifactId" — formato Maven Central
	groupId: string;
	artifactId: string;
	version: string;      // versión resuelta, o "unknown" si no hay versión declarada
	exactVersion: boolean;
	section: string;      // 'dependencies' | 'dependencyManagement'
	scope: string;        // 'compile' | 'test' | 'provided' | 'runtime' | 'system'
	hasPrivateRepos: boolean; // true si el pom declara <repositories> externos a Maven Central
}

// Cache de BOMs descargados durante el scan
const bomCache = new Map<string, Map<string, string>>();

/**
 * Parser asíncrono de pom.xml — resuelve versiones de dependencias sin versión
 * cuando vienen de un <parent> de Spring Boot u otros BOMs conocidos.
 *
 * Patrón Spring Boot Maven (el más común):
 *   <parent>
 *     <groupId>org.springframework.boot</groupId>
 *     <artifactId>spring-boot-starter-parent</artifactId>
 *     <version>3.2.1</version>
 *   </parent>
 *   <dependencies>
 *     <dependency>
 *       <groupId>org.springframework.boot</groupId>
 *       <artifactId>spring-boot-starter-web</artifactId>
 *       <!-- sin versión — viene del parent -->
 *     </dependency>
 *   </dependencies>
 */
export async function parsePomXmlAsync(filePath: string): Promise<ParsedPackage[]> {
	let content: string;
	try {
		content = fs.readFileSync(filePath, 'utf8');
	} catch {
		return [];
	}

	const properties = extractProperties(content);
	const hasPrivateRepos = detectPrivateRepos(content);

	// Extraer BOM del <parent> si es Spring Boot
	const parentBom = extractParentBom(content, properties);
	const bomVersions = parentBom
		? await resolveBomVersions(parentBom.groupId, parentBom.artifactId, parentBom.version)
		: new Map<string, string>();

	const seen    = new Set<string>();
	const results: ParsedPackage[] = [];

	// dependencyManagement primero
	const mgmtDeps = extractDependencies(content, 'dependencyManagement', properties, bomVersions);
	for (const dep of mgmtDeps) {
		if (!seen.has(dep.name)) { seen.add(dep.name); results.push({ ...dep, hasPrivateRepos }); }
	}

	// dependencies directas (prioridad más alta)
	const directDeps = extractDependencies(content, 'dependencies', properties, bomVersions);
	for (const dep of directDeps) {
		if (seen.has(dep.name)) {
			const idx = results.findIndex(r => r.name === dep.name);
			if (idx !== -1) { results[idx] = { ...dep, hasPrivateRepos }; }
		} else {
			seen.add(dep.name);
			results.push({ ...dep, hasPrivateRepos });
		}
	}

	return results;
}

/**
 * Versión síncrona original — para compatibilidad con los tests unitarios.
 */
export function parsePomXml(filePath: string): ParsedPackage[] {
	let content: string;
	try {
		content = fs.readFileSync(filePath, 'utf8');
	} catch {
		return [];
	}

	const properties     = extractProperties(content);
	const hasPrivateRepos = detectPrivateRepos(content);
	const seen           = new Set<string>();
	const results: ParsedPackage[] = [];
	const emptyBom       = new Map<string, string>();

	const mgmtDeps = extractDependencies(content, 'dependencyManagement', properties, emptyBom);
	for (const dep of mgmtDeps) {
		if (!seen.has(dep.name)) { seen.add(dep.name); results.push({ ...dep, hasPrivateRepos }); }
	}

	const directDeps = extractDependencies(content, 'dependencies', properties, emptyBom);
	for (const dep of directDeps) {
		if (seen.has(dep.name)) {
			const idx = results.findIndex(r => r.name === dep.name);
			if (idx !== -1) { results[idx] = { ...dep, hasPrivateRepos }; }
		} else {
			seen.add(dep.name);
			results.push({ ...dep, hasPrivateRepos });
		}
	}

	return results;
}

// ─── Detección de repositorios externos ──────────────────────────────────────

/**
 * Detecta si el pom.xml declara repositorios externos a Maven Central.
 * Maven Central tiene URL repo1.maven.org/maven2 o repo.maven.apache.org.
 * Cualquier otro <repository> se considera privado o externo.
 */
function detectPrivateRepos(content: string): boolean {
	const reposBlock = extractBlock(content, 'repositories');
	if (!reposBlock) { return false; }

	const urlRe = /<url>\s*([^<]+)\s*<\/url>/g;
	let m: RegExpExecArray | null;
	while ((m = urlRe.exec(reposBlock)) !== null) {
		const url = m[1].trim().toLowerCase();
		// Ignorar Maven Central y sus mirrors conocidos
		if (url.includes('repo1.maven.org') ||
			url.includes('repo.maven.apache.org') ||
			url.includes('central.maven.org')) {
			continue;
		}
		return true; // Hay al menos un repo externo
	}
	return false;
}

// ─── BOM resolution ───────────────────────────────────────────────────────────

interface ParentRef {
	groupId: string;
	artifactId: string;
	version: string;
}

/**
 * Extrae el <parent> del pom.xml y lo convierte en una referencia de BOM
 * si es un parent de Spring Boot (spring-boot-starter-parent →
 * spring-boot-dependencies, que es el BOM real con las versiones).
 *
 * También soporta otros parents comunes que son BOMs:
 * - org.springframework.boot:spring-boot-starter-parent → spring-boot-dependencies
 * - org.springframework.cloud:spring-cloud-dependencies (directo)
 */
function extractParentBom(content: string, properties: Map<string, string>): ParentRef | null {
	const parentBlock = extractBlock(content, 'parent');
	if (!parentBlock) { return null; }

	const groupId    = extractTag(parentBlock, 'groupId');
	const artifactId = extractTag(parentBlock, 'artifactId');
	const rawVersion = extractTag(parentBlock, 'version') ?? '';

	if (!groupId || !artifactId || !rawVersion) { return null; }

	const version = resolveProperty(rawVersion, properties);
	if (!version || version.includes('${')) { return null; }

	// Spring Boot starter parent → usar spring-boot-dependencies como BOM
	if (groupId === 'org.springframework.boot' && artifactId === 'spring-boot-starter-parent') {
		return { groupId: 'org.springframework.boot', artifactId: 'spring-boot-dependencies', version };
	}

	// Otros parents que son BOMs directamente
	if (artifactId.endsWith('-dependencies') || artifactId.endsWith('-bom')) {
		return { groupId, artifactId, version };
	}

	return null;
}

/**
 * Descarga el POM de un BOM desde Maven Central y extrae versiones de
 * su sección <dependencyManagement>.
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

		// Extraer las <properties> del propio BOM para resolver versiones internas.
		// Spring Boot BOM define cosas como <postgresql.version>42.7.3</postgresql.version>
		// y las usa en su <dependencyManagement> como ${postgresql.version}.
		const bomProperties = extractProperties(xml);

		const dmStart = xml.indexOf('<dependencyManagement>');
		const dmEnd   = xml.indexOf('</dependencyManagement>');
		if (dmStart === -1 || dmEnd === -1) {
			bomCache.set(cacheKey, map);
			return map;
		}

		const dmSection = xml.slice(dmStart, dmEnd + '</dependencyManagement>'.length);
		const depRe = /<dependency>([\s\S]*?)<\/dependency>/g;
		let dm: RegExpExecArray | null;

		while ((dm = depRe.exec(dmSection)) !== null) {
			const block         = dm[1];
			const depGroupId    = extractTag(block, 'groupId');
			const depArtifactId = extractTag(block, 'artifactId');
			const rawDepVersion = extractTag(block, 'version');

			if (depGroupId && depArtifactId && rawDepVersion) {
				// Resolver properties internas del BOM (ej: ${postgresql.version} → 42.7.3)
				const depVersion = resolveProperty(rawDepVersion, bomProperties);
				// Solo guardar si la versión quedó completamente resuelta
				if (depVersion && !depVersion.includes('${')) {
					const fullName = `${depGroupId}:${depArtifactId}`;
					map.set(fullName, depVersion);
					map.set(depArtifactId, depVersion);
				}
			}
		}
	} catch {
		// Si falla la descarga, devolver mapa vacío
	}

	bomCache.set(cacheKey, map);
	return map;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function extractProperties(content: string): Map<string, string> {
	const map = new Map<string, string>();

	const projectVersionMatch = content.match(/<project[^>]*>[\s\S]*?<version>\s*([^<]+)\s*<\/version>/);
	if (projectVersionMatch) {
		map.set('project.version', projectVersionMatch[1].trim());
	}

	const propsBlock = extractBlock(content, 'properties');
	if (propsBlock) {
		const propRe = /<([a-zA-Z0-9._\-]+)>\s*([^<]+)\s*<\/\1>/g;
		let m: RegExpExecArray | null;
		while ((m = propRe.exec(propsBlock)) !== null) {
			map.set(m[1], m[2].trim());
		}
	}

	return map;
}

function extractDependencies(
	content: string,
	section: 'dependencies' | 'dependencyManagement',
	properties: Map<string, string>,
	bomVersions: Map<string, string>
): ParsedPackage[] {
	const results: ParsedPackage[] = [];
	let searchIn = content;

	if (section === 'dependencyManagement') {
		const mgmtBlock = extractBlock(content, 'dependencyManagement');
		if (!mgmtBlock) { return results; }
		searchIn = mgmtBlock;
	} else {
		searchIn = content.replace(/<dependencyManagement[\s\S]*?<\/dependencyManagement>/g, '');
	}

	const depRe = /<dependency>([\s\S]*?)<\/dependency>/g;
	let match: RegExpExecArray | null;

	while ((match = depRe.exec(searchIn)) !== null) {
		const block = match[1];

		const groupId    = extractTag(block, 'groupId');
		const artifactId = extractTag(block, 'artifactId');
		if (!groupId || !artifactId) { continue; }

		const rawVersion = extractTag(block, 'version') ?? '';
		const scope      = extractTag(block, 'scope') ?? 'compile';
		const type       = extractTag(block, 'type') ?? 'jar';

		if (type === 'pom' && scope === 'import') { continue; }

		let version = resolveProperty(rawVersion, properties);

		// Si no hay versión, buscar en el BOM del parent
		if (!version) {
			const fullName = `${groupId}:${artifactId}`;
			version = bomVersions.get(fullName) ?? bomVersions.get(artifactId) ?? '';
		}

		const name = `${groupId}:${artifactId}`;
		results.push({
			name,
			groupId,
			artifactId,
			version: version || 'unknown',
			exactVersion: isExactVersion(version),
			section,
			scope,
			hasPrivateRepos: false, // sobreescrito por parsePomXml/parsePomXmlAsync
		});
	}

	return results;
}

function extractBlock(content: string, tag: string): string | null {
	const open  = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'g');
	const close = new RegExp(`<\\/${tag}>`, 'g');
	open.lastIndex = 0;
	const openMatch = open.exec(content);
	if (!openMatch) { return null; }
	const start = openMatch.index + openMatch[0].length;
	close.lastIndex = start;
	const closeMatch = close.exec(content);
	if (!closeMatch) { return null; }
	return content.slice(start, closeMatch.index);
}

function extractTag(block: string, tag: string): string | null {
	const re = new RegExp(`<${tag}>\\s*([^<]+)\\s*<\\/${tag}>`);
	const m  = block.match(re);
	return m ? m[1].trim() : null;
}

function resolveProperty(value: string, properties: Map<string, string>): string {
	if (!value) { return value; }
	return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
		return properties.get(key) ?? `\${${key}}`;
	});
}

function isExactVersion(version: string): boolean {
	if (!version) { return false; }
	if (version.includes('${')) { return false; }
	if (version.startsWith('[') || version.startsWith('(')) { return false; }

	const upper = version.toUpperCase();
	if (upper.includes('SNAPSHOT')) { return false; }
	if (version === 'LATEST' || version === 'RELEASE') { return false; }

	// Pre-releases no exactos
	if (/-(alpha|beta|rc\d*|m\d+|ea|preview|incubating)/i.test(version)) { return false; }
	if (version.includes('+')) { return false; } // build metadata: 25-ea+21

	// Sufijos de release estables válidos en Maven:
	// -GA (General Availability), -Final, -RELEASE, -jre11, -jre8, -android, -b123 (build number)
	// Estos son versiones exactas perfectamente válidas.
	// Formato: dígitos y puntos, opcionalmente seguidos de un sufijo -PALABRA o -NúmeroLetra
	return /^\d[\d.]*(-[a-zA-Z0-9]+)?$/.test(version);
}

import * as fs from 'fs';

export interface ParsedPackage {
	name: string;         // "groupId:artifactId" — formato Maven Central
	groupId: string;
	artifactId: string;
	version: string;      // versión resuelta, o "unknown" si no hay versión declarada
	exactVersion: boolean;
	section: string;      // 'dependencies' | 'dependencyManagement'
	scope: string;        // 'compile' | 'test' | 'provided' | 'runtime' | 'system'
}

/**
 * Parser de pom.xml.
 *
 * Soporta:
 * - Dependencias en <dependencies> y <dependencyManagement>
 * - Resolución de versiones como ${property} usando <properties>
 * - También resuelve ${project.version} desde el bloque <project>
 * - Todos los scopes (compile, test, provided, runtime, system)
 * - Dependencias sin versión (heredadas de parent/BOM) → version: "unknown"
 *
 * No soporta (fuera de alcance para análisis estático sin Maven):
 * - Resolución de versiones heredadas de <parent> remoto
 * - Resolución de BOMs importados remotamente
 *
 * En Maven todas las versiones declaradas son exactas por definición
 * (no hay rangos en uso real — los rangos [1.0,2.0) existen en la spec
 * pero son antipattern y casi nunca se usan).
 */
export function parsePomXml(filePath: string): ParsedPackage[] {
	let content: string;
	try {
		content = fs.readFileSync(filePath, 'utf8');
	} catch {
		return [];
	}

	// Extraer properties (incluyendo project.version)
	const properties = extractProperties(content);

	const seen = new Set<string>();
	const results: ParsedPackage[] = [];

	// Procesar dependencyManagement primero (prioridad más baja — dependencies la sobreescribe)
	const mgmtDeps = extractDependencies(content, 'dependencyManagement', properties);
	for (const dep of mgmtDeps) {
		if (!seen.has(dep.name)) {
			seen.add(dep.name);
			results.push(dep);
		}
	}

	// Procesar dependencies (prioridad más alta)
	const directDeps = extractDependencies(content, 'dependencies', properties);
	for (const dep of directDeps) {
		if (seen.has(dep.name)) {
			// Sobreescribir la entrada de dependencyManagement con la directa
			const idx = results.findIndex(r => r.name === dep.name);
			if (idx !== -1) { results[idx] = dep; }
		} else {
			seen.add(dep.name);
			results.push(dep);
		}
	}

	return results;
}

/**
 * Extrae el mapa de <properties> del pom.xml, incluyendo project.version.
 */
function extractProperties(content: string): Map<string, string> {
	const map = new Map<string, string>();

	// project.version desde el bloque raíz <version> (fuera de <dependencies>)
	const projectVersionMatch = content.match(/<project[^>]*>[\s\S]*?<version>\s*([^<]+)\s*<\/version>/);
	if (projectVersionMatch) {
		map.set('project.version', projectVersionMatch[1].trim());
	}

	// Bloque <properties>
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

/**
 * Extrae todas las dependencias de una sección (dependencies o dependencyManagement).
 * En dependencyManagement, el XML es <dependencyManagement><dependencies>...</dependencies></dependencyManagement>
 */
function extractDependencies(
	content: string,
	section: 'dependencies' | 'dependencyManagement',
	properties: Map<string, string>
): ParsedPackage[] {
	const results: ParsedPackage[] = [];

	let searchIn = content;

	if (section === 'dependencyManagement') {
		const mgmtBlock = extractBlock(content, 'dependencyManagement');
		if (!mgmtBlock) { return results; }
		searchIn = mgmtBlock;
	} else {
		// Para <dependencies> directas, excluir el bloque <dependencyManagement>
		// para no procesar las mismas dos veces con la misma regex
		searchIn = content.replace(/<dependencyManagement[\s\S]*?<\/dependencyManagement>/g, '');
	}

	// Extraer cada bloque <dependency>...</dependency>
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

		// Ignorar dependencias de tipo pom con scope import (son BOMs — no son librerías directas)
		if (type === 'pom' && scope === 'import') { continue; }

		// Resolver ${property}
		const version = resolveProperty(rawVersion, properties);
		const name    = `${groupId}:${artifactId}`;

		results.push({
			name,
			groupId,
			artifactId,
			version: version || 'unknown',
			exactVersion: isExactVersion(version),
			section,
			scope,
		});
	}

	return results;
}

/**
 * Extrae el contenido de un bloque XML dado su tag name.
 * Maneja anidamiento simple.
 */
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

/**
 * Extrae el texto de un tag simple dentro de un bloque.
 */
function extractTag(block: string, tag: string): string | null {
	const re = new RegExp(`<${tag}>\\s*([^<]+)\\s*<\\/${tag}>`);
	const m  = block.match(re);
	return m ? m[1].trim() : null;
}

/**
 * Resuelve ${property.name} usando el mapa de properties.
 * Si no se puede resolver, devuelve la cadena original.
 */
function resolveProperty(value: string, properties: Map<string, string>): string {
	if (!value) { return value; }
	return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
		return properties.get(key) ?? `\${${key}}`;
	});
}

/**
 * Una versión es exacta si es un número semver puro (sin ${...} sin resolver,
 * sin rangos Maven [1,2), sin SNAPSHOT, sin LATEST/RELEASE).
 */
function isExactVersion(version: string): boolean {
	if (!version) { return false; }
	if (version.includes('${')) { return false; }           // property no resuelta
	if (version.startsWith('[') || version.startsWith('(')) { return false; } // rango Maven
	if (version.toUpperCase().includes('SNAPSHOT')) { return false; }
	if (version === 'LATEST' || version === 'RELEASE') { return false; }
	return /^\d[\d.]*$/.test(version);
}

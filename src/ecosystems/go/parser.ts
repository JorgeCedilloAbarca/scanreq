import * as fs from 'fs';

export interface ParsedPackage {
	name: string;       // módulo completo, e.g. "github.com/gin-gonic/gin"
	version: string;    // e.g. "1.9.1" (sin la "v" inicial)
	exactVersion: boolean;
}

/**
 * Parser de go.mod.
 * Soporta el bloque require() multilínea y las directivas require individuales.
 * Ignora: replace, exclude, retract.
 *
 * Formato típico:
 *   require (
 *     github.com/gin-gonic/gin v1.9.1
 *     github.com/stretchr/testify v1.8.4 // indirect
 *   )
 *   require github.com/some/pkg v0.1.0
 */
export function parseGoMod(filePath: string): ParsedPackage[] {
	const content = fs.readFileSync(filePath, 'utf8');
	const lines = content.split('\n');
	const results: ParsedPackage[] = [];

	let inRequireBlock = false;

	for (const rawLine of lines) {
		const line = rawLine.trim();

		// Inicio de bloque require (...)
		if (line === 'require (' || line === 'require(') {
			inRequireBlock = true;
			continue;
		}

		// Fin de bloque
		if (inRequireBlock && line === ')') {
			inRequireBlock = false;
			continue;
		}

		if (inRequireBlock) {
			const pkg = parseRequireLine(line);
			if (pkg) { results.push(pkg); }
			continue;
		}

		// require individual: require github.com/pkg v1.0.0
		if (line.startsWith('require ') && !line.includes('(')) {
			const rest = line.slice('require '.length).trim();
			const pkg = parseRequireLine(rest);
			if (pkg) { results.push(pkg); }
		}
	}

	return results;
}

function parseRequireLine(line: string): ParsedPackage | null {
	if (!line || line.startsWith('//') || line.startsWith('#')) { return null; }

	// Eliminar comentario inline "// indirect"
	const withoutComment = line.split('//')[0].trim();
	if (!withoutComment) { return null; }

	// Formato: "module/path v1.2.3"
	const parts = withoutComment.split(/\s+/);
	if (parts.length < 2) { return null; }

	const name = parts[0];
	const rawVersion = parts[1];

	// Las versiones de Go siempre empiezan con "v" — es obligatorio en go.mod
	if (!rawVersion.startsWith('v')) { return null; }

	// Eliminar la "v" inicial para normalizar: "v1.9.1" → "1.9.1"
	const version = rawVersion.slice(1);

	// En go.mod todas las versiones son exactas por definición
	// (los rangos no existen en go.mod — el lockfile go.sum maneja la resolución)
	return { name, version, exactVersion: true };
}

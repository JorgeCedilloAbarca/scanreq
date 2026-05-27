import * as fs from 'fs';
import * as path from 'path';

export interface ParsedPackage {
	name: string;
	version: string;
	exactVersion: boolean;
}

export function readFileWithEncoding(filePath: string): string {
	const buffer = fs.readFileSync(filePath);

	// UTF-16 LE: BOM FF FE
	if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
		return buffer.slice(2).toString('utf16le');
	}

	// UTF-16 BE: BOM FE FF
	if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
		const swapped = Buffer.alloc(buffer.length - 2);
		for (let i = 2; i < buffer.length - 1; i += 2) {
			swapped[i - 2] = buffer[i + 1];
			swapped[i - 1] = buffer[i];
		}
		return swapped.toString('utf16le');
	}

	// UTF-8 con BOM: EF BB BF
	if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
		return buffer.slice(3).toString('utf8');
	}

	// UTF-8 sin BOM — caso más común
	return buffer.toString('utf8');
}

/**
 * Parsea el contenido de un requirements.txt como string puro.
 * Solo procesa líneas de paquetes — las líneas -r/-c se ignoran aquí
 * (son manejadas por parseRequirementsFile que conoce el path).
 *
 * Esta función permanece pura (string → ParsedPackage[]) para facilitar tests.
 */
export function parseRequirements(content: string): ParsedPackage[] {
	const specifierRegex = /^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?(\[.*?\])?)\s*((?:[><!~]?=|[><]|~=).+)?$/;

	return content
		.split('\n')
		.map(line => line.trim())
		.filter(line => line && !line.startsWith('#') && !line.startsWith('-'))
		.map(line => {
			const withoutComment = line.split('#')[0].trim();
			const match = withoutComment.match(specifierRegex);
			if (!match) {
				return { name: withoutComment, version: 'unknown', exactVersion: false };
			}
			const name = match[1].trim();
			const fullSpec = match[4]?.trim() ?? '';

			if (!fullSpec) {
				return { name, version: 'unknown', exactVersion: false };
			}

			const isExact = fullSpec.startsWith('==') && !fullSpec.includes(',');

			if (isExact) {
				const versionNumber = fullSpec.replace(/^==/, '').trim();
				return { name, version: versionNumber, exactVersion: true };
			}

			// No exacto: extraer la primera versión numérica del specifier
			const versionMatch = fullSpec.match(/(\d+(?:\.\d+)*)/);
			const versionNumber = versionMatch ? versionMatch[1] : 'unknown';

			return { name, version: versionNumber, exactVersion: false };
		});
}

/**
 * Lee un requirements.txt desde disco y resuelve recursivamente las directivas -r.
 *
 * Soporta:
 *   -r ruta/relativa.txt
 *   -r ruta/relativa.txt  # comentario inline
 *   --requirement ruta/relativa.txt  (forma larga)
 *
 * Las directivas -c (constraints) se ignoran — solo afectan a pip resolver,
 * no declaran paquetes que ScanReq deba analizar.
 *
 * El parámetro `visited` es el set de rutas ya procesadas (normalizadas con
 * path.resolve) que evita bucles circulares: si requirements/base.txt incluye
 * -r ../requirements.txt y este a su vez incluye -r requirements/base.txt,
 * la segunda visita se descarta silenciosamente.
 */
export function parseRequirementsFile(
	filePath: string,
	visited: Set<string> = new Set()
): ParsedPackage[] {
	const resolvedPath = path.resolve(filePath);

	// Protección anti-bucle
	if (visited.has(resolvedPath)) {
		return [];
	}
	visited.add(resolvedPath);

	let content: string;
	try {
		content = readFileWithEncoding(resolvedPath);
	} catch {
		// Archivo hijo no encontrado — lo ignoramos silenciosamente.
		// El usuario puede tener un -r apuntando a un archivo opcional
		// o generado que no existe en el repo.
		return [];
	}

	const results: ParsedPackage[] = [];
	const dir = path.dirname(resolvedPath);

	for (const rawLine of content.split('\n')) {
		const line = rawLine.trim();

		// Ignorar vacías y comentarios puros
		if (!line || line.startsWith('#')) { continue; }

		// Detectar -r / --requirement ANTES del filtro genérico de --
		// (--requirement empieza con -- pero es una referencia válida a otro archivo)
		const refMatch = line.match(/^(?:-r|--requirement)\s+(\S+)/);
		if (refMatch) {
			// Resolver la ruta relativa al directorio del archivo actual
			const childPath = path.resolve(dir, refMatch[1]);
			const childPackages = parseRequirementsFile(childPath, visited);
			results.push(...childPackages);
			continue;
		}

		// Ignorar --no-binary, --index-url y demás opciones de pip con --
		if (line.startsWith('--')) { continue; }

		// Ignorar -c (constraints) y cualquier otro flag de pip con -
		if (line.startsWith('-')) { continue; }

		// Línea de paquete — parsear con la función pura
		const withoutComment = line.split('#')[0].trim();
		if (!withoutComment) { continue; }

		const parsed = parseRequirements(withoutComment);
		results.push(...parsed);
	}

	// Deduplicar por nombre — primera aparición gana (el archivo raíz tiene prioridad)
	const seen = new Set<string>();
	const deduped: ParsedPackage[] = [];
	for (const pkg of results) {
		const key = pkg.name.toLowerCase().replace(/\[.*?\]$/, '');
		if (!seen.has(key)) {
			seen.add(key);
			deduped.push(pkg);
		}
	}

	return deduped;
}

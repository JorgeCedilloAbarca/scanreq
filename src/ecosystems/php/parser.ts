import * as fs from 'fs';
import * as path from 'path';

export interface ParsedPackage {
	name: string;       // e.g. "symfony/console"
	version: string;    // e.g. "6.4.0" (sin el prefijo "v")
	exactVersion: boolean;
	section: string;    // 'require' | 'require-dev'
}

/**
 * Parser de composer.json.
 *
 * Secciones soportadas: require, require-dev
 * Specifiers soportados:
 *   - Exacto:   "6.4.0"   → exactVersion: true
 *   - Caret:    "^6.4"    → exactVersion: false  (compatible semver)
 *   - Tilde:    "~6.4.0"  → exactVersion: false
 *   - Rango:    ">=6.0"   → exactVersion: false
 *   - Wildcard: "6.*"     → exactVersion: false
 *   - OR/AND:   "^6.0|^7.0" → exactVersion: false
 *
 * Se ignoran:
 *   - "php" (el propio runtime)
 *   - extensiones "ext-*"
 *   - "self.version", "dev-*"
 *
 * Si existe composer.lock en el mismo directorio o en un directorio padre
 * (patrón monorepo como laravel/framework), se usa para obtener la versión
 * instalada real (más preciso que el specifier).
 */
export function parseComposerJson(filePath: string): ParsedPackage[] {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, 'utf8');
	} catch {
		return [];
	}

	let json: any;
	try {
		json = JSON.parse(raw);
	} catch {
		return [];
	}

	const lockVersions = readLockFile(filePath);

	const seen = new Set<string>();
	const results: ParsedPackage[] = [];

	const SECTIONS: Array<{ key: string; section: string }> = [
		{ key: 'require',     section: 'require'     },
		{ key: 'require-dev', section: 'require-dev' },
	];

	for (const { key, section } of SECTIONS) {
		const deps = json[key];
		if (!deps || typeof deps !== 'object') { continue; }

		for (const [rawName, rawSpec] of Object.entries(deps)) {
			const name = rawName.toLowerCase();

			// Ignorar el runtime PHP y extensiones
			if (name === 'php' || name.startsWith('ext-') || name.startsWith('lib-')) { continue; }

			// Ignorar dev-* (referencias a ramas git)
			const spec = String(rawSpec);
			if (spec.startsWith('dev-') || spec === 'self.version') { continue; }

			if (seen.has(name)) { continue; }
			seen.add(name);

			const { version, exactVersion } = parseVersionSpec(spec);

			// Si tenemos composer.lock, sobreescribimos la versión instalada
			const lockedVersion = lockVersions.get(name);

			results.push({
				name,
				version: lockedVersion ?? version,
				exactVersion: lockedVersion !== undefined ? true : exactVersion,
				section,
			});
		}
	}

	return results;
}

/**
 * Busca composer.lock subiendo directorios desde el composer.json dado.
 *
 * En monorepos PHP, los sub-paquetes no tienen su propio lock - el lock
 * está en la raíz del workspace. Esta función sube hasta MAX_DEPTH
 * niveles para encontrarlo, igual que readCargoLock para Rust.
 *
 * Si el lock está en el mismo directorio se usa directamente (caso
 * habitual en proyectos normales). Si no existe ningún lock en la
 * jerarquía, devuelve mapa vacío y el comportamiento es idéntico al anterior.
 *
 * Packagist normaliza los nombres a minúsculas; hacemos lo mismo.
 */
function readLockFile(composerJsonPath: string): Map<string, string> {
	const MAX_DEPTH = 5;
	const map = new Map<string, string>();

	let dir = path.dirname(path.resolve(composerJsonPath));

	for (let i = 0; i < MAX_DEPTH; i++) {
		const lockPath = path.join(dir, 'composer.lock');

		if (fs.existsSync(lockPath)) {
			let raw: string;
			try {
				raw = fs.readFileSync(lockPath, 'utf8');
			} catch {
				return map;
			}

			let lock: any;
			try {
				lock = JSON.parse(raw);
			} catch {
				return map;
			}

			const allPackages = [
				...(Array.isArray(lock.packages)        ? lock.packages        : []),
				...(Array.isArray(lock['packages-dev']) ? lock['packages-dev'] : []),
			];

			for (const pkg of allPackages) {
				if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') { continue; }
				const name    = pkg.name.toLowerCase();
				const version = normalizeVersion(pkg.version);
				if (!map.has(name)) {
					map.set(name, version);
				}
			}

			return map;
		}

		// Subir un nivel
		const parent = path.dirname(dir);
		if (parent === dir) { break; } // raíz del filesystem
		dir = parent;
	}

	return map;
}

/**
 * Analiza un specifier de versión Composer y devuelve version + exactVersion.
 * Elimina el prefijo "v" si lo lleva (e.g. "v6.4.0" → "6.4.0").
 */
function parseVersionSpec(spec: string): { version: string; exactVersion: boolean } {
	// Exacto: solo dígitos y puntos (opcionalmente con "v" inicial)
	// Ej: "6.4.0", "v6.4.0", "1.0"
	const exactRe = /^v?(\d+(?:\.\d+)*)$/;
	const exactMatch = spec.match(exactRe);
	if (exactMatch) {
		return { version: exactMatch[1], exactVersion: true };
	}

	// No exacto — extraer el primer número de versión encontrado como referencia
	const versionRe = /v?(\d+(?:\.\d+)*)/;
	const m = spec.match(versionRe);
	const version = m ? m[1] : 'unknown';
	return { version, exactVersion: false };
}

/**
 * Normaliza una versión quitando el prefijo "v" si lo lleva.
 */
function normalizeVersion(version: string): string {
	return version.startsWith('v') ? version.slice(1) : version;
}

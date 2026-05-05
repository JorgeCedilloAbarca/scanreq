import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// ─── Caché de lockfile por workspace ─────────────────────────────────────────
// Evita releer y reparsear el lockfile en cada paquete del mismo scan.
// Se limpia al inicio de cada scan (llamando clearLockfileCache()).

let lockfileCache: Map<string, string> | null = null;
let lockfileCacheRoot: string | null = null;

export function clearLockfileCache(): void {
	lockfileCache = null;
	lockfileCacheRoot = null;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Detecta la versión instalada de un paquete npm con la siguiente prioridad:
 *
 * 1. node_modules/{package}/package.json  — más preciso, lectura directa
 * 2. package-lock.json                    — lockfile de npm
 * 3. pnpm-lock.yaml                       — lockfile de pnpm
 * 4. yarn.lock                            — lockfile de yarn (classic y berry)
 *
 * Devuelve null si no se puede determinar la versión por ningún método.
 */
export async function getInstalledVersionFromNodeModules(
	packageName: string,
	packageDir?: string
): Promise<string | null> {
	// Usar la carpeta del package.json si se proporciona (monorepo support)
	// Fallback al workspace root para compatibilidad hacia atrás
	const searchRoot = packageDir ?? getWorkspaceRoot();
	if (!searchRoot) { return null; }

	// 1. node_modules — más preciso
	const fromNodeModules = readFromNodeModules(searchRoot, packageName);
	if (fromNodeModules) { return fromNodeModules; }

	// 2-4. Lockfiles — fallback cuando node_modules no existe
	return readFromLockfile(searchRoot, packageName);
}

/**
 * Verifica si node_modules existe en el workspace.
 * Ahora también devuelve true si hay un lockfile disponible como alternativa.
 */
export function checkNodeModulesAvailability(packageDir?: string): boolean {
	const searchRoot = packageDir ?? getWorkspaceRoot();
	if (!searchRoot) { return false; }

	// node_modules presente
	if (fs.existsSync(path.join(searchRoot, 'node_modules'))) { return true; }

	// Lockfile presente — podemos resolver versiones aunque no haya node_modules
	return (
		fs.existsSync(path.join(searchRoot, 'package-lock.json')) ||
		fs.existsSync(path.join(searchRoot, 'pnpm-lock.yaml')) ||
		fs.existsSync(path.join(searchRoot, 'yarn.lock'))
	);
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function getWorkspaceRoot(): string | null {
	const folders = vscode.workspace.workspaceFolders;
	return folders ? folders[0].uri.fsPath : null;
}

function readFromNodeModules(workspaceRoot: string, packageName: string): string | null {
	const pkgJsonPath = path.join(workspaceRoot, 'node_modules', packageName, 'package.json');
	try {
		if (!fs.existsSync(pkgJsonPath)) { return null; }
		const json = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
		return typeof json.version === 'string' ? json.version : null;
	} catch {
		return null;
	}
}

/**
 * Lee la versión instalada desde el lockfile disponible en el workspace.
 * Usa caché para no releer el archivo en cada paquete del scan.
 */
function readFromLockfile(searchRoot: string, packageName: string): string | null {
	// Usar caché si ya parseamos el lockfile para este directorio
	if (lockfileCache && lockfileCacheRoot === searchRoot) {
		return lockfileCache.get(packageName) ?? null;
	}

	// Intentar cada lockfile en orden de preferencia
	const map =
		tryParsePackageLock(searchRoot) ??
		tryParsePnpmLock(searchRoot) ??
		tryParseYarnLock(searchRoot);

	if (!map) { return null; }

	// Guardar en caché
	lockfileCache = map;
	lockfileCacheRoot = searchRoot;

	return map.get(packageName) ?? null;
}

// ─── Parser: package-lock.json (npm) ─────────────────────────────────────────

/**
 * Parsea package-lock.json v2/v3.
 * Estructura:
 *   { "packages": { "node_modules/react": { "version": "18.3.1" } } }
 *   o v1: { "dependencies": { "react": { "version": "18.3.1" } } }
 */
function tryParsePackageLock(workspaceRoot: string): Map<string, string> | null {
	const lockPath = path.join(workspaceRoot, 'package-lock.json');
	try {
		if (!fs.existsSync(lockPath)) { return null; }
		const json = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
		const map = new Map<string, string>();

		// v2/v3: "packages" con claves "node_modules/{name}" o "node_modules/@scope/{name}"
		if (json.packages && typeof json.packages === 'object') {
			for (const [key, value] of Object.entries(json.packages as Record<string, any>)) {
				if (!key.startsWith('node_modules/')) { continue; }
				const name = key.slice('node_modules/'.length);
				if (typeof value?.version === 'string') {
					map.set(name, value.version);
				}
			}
			if (map.size > 0) { return map; }
		}

		// v1: "dependencies"
		if (json.dependencies && typeof json.dependencies === 'object') {
			for (const [name, value] of Object.entries(json.dependencies as Record<string, any>)) {
				if (typeof value?.version === 'string') {
					map.set(name, value.version);
				}
			}
			if (map.size > 0) { return map; }
		}

		return null;
	} catch {
		return null;
	}
}

// ─── Parser: pnpm-lock.yaml (pnpm) ───────────────────────────────────────────

/**
 * Parsea pnpm-lock.yaml sin librería YAML — regex sobre el texto plano.
 *
 * Formato v6 (pnpm 8):
 *   dependencies:
 *     react:
 *       specifier: ^18.3.1
 *       version: 18.3.1
 *   devDependencies:
 *     vite:
 *       specifier: ^5.4.1
 *       version: 5.4.1(...)   ← sufijo de peers — extraer solo la versión base
 *
 * Formato v5 (pnpm 7):
 *   dependencies:
 *     react: 18.3.1
 *     '@emotion/react': 11.13.3(...)
 */
function tryParsePnpmLock(workspaceRoot: string): Map<string, string> | null {
	const lockPath = path.join(workspaceRoot, 'pnpm-lock.yaml');
	try {
		if (!fs.existsSync(lockPath)) { return null; }
		const content = fs.readFileSync(lockPath, 'utf8');
		const map = new Map<string, string>();

		const lines = content.split(/\r?\n/);
		let inDepsSection = false;
		let currentPackage: string | null = null;

		for (const line of lines) {
			// Detectar secciones de dependencias
			if (/^(dependencies|devDependencies|optionalDependencies):/.test(line)) {
				inDepsSection = true;
				currentPackage = null;
				continue;
			}

			// Salir de la sección al encontrar otra clave de nivel raíz
			if (/^\w/.test(line) && !line.startsWith(' ') && !line.startsWith('\t')) {
				if (!/^(dependencies|devDependencies|optionalDependencies):/.test(line)) {
					inDepsSection = false;
					currentPackage = null;
				}
				continue;
			}

			if (!inDepsSection) { continue; }

			// Nombre del paquete (indentado con 2 espacios, termina en :)
			// Soporta nombres normales y scoped (@scope/name)
			const nameMatch = line.match(/^  ['"]?(@?[a-zA-Z0-9][a-zA-Z0-9._\-/]*)['"]?:\s*$/);
			if (nameMatch) {
				currentPackage = nameMatch[1];
				continue;
			}

			if (currentPackage) {
				// Formato v6: "    version: 18.3.1" o "    version: 18.3.1(react@18.3.1)"
				const versionMatch = line.match(/^\s+version:\s+['"]?([^\s('"]+)/);
				if (versionMatch) {
					// Extraer solo la versión base antes del primer "("
					const version = versionMatch[1].split('(')[0].trim();
					if (version && !map.has(currentPackage)) {
						map.set(currentPackage, version);
					}
					currentPackage = null;
					continue;
				}

				// Formato v5: "  react: 18.3.1" — versión inline después del nombre
				// Ya procesado por nameMatch anterior si termina en ":"
				// Caso: "  react: 18.3.1(peers...)"
				const inlineMatch = line.match(/^  ['"]?(@?[a-zA-Z0-9][a-zA-Z0-9._\-/]*)['"]?:\s+([^\s(]+)/);
				if (inlineMatch && !line.endsWith(':')) {
					const version = inlineMatch[2].split('(')[0].trim();
					if (version && /^\d/.test(version)) {
						map.set(inlineMatch[1], version);
					}
				}
			}
		}

		return map.size > 0 ? map : null;
	} catch {
		return null;
	}
}

// ─── Parser: yarn.lock (yarn classic v1 y berry v2+) ─────────────────────────

/**
 * Parsea yarn.lock — formato propio de Yarn, no YAML estándar.
 *
 * Yarn Classic (v1):
 *   "react@^18.3.1":
 *     version "18.3.1"
 *     resolved "..."
 *
 * Yarn Berry (v2+):
 *   "react@npm:^18.3.1":
 *     version: 18.3.1
 *
 * Múltiples specifiers para el mismo paquete:
 *   "react@^18.0.0, react@^18.3.1":
 *     version "18.3.1"
 */
function tryParseYarnLock(workspaceRoot: string): Map<string, string> | null {
	const lockPath = path.join(workspaceRoot, 'yarn.lock');
	try {
		if (!fs.existsSync(lockPath)) { return null; }
		const content = fs.readFileSync(lockPath, 'utf8');
		const map = new Map<string, string>();

		const lines = content.split(/\r?\n/);
		let currentPackages: string[] = [];

		for (const line of lines) {
			// Comentarios y líneas vacías
			if (line.startsWith('#') || line.trim() === '') {
				currentPackages = [];
				continue;
			}

			// Encabezado de bloque — uno o varios specifiers separados por coma
			// Yarn classic: "react@^18.3.1":
			// Yarn berry:   "react@npm:^18.3.1":
			if (!line.startsWith(' ') && line.endsWith(':')) {
				const header = line.replace(/^"|"$/g, '').replace(/:$/, '');
				currentPackages = header.split(', ').map(s => {
					// Extraer nombre base del specifier
					// "@scope/name@npm:^1.0" → "@scope/name"
					// "react@^18.3.1" → "react"
					const atIdx = s.startsWith('@')
						? s.indexOf('@', 1)   // scoped: buscar @ después del primer carácter
						: s.indexOf('@');
					return atIdx > 0 ? s.slice(0, atIdx) : s;
				}).filter(Boolean);
				continue;
			}

			// Versión del bloque
			// Yarn classic: `  version "18.3.1"`
			// Yarn berry:   `  version: 18.3.1`
			if (currentPackages.length > 0) {
				const versionMatch = line.match(/^\s+version[:\s]+"?([^\s"]+)"?/);
				if (versionMatch) {
					const version = versionMatch[1];
					for (const pkg of currentPackages) {
						if (!map.has(pkg)) {
							map.set(pkg, version);
						}
					}
					currentPackages = [];
				}
			}
		}

		return map.size > 0 ? map : null;
	} catch {
		return null;
	}
}

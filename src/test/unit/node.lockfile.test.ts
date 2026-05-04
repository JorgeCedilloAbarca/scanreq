import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Importamos las funciones internas a través de un helper de test
// ya que clearLockfileCache y los parsers internos se exponen via getInstalledVersionFromNodeModules.
// Testeamos el comportamiento observable: dado un lockfile en un directorio,
// ¿devuelve la versión correcta?

// Para testear sin VS Code, mockeamos vscode.workspace
// Vitest permite esto con vi.mock pero la forma más simple es
// testear los parsers individualmente exportándolos.
// En este caso testeamos la lógica de parsing de forma unitaria
// recreando los parsers como funciones puras de texto → Map.

// ─── Parsers extraídos para test unitario ────────────────────────────────────

function parsePackageLock(content: string): Map<string, string> {
	const map = new Map<string, string>();
	try {
		const json = JSON.parse(content);
		if (json.packages && typeof json.packages === 'object') {
			for (const [key, value] of Object.entries(json.packages as Record<string, any>)) {
				if (!key.startsWith('node_modules/')) { continue; }
				const name = key.slice('node_modules/'.length);
				if (typeof value?.version === 'string') { map.set(name, value.version); }
			}
			if (map.size > 0) { return map; }
		}
		if (json.dependencies && typeof json.dependencies === 'object') {
			for (const [name, value] of Object.entries(json.dependencies as Record<string, any>)) {
				if (typeof value?.version === 'string') { map.set(name, value.version); }
			}
		}
	} catch { /* noop */ }
	return map;
}

function parsePnpmLock(content: string): Map<string, string> {
	const map = new Map<string, string>();
	const lines = content.split(/\r?\n/);
	let inDepsSection = false;
	let currentPackage: string | null = null;

	for (const line of lines) {
		if (/^(dependencies|devDependencies|optionalDependencies):/.test(line)) {
			inDepsSection = true; currentPackage = null; continue;
		}
		if (/^\w/.test(line) && !line.startsWith(' ') && !line.startsWith('\t')) {
			if (!/^(dependencies|devDependencies|optionalDependencies):/.test(line)) {
				inDepsSection = false; currentPackage = null;
			}
			continue;
		}
		if (!inDepsSection) { continue; }

		const nameMatch = line.match(/^  ['"]?(@?[a-zA-Z0-9][a-zA-Z0-9._\-/]*)['"]?:\s*$/);
		if (nameMatch) { currentPackage = nameMatch[1]; continue; }

		if (currentPackage) {
			const versionMatch = line.match(/^\s+version:\s+['"]?([^\s('"]+)/);
			if (versionMatch) {
				const version = versionMatch[1].split('(')[0].trim();
				if (version && !map.has(currentPackage)) { map.set(currentPackage, version); }
				currentPackage = null;
			}
		}

		const inlineMatch = line.match(/^  ['"]?(@?[a-zA-Z0-9][a-zA-Z0-9._\-/]*)['"]?:\s+([^\s(]+)/);
		if (inlineMatch && !line.endsWith(':') && inDepsSection) {
			const version = inlineMatch[2].split('(')[0].trim();
			if (version && /^\d/.test(version) && !map.has(inlineMatch[1])) {
				map.set(inlineMatch[1], version);
			}
		}
	}
	return map;
}

function parseYarnLock(content: string): Map<string, string> {
	const map = new Map<string, string>();
	const lines = content.split(/\r?\n/);
	let currentPackages: string[] = [];

	for (const line of lines) {
		if (line.startsWith('#') || line.trim() === '') { currentPackages = []; continue; }

		if (!line.startsWith(' ') && line.endsWith(':')) {
			const header = line.replace(/^"|"$/g, '').replace(/:$/, '');
			currentPackages = header.split(', ').map(s => {
				const atIdx = s.startsWith('@') ? s.indexOf('@', 1) : s.indexOf('@');
				return atIdx > 0 ? s.slice(0, atIdx) : s;
			}).filter(Boolean);
			continue;
		}

		if (currentPackages.length > 0) {
			const versionMatch = line.match(/^\s+version[:\s]+"?([^\s"]+)"?/);
			if (versionMatch) {
				for (const pkg of currentPackages) {
					if (!map.has(pkg)) { map.set(pkg, versionMatch[1]); }
				}
				currentPackages = [];
			}
		}
	}
	return map;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('parsePackageLock (package-lock.json)', () => {

	it('parsea formato v2/v3 con node_modules/', () => {
		const lock = JSON.stringify({
			lockfileVersion: 3,
			packages: {
				'node_modules/react': { version: '18.3.1' },
				'node_modules/react-dom': { version: '18.3.1' },
				'node_modules/@types/node': { version: '22.0.0' },
			}
		});
		const map = parsePackageLock(lock);
		expect(map.get('react')).toBe('18.3.1');
		expect(map.get('react-dom')).toBe('18.3.1');
		expect(map.get('@types/node')).toBe('22.0.0');
	});

	it('parsea formato v1 con dependencies', () => {
		const lock = JSON.stringify({
			lockfileVersion: 1,
			dependencies: {
				react: { version: '18.3.1' },
				lodash: { version: '4.17.21' },
			}
		});
		const map = parsePackageLock(lock);
		expect(map.get('react')).toBe('18.3.1');
		expect(map.get('lodash')).toBe('4.17.21');
	});

	it('prioriza formato v2 sobre v1 si ambos existen', () => {
		const lock = JSON.stringify({
			lockfileVersion: 2,
			packages: {
				'node_modules/react': { version: '18.3.1' },
			},
			dependencies: {
				react: { version: '17.0.0' }, // más antiguo
			}
		});
		const map = parsePackageLock(lock);
		expect(map.get('react')).toBe('18.3.1');
	});

	it('devuelve mapa vacío si el JSON es inválido', () => {
		const map = parsePackageLock('no es json');
		expect(map.size).toBe(0);
	});
});

describe('parsePnpmLock (pnpm-lock.yaml)', () => {

	it('parsea versiones simples en dependencies', () => {
		const lock = `lockfileVersion: '6.0'

dependencies:
  react:
    specifier: ^18.3.1
    version: 18.3.1
  lodash:
    specifier: ^4.17.21
    version: 4.17.21
`;
		const map = parsePnpmLock(lock);
		expect(map.get('react')).toBe('18.3.1');
		expect(map.get('lodash')).toBe('4.17.21');
	});

	it('parsea versiones con sufijo de peers', () => {
		const lock = `lockfileVersion: '6.0'

dependencies:
  '@emotion/react':
    specifier: ^11.13.3
    version: 11.13.3(@types/react@18.3.5)(react@18.3.1)
`;
		const map = parsePnpmLock(lock);
		expect(map.get('@emotion/react')).toBe('11.13.3');
	});

	it('parsea devDependencies', () => {
		const lock = `lockfileVersion: '6.0'

devDependencies:
  vite:
    specifier: ^5.4.1
    version: 5.4.3
`;
		const map = parsePnpmLock(lock);
		expect(map.get('vite')).toBe('5.4.3');
	});

	it('parsea scoped packages', () => {
		const lock = `lockfileVersion: '6.0'

devDependencies:
  '@types/node':
    specifier: ^22.0.0
    version: 22.0.5
`;
		const map = parsePnpmLock(lock);
		expect(map.get('@types/node')).toBe('22.0.5');
	});

	it('parsea el lockfile real del repositorio de prueba', () => {
		const lock = `lockfileVersion: '6.0'

dependencies:
  '@emotion/react':
    specifier: ^11.13.3
    version: 11.13.3(@types/react@18.3.5)(react@18.3.1)
  react:
    specifier: ^18.3.1
    version: 18.3.1
  react-router-dom:
    specifier: ^7.4.0
    version: 7.4.0(react-dom@18.3.1)(react@18.3.1)

devDependencies:
  '@eslint/js':
    specifier: ^9.9.0
    version: 9.9.1
  vite:
    specifier: ^5.4.1
    version: 5.4.3(vite@5.4.3)
`;
		const map = parsePnpmLock(lock);
		expect(map.get('@emotion/react')).toBe('11.13.3');
		expect(map.get('react')).toBe('18.3.1');
		expect(map.get('react-router-dom')).toBe('7.4.0');
		expect(map.get('@eslint/js')).toBe('9.9.1');
		expect(map.get('vite')).toBe('5.4.3');
	});
});

describe('parseYarnLock (yarn.lock)', () => {

	it('parsea formato yarn classic v1', () => {
		const lock = `# yarn lockfile v1

react@^18.3.1:
  version "18.3.1"
  resolved "https://registry.yarnpkg.com/react/-/react-18.3.1.tgz"

lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
`;
		const map = parseYarnLock(lock);
		expect(map.get('react')).toBe('18.3.1');
		expect(map.get('lodash')).toBe('4.17.21');
	});

	it('parsea múltiples specifiers para el mismo paquete', () => {
		const lock = `# yarn lockfile v1

"react@^18.0.0, react@^18.3.1":
  version "18.3.1"
  resolved "https://registry.yarnpkg.com/react/-/react-18.3.1.tgz"
`;
		const map = parseYarnLock(lock);
		expect(map.get('react')).toBe('18.3.1');
	});

	it('parsea scoped packages', () => {
		const lock = `# yarn lockfile v1

"@types/node@^22.0.0":
  version "22.0.5"
  resolved "https://registry.yarnpkg.com/@types/node/-/node-22.0.5.tgz"
`;
		const map = parseYarnLock(lock);
		expect(map.get('@types/node')).toBe('22.0.5');
	});

	it('parsea formato yarn berry v2 (version: sin comillas)', () => {
		const lock = `__metadata:
  version: 6

"react@npm:^18.3.1":
  version: 18.3.1
  resolution: "react@npm:18.3.1"
`;
		const map = parseYarnLock(lock);
		expect(map.get('react')).toBe('18.3.1');
	});

	it('toma la primera versión si hay duplicados', () => {
		const lock = `# yarn lockfile v1

react@^17.0.0:
  version "17.0.2"

react@^18.0.0:
  version "18.3.1"
`;
		const map = parseYarnLock(lock);
		// El primero que aparece gana
		expect(map.get('react')).toBe('17.0.2');
	});
});

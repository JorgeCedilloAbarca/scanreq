import * as fs from 'fs';

export interface ParsedPackage {
	name: string;
	version: string;       // versión tal como aparece en package.json, e.g. "^1.2.3", "~2.0.0", "3.1.4"
	exactVersion: boolean; // true solo si es un número de versión fijo sin prefijo
	section: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies';
}

function isExactVersion(version: string): boolean {
	if (!version || version === '*' || version === 'latest' || version === 'x') {
		return false;
	}
	// Exacta: solo dígitos y puntos, sin prefijos de rango
	return /^\d+(\.\d+)*$/.test(version.trim());
}

function cleanVersion(version: string): string {
	// Eliminar prefijos como ^, ~, >=, etc. para obtener el número base
	return version.replace(/^[\^~>=<*xX\s]+/, '').split(' ')[0].trim();
}

export function parsePackageJson(filePath: string): ParsedPackage[] {
	const content = fs.readFileSync(filePath, 'utf8');
	let json: any;

	try {
		json = JSON.parse(content);
	} catch {
		return [];
	}

	const results: ParsedPackage[] = [];

	const sections: Array<ParsedPackage['section']> = [
		'dependencies',
		'devDependencies',
		'peerDependencies',
		'optionalDependencies'
	];

	for (const section of sections) {
		const deps = json[section];
		if (!deps || typeof deps !== 'object') { continue; }

		for (const [name, rawVersion] of Object.entries(deps)) {
			const version = String(rawVersion ?? '');

			// Ignorar referencias locales, git, URLs
			if (
				version.startsWith('file:') ||
				version.startsWith('git') ||
				version.startsWith('http') ||
				version.startsWith('github:') ||
				version.startsWith('bitbucket:') ||
				version.includes('://')
			) {
				continue;
			}

			const exact = isExactVersion(version);
			const cleanedVersion = exact ? version : cleanVersion(version);

			results.push({
				name,
				version: cleanedVersion || version,
				exactVersion: exact,
				section
			});
		}
	}

	// Deduplicar: si un paquete aparece en varias secciones, quedarse con el de mayor prioridad
	// Orden de prioridad: dependencies > devDependencies > optionalDependencies > peerDependencies
	const PRIORITY: Record<ParsedPackage['section'], number> = {
		dependencies: 0,
		devDependencies: 1,
		optionalDependencies: 2,
		peerDependencies: 3
	};

	const dedupedMap = new Map<string, ParsedPackage>();
	for (const pkg of results) {
		const existing = dedupedMap.get(pkg.name);
		if (!existing || PRIORITY[pkg.section] < PRIORITY[existing.section]) {
			dedupedMap.set(pkg.name, pkg);
		}
	}

	return Array.from(dedupedMap.values());
}

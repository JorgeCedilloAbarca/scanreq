import { describe, it, expect } from 'vitest';
import { parseComposerJson } from '../../ecosystems/php/parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Escribe un composer.json temporal y opcionalmente un composer.lock
 * en el mismo directorio. Devuelve la ruta al composer.json.
 */
function writeTempComposer(
	composerJson: object,
	composerLock?: object
): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanreq-php-test-'));
	const jsonPath = path.join(dir, 'composer.json');
	fs.writeFileSync(jsonPath, JSON.stringify(composerJson));
	if (composerLock) {
		fs.writeFileSync(path.join(dir, 'composer.lock'), JSON.stringify(composerLock));
	}
	return jsonPath;
}

describe('parseComposerJson', () => {

	// ─── Specifiers de versión ────────────────────────────────────────────────

	it('parsea versión exacta sin prefijo v', () => {
		const file = writeTempComposer({ require: { 'symfony/console': '6.4.0' } });
		const result = parseComposerJson(file);
		expect(result[0]).toMatchObject({ name: 'symfony/console', version: '6.4.0', exactVersion: true });
	});

	it('parsea versión exacta con prefijo v', () => {
		const file = writeTempComposer({ require: { 'symfony/console': 'v6.4.0' } });
		const result = parseComposerJson(file);
		expect(result[0]).toMatchObject({ name: 'symfony/console', version: '6.4.0', exactVersion: true });
	});

	it('parsea caret ^ como no exacta', () => {
		const file = writeTempComposer({ require: { 'laravel/framework': '^10.0' } });
		const result = parseComposerJson(file);
		expect(result[0]).toMatchObject({ name: 'laravel/framework', exactVersion: false, version: '10.0' });
	});

	it('parsea tilde ~ como no exacta', () => {
		const file = writeTempComposer({ require: { 'guzzlehttp/guzzle': '~7.5.0' } });
		const result = parseComposerJson(file);
		expect(result[0]).toMatchObject({ name: 'guzzlehttp/guzzle', exactVersion: false });
	});

	it('parsea >= como no exacta', () => {
		const file = writeTempComposer({ require: { 'monolog/monolog': '>=2.0' } });
		const result = parseComposerJson(file);
		expect(result[0]).toMatchObject({ name: 'monolog/monolog', exactVersion: false });
	});

	it('parsea wildcard * como no exacta', () => {
		const file = writeTempComposer({ require: { 'doctrine/orm': '2.*' } });
		const result = parseComposerJson(file);
		expect(result[0]).toMatchObject({ name: 'doctrine/orm', exactVersion: false });
	});

	// ─── Secciones ────────────────────────────────────────────────────────────

	it('parsea require-dev', () => {
		const file = writeTempComposer({ 'require-dev': { 'phpunit/phpunit': '^10.0' } });
		const result = parseComposerJson(file);
		expect(result[0]).toMatchObject({ name: 'phpunit/phpunit', section: 'require-dev' });
	});

	it('deduplica — require tiene prioridad sobre require-dev', () => {
		const file = writeTempComposer({
			require: { 'monolog/monolog': '2.9.0' },
			'require-dev': { 'monolog/monolog': '^2.0' },
		});
		const result = parseComposerJson(file);
		expect(result).toHaveLength(1);
		expect(result[0].section).toBe('require');
		expect(result[0].exactVersion).toBe(true);
	});

	// ─── Exclusiones ─────────────────────────────────────────────────────────

	it('ignora la entrada php', () => {
		const file = writeTempComposer({ require: { 'php': '>=8.1', 'symfony/console': '6.4.0' } });
		const result = parseComposerJson(file);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('symfony/console');
	});

	it('ignora extensiones ext-*', () => {
		const file = writeTempComposer({
			require: { 'ext-json': '*', 'ext-mbstring': '*', 'symfony/console': '6.4.0' }
		});
		const result = parseComposerJson(file);
		expect(result).toHaveLength(1);
	});

	it('ignora lib-*', () => {
		const file = writeTempComposer({ require: { 'lib-curl': '*', 'guzzlehttp/guzzle': '7.8.0' } });
		const result = parseComposerJson(file);
		expect(result).toHaveLength(1);
	});

	it('ignora dev-* (ramas git)', () => {
		const file = writeTempComposer({ require: { 'some/pkg': 'dev-main', 'symfony/console': '6.4.0' } });
		const result = parseComposerJson(file);
		expect(result).toHaveLength(1);
	});

	// ─── composer.lock ────────────────────────────────────────────────────────

	it('usa versión de composer.lock cuando está disponible', () => {
		const lock = {
			packages: [
				{ name: 'symfony/console', version: '6.4.2' }
			],
			'packages-dev': []
		};
		const file = writeTempComposer({ require: { 'symfony/console': '^6.0' } }, lock);
		const result = parseComposerJson(file);
		// La versión del lock sobreescribe la del specifier
		expect(result[0]).toMatchObject({ version: '6.4.2', exactVersion: true });
	});

	it('usa versión de composer.lock para packages-dev', () => {
		const lock = {
			packages: [],
			'packages-dev': [
				{ name: 'phpunit/phpunit', version: '10.5.5' }
			]
		};
		const file = writeTempComposer({ 'require-dev': { 'phpunit/phpunit': '^10.0' } }, lock);
		const result = parseComposerJson(file);
		expect(result[0]).toMatchObject({ version: '10.5.5', exactVersion: true });
	});

	it('normaliza versión con v en composer.lock', () => {
		const lock = {
			packages: [{ name: 'guzzlehttp/guzzle', version: 'v7.8.0' }],
			'packages-dev': []
		};
		const file = writeTempComposer({ require: { 'guzzlehttp/guzzle': '^7.0' } }, lock);
		const result = parseComposerJson(file);
		expect(result[0].version).toBe('7.8.0');
	});

	// ─── Casos borde ─────────────────────────────────────────────────────────

	it('devuelve vacío si no hay secciones require', () => {
		const file = writeTempComposer({ name: 'my/project', description: 'test' });
		const result = parseComposerJson(file);
		expect(result).toHaveLength(0);
	});

	it('devuelve vacío si el JSON es inválido', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanreq-php-test-'));
		const filePath = path.join(dir, 'composer.json');
		fs.writeFileSync(filePath, 'no es json{{{{');
		const result = parseComposerJson(filePath);
		expect(result).toHaveLength(0);
	});

	it('parsea múltiples paquetes en require', () => {
		const file = writeTempComposer({
			require: {
				'symfony/console': '6.4.0',
				'guzzlehttp/guzzle': '^7.0',
				'monolog/monolog': '~3.5',
			}
		});
		const result = parseComposerJson(file);
		expect(result).toHaveLength(3);
		expect(result.map(p => p.name)).toEqual([
			'symfony/console',
			'guzzlehttp/guzzle',
			'monolog/monolog',
		]);
	});

	it('parsea nombres en minúscula (normalización Packagist)', () => {
		const file = writeTempComposer({ require: { 'Symfony/Console': '6.4.0' } });
		const result = parseComposerJson(file);
		expect(result[0].name).toBe('symfony/console');
	});
});

import { describe, it, expect } from 'vitest';
import { parseGemfile } from '../../ecosystems/ruby/parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Escribe un Gemfile temporal y opcionalmente un Gemfile.lock en el mismo directorio.
 * Devuelve la ruta al Gemfile.
 */
function writeTempGemfile(gemfileContent: string, lockContent?: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanreq-ruby-test-'));
	const gemfilePath = path.join(dir, 'Gemfile');
	fs.writeFileSync(gemfilePath, gemfileContent);
	if (lockContent !== undefined) {
		fs.writeFileSync(path.join(dir, 'Gemfile.lock'), lockContent);
	}
	return gemfilePath;
}

describe('parseGemfile', () => {

	// ─── Specifiers de versión ────────────────────────────────────────────────

	it('parsea versión exacta con =', () => {
		const file = writeTempGemfile(`gem "rails", "= 7.1.2"`);
		const result = parseGemfile(file);
		expect(result[0]).toMatchObject({ name: 'rails', version: '7.1.2', exactVersion: true });
	});

	it('parsea versión exacta sin operador', () => {
		const file = writeTempGemfile(`gem 'rails', '7.1.2'`);
		const result = parseGemfile(file);
		expect(result[0]).toMatchObject({ name: 'rails', version: '7.1.2', exactVersion: true });
	});

	it('parsea ~> (pessimistic) como no exacta', () => {
		const file = writeTempGemfile(`gem "rails", "~> 7.0"`);
		const result = parseGemfile(file);
		expect(result[0]).toMatchObject({ name: 'rails', exactVersion: false, version: '7.0' });
	});

	it('parsea >= como no exacta', () => {
		const file = writeTempGemfile(`gem "devise", ">= 4.9"`);
		const result = parseGemfile(file);
		expect(result[0]).toMatchObject({ name: 'devise', exactVersion: false });
	});

	it('parsea rango compuesto como no exacto', () => {
		const file = writeTempGemfile(`gem "rack", ">= 2.0", "< 4.0"`);
		const result = parseGemfile(file);
		expect(result[0]).toMatchObject({ name: 'rack', exactVersion: false });
	});

	it('parsea gem sin versión', () => {
		const file = writeTempGemfile(`gem "pg"`);
		const result = parseGemfile(file);
		expect(result[0]).toMatchObject({ name: 'pg', version: 'unknown', exactVersion: false });
	});

	// ─── Grupos ───────────────────────────────────────────────────────────────

	it('parsea gem en grupo :test', () => {
		const file = writeTempGemfile(`
group :test do
  gem "rspec-rails", "~> 6.0"
end
`);
		const result = parseGemfile(file);
		expect(result[0]).toMatchObject({ name: 'rspec-rails', section: 'group:test' });
	});

	it('parsea gem en grupo :development, :test', () => {
		const file = writeTempGemfile(`
group :development, :test do
  gem "factory_bot_rails"
end
`);
		const result = parseGemfile(file);
		expect(result[0]).toMatchObject({ section: 'group:development,test' });
	});

	it('parsea gems fuera de grupo con section gem', () => {
		const file = writeTempGemfile(`gem "rails", "~> 7.0"`);
		const result = parseGemfile(file);
		expect(result[0].section).toBe('gem');
	});

	it('parsea gems antes y después de un grupo', () => {
		const file = writeTempGemfile(`
gem "rails", "7.1.0"
group :test do
  gem "rspec-rails"
end
gem "pg"
`);
		const result = parseGemfile(file);
		expect(result).toHaveLength(3);
		expect(result[0].section).toBe('gem');
		expect(result[1].section).toBe('group:test');
		expect(result[2].section).toBe('gem');
	});

	// ─── Exclusiones ─────────────────────────────────────────────────────────

	it('ignora gems con :git', () => {
		const file = writeTempGemfile(`gem "my_gem", git: "https://github.com/user/my_gem"`);
		const result = parseGemfile(file);
		expect(result).toHaveLength(0);
	});

	it('ignora gems con :github', () => {
		const file = writeTempGemfile(`gem "my_gem", github: "user/my_gem"`);
		const result = parseGemfile(file);
		expect(result).toHaveLength(0);
	});

	it('ignora gems con :path', () => {
		const file = writeTempGemfile(`gem "local_gem", path: "../local_gem"`);
		const result = parseGemfile(file);
		expect(result).toHaveLength(0);
	});

	it('ignora comentarios', () => {
		const file = writeTempGemfile(`# esto es un comentario\ngem "rails", "7.1.0"`);
		const result = parseGemfile(file);
		expect(result).toHaveLength(1);
	});

	it('ignora líneas vacías', () => {
		const file = writeTempGemfile(`\n\ngem "rails", "7.1.0"\n\n`);
		const result = parseGemfile(file);
		expect(result).toHaveLength(1);
	});

	it('deduplica gems repetidas (primera wins)', () => {
		const file = writeTempGemfile(`gem "rails", "7.1.0"\ngem "rails", "~> 7.0"`);
		const result = parseGemfile(file);
		expect(result).toHaveLength(1);
		expect(result[0].version).toBe('7.1.0');
	});

	// ─── Gemfile.lock ─────────────────────────────────────────────────────────

	it('usa versión de Gemfile.lock cuando está disponible', () => {
		const lock = `GEM
  remote: https://rubygems.org/
  specs:
    rails (7.1.3)
      actioncable (= 7.1.3)
    rake (13.1.0)

BUNDLED WITH
   2.5.4
`;
		const file = writeTempGemfile(`gem "rails", "~> 7.0"`, lock);
		const result = parseGemfile(file);
		const rails = result.find(p => p.name === 'rails');
		expect(rails).toBeDefined();
		expect(rails!.version).toBe('7.1.3');
		expect(rails!.exactVersion).toBe(true);
	});

	it('Gemfile.lock con versión de plataforma strip el sufijo', () => {
		// e.g. "nokogiri (1.16.0-x86_64-linux)" → "1.16.0"
		const lock = `GEM
  remote: https://rubygems.org/
  specs:
    nokogiri (1.16.0-x86_64-linux)

BUNDLED WITH
   2.5.4
`;
		const file = writeTempGemfile(`gem "nokogiri"`, lock);
		const result = parseGemfile(file);
		expect(result[0].version).toBe('1.16.0');
	});

	it('sin Gemfile.lock usa el specifier del Gemfile', () => {
		// No se pasa lock → solo Gemfile
		const file = writeTempGemfile(`gem "rails", "~> 7.1.0"`);
		const result = parseGemfile(file);
		expect(result[0].version).toBe('7.1.0');
		expect(result[0].exactVersion).toBe(false);
	});

	// ─── Nombres con guiones y underscores ───────────────────────────────────

	it('parsea gems con guiones en el nombre', () => {
		const file = writeTempGemfile(`gem "factory_bot_rails", "~> 6.4"\ngem "devise-i18n", "1.12.0"`);
		const result = parseGemfile(file);
		expect(result[0].name).toBe('factory_bot_rails');
		expect(result[1].name).toBe('devise-i18n');
	});

	// ─── Archivo vacío / inexistente ─────────────────────────────────────────

	it('devuelve vacío si el archivo Gemfile no existe', () => {
		const result = parseGemfile('/ruta/que/no/existe/Gemfile');
		expect(result).toHaveLength(0);
	});

	it('parsea múltiples gems', () => {
		const file = writeTempGemfile(`
gem "rails", "~> 7.1"
gem "pg", ">= 1.1"
gem "puma", "~> 6.0"
gem "bootsnap", require: false
`);
		const result = parseGemfile(file);
		expect(result).toHaveLength(4);
		expect(result.map(p => p.name)).toEqual(['rails', 'pg', 'puma', 'bootsnap']);
	});
});

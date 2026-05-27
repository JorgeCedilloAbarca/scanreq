import { describe, it, expect } from 'vitest';
import { parseGemfile } from '../../ecosystems/ruby/parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/**
 * Crea un árbol de archivos en un directorio temporal.
 * Devuelve la ruta al Gemfile raíz.
 */
function writeGemfileTree(files: Record<string, string>): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanreq-ruby-tree-'));
	for (const [relPath, content] of Object.entries(files)) {
		const abs = path.join(dir, relPath);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content);
	}
	return path.join(dir, 'Gemfile');
}

// ─── Specifiers de versión ────────────────────────────────────────────────────

describe('parseGemfile', () => {

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
		const file = writeTempGemfile(`gem "rails", "~> 7.1.0"`);
		const result = parseGemfile(file);
		expect(result[0].version).toBe('7.1.0');
		expect(result[0].exactVersion).toBe(false);
	});

	// ─── Nombres con guiones y underscores ────────────────────────────────────

	it('parsea gems con guiones en el nombre', () => {
		const file = writeTempGemfile(`gem "factory_bot_rails", "~> 6.4"\ngem "devise-i18n", "1.12.0"`);
		const result = parseGemfile(file);
		expect(result[0].name).toBe('factory_bot_rails');
		expect(result[1].name).toBe('devise-i18n');
	});

	// ─── Archivo vacío / inexistente ──────────────────────────────────────────

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

	// ─── eval_gemfile ──────────────────────────────────────────────────────────

	it('eval_gemfile — carga gems del archivo hijo', () => {
		const root = writeGemfileTree({
			'Gemfile':          `gem "rails", "~> 7.1"\neval_gemfile 'gemfiles/common.rb'\n`,
			'gemfiles/common.rb': `gem "sidekiq", "~> 7.0"\ngem "redis", "~> 5.0"\n`,
		});
		const result = parseGemfile(root);
		expect(result.map(p => p.name)).toEqual(['rails', 'sidekiq', 'redis']);
	});

	it('eval_gemfile — usa comillas dobles', () => {
		const root = writeGemfileTree({
			'Gemfile':          `eval_gemfile "gemfiles/common.rb"\n`,
			'gemfiles/common.rb': `gem "sidekiq", "7.2.0"\n`,
		});
		const result = parseGemfile(root);
		expect(result[0]).toMatchObject({ name: 'sidekiq', version: '7.2.0', exactVersion: true });
	});

	it('eval_gemfile — las versiones del Gemfile.lock raíz se aplican a gems de sub-archivos', () => {
		const lock = `GEM
  remote: https://rubygems.org/
  specs:
    sidekiq (7.2.4)
    redis (5.0.8)

BUNDLED WITH
   2.5.4
`;
		const root = writeGemfileTree({
			'Gemfile':            `eval_gemfile 'gemfiles/common.rb'\n`,
			'gemfiles/common.rb': `gem "sidekiq", "~> 7.0"\ngem "redis", "~> 5.0"\n`,
			'Gemfile.lock':       lock,
		});
		const result = parseGemfile(root);
		expect(result.find(p => p.name === 'sidekiq')?.version).toBe('7.2.4');
		expect(result.find(p => p.name === 'sidekiq')?.exactVersion).toBe(true);
		expect(result.find(p => p.name === 'redis')?.version).toBe('5.0.8');
	});

	it('eval_gemfile anidado — sub-archivo llama a otro sub-archivo', () => {
		const root = writeGemfileTree({
			'Gemfile':              `eval_gemfile 'gemfiles/base.rb'\n`,
			'gemfiles/base.rb':     `gem "rails", "~> 7.1"\neval_gemfile 'core.rb'\n`,
			'gemfiles/core.rb':     `gem "pg", "~> 1.5"\n`,
		});
		const result = parseGemfile(root);
		expect(result.map(p => p.name)).toEqual(['rails', 'pg']);
	});

	it('eval_gemfile — archivo hijo inexistente se ignora silenciosamente', () => {
		const root = writeGemfileTree({
			'Gemfile': `gem "rails", "~> 7.1"\neval_gemfile 'gemfiles/optional.rb'\n`,
		});
		const result = parseGemfile(root);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('rails');
	});

	it('eval_gemfile — deduplicación: gem declarada en raíz y en sub-archivo usa la del raíz', () => {
		const root = writeGemfileTree({
			'Gemfile':            `gem "rails", "7.1.0"\neval_gemfile 'gemfiles/common.rb'\n`,
			'gemfiles/common.rb': `gem "rails", "~> 7.0"\ngem "sidekiq", "7.2.0"\n`,
		});
		const result = parseGemfile(root);
		// rails del raíz gana (7.1.0 exacto), no el del hijo
		expect(result.find(p => p.name === 'rails')?.version).toBe('7.1.0');
		expect(result.find(p => p.name === 'rails')?.exactVersion).toBe(true);
		expect(result.find(p => p.name === 'sidekiq')).toBeDefined();
		expect(result).toHaveLength(2);
	});

	it('eval_gemfile — protección anti-bucle circular', () => {
		// Gemfile → a.rb → Gemfile (ciclo)
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanreq-ruby-loop-'));
		const gemfilePath = path.join(dir, 'Gemfile');
		const aPath = path.join(dir, 'a.rb');
		fs.writeFileSync(gemfilePath, `eval_gemfile 'a.rb'\ngem "rails", "7.1.0"\n`);
		fs.writeFileSync(aPath, `eval_gemfile 'Gemfile'\ngem "sidekiq", "7.2.0"\n`);

		// No debe entrar en loop — debe completar y devolver gems sin duplicados
		const result = parseGemfile(gemfilePath);
		expect(result.map(p => p.name)).toContain('rails');
		expect(result.map(p => p.name)).toContain('sidekiq');
		// Sin duplicados
		const names = result.map(p => p.name);
		expect(names.length).toBe(new Set(names).size);
	});

	// ─── Platform-specific gems ───────────────────────────────────────────────

	it('ignora gem con platforms: :windows (patrón wdm en rails)', () => {
		const file = writeTempGemfile(`gem "rails", "~> 7.1"\ngem "wdm", ">= 0.1.0", platforms: :windows\n`);
		const result = parseGemfile(file);
		expect(result.map(p => p.name)).not.toContain('wdm');
		expect(result.map(p => p.name)).toContain('rails');
	});

	it('ignora gem con platforms: %i[ windows jruby ] (sintaxis %i)', () => {
		const file = writeTempGemfile(`gem "rails", "~> 7.1"\ngem "tzinfo-data", platforms: %i[ windows jruby ]\n`);
		const result = parseGemfile(file);
		expect(result.map(p => p.name)).not.toContain('tzinfo-data');
		expect(result.map(p => p.name)).toContain('rails');
	});

	it('ignora gem con platforms: [:windows, :jruby] (sintaxis array Ruby — patrón real en rails/rails)', () => {
		const file = writeTempGemfile(`gem "rails", "~> 7.1"\ngem "tzinfo-data", platforms: [:windows, :jruby]\n`);
		const result = parseGemfile(file);
		expect(result.map(p => p.name)).not.toContain('tzinfo-data');
		expect(result.map(p => p.name)).toContain('rails');
	});

	it('ignora gem con platforms: [:windows] (array de un elemento)', () => {
		const file = writeTempGemfile(`gem "wdm", ">= 0.1.0", platforms: [:windows]\n`);
		const result = parseGemfile(file);
		expect(result).toHaveLength(0);
	});

	it('ignora gem con platforms: :jruby', () => {
		const file = writeTempGemfile(`gem "jruby-specific", "1.0.0", platforms: :jruby\n`);
		const result = parseGemfile(file);
		expect(result).toHaveLength(0);
	});

	it('ignora gem con platforms: mswin, mingw, x64_mingw (%i)', () => {
		const file = writeTempGemfile(`gem "rails", "~> 7.1"\ngem "wdm", "~> 0.1", platforms: %i[ mswin mingw x64_mingw ]\n`);
		const result = parseGemfile(file);
		expect(result.map(p => p.name)).not.toContain('wdm');
	});

	it('NO ignora gem con platforms: que incluye plataformas no-específicas (ruby, mri)', () => {
		const file = writeTempGemfile(`gem "some-gem", "1.0.0", platforms: %i[ ruby windows ]\n`);
		const result = parseGemfile(file);
		expect(result.map(p => p.name)).toContain('some-gem');
	});

	it('NO ignora gem con platforms: si está en el Gemfile.lock (usuario en esa plataforma)', () => {
		const lock = `GEM
  remote: https://rubygems.org/
  specs:
    rails (7.1.3)
    wdm (0.2.0)

BUNDLED WITH
   2.5.4
`;
		const file = writeTempGemfile(
			`gem "rails", "~> 7.1"\ngem "wdm", ">= 0.1.0", platforms: :windows\n`,
			lock
		);
		const result = parseGemfile(file);
		expect(result.map(p => p.name)).not.toContain('wdm');
	});
});

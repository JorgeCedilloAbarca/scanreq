import { describe, it, expect } from 'vitest';
import { parseRequirements, parseRequirementsFile } from '../../ecosystems/python/parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Crea un directorio temporal con múltiples archivos de requirements.
 * Devuelve la ruta al archivo raíz (requirements.txt).
 */
function writeRequirementsTree(files: Record<string, string>): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanreq-python-test-'));
	for (const [relPath, content] of Object.entries(files)) {
		const abs = path.join(dir, relPath);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content);
	}
	return path.join(dir, 'requirements.txt');
}

// ─── parseRequirements (función pura, sin cambios) ───────────────────────────

describe('parseRequirements', () => {

	it('parsea versión exacta ==', () => {
		const result = parseRequirements('requests==2.28.0');
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ name: 'requests', version: '2.28.0', exactVersion: true });
	});

	it('parsea versión con >= (no exacta)', () => {
		const result = parseRequirements('celery>=5.3.0');
		expect(result[0]).toMatchObject({ name: 'celery', exactVersion: false });
	});

	it('parsea paquete sin versión', () => {
		const result = parseRequirements('flask');
		expect(result[0]).toMatchObject({ name: 'flask', version: 'unknown', exactVersion: false });
	});

	it('ignora líneas de comentario', () => {
		const result = parseRequirements('# esto es un comentario\nrequests==2.28.0');
		expect(result).toHaveLength(1);
	});

	it('ignora comentarios inline', () => {
		const result = parseRequirements('flask==3.0.0  # web framework');
		expect(result[0]).toMatchObject({ name: 'flask', version: '3.0.0', exactVersion: true });
	});

	it('ignora líneas con -r y -c', () => {
		const result = parseRequirements('-r other.txt\nrequests==2.28.0');
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('requests');
	});

	it('soporta extras como uvicorn[standard]', () => {
		const result = parseRequirements('uvicorn[standard]==0.27.0');
		expect(result[0]).toMatchObject({ name: 'uvicorn[standard]', version: '0.27.0', exactVersion: true });
	});

	it('soporta extras con varios como pydantic[email,dotenv]', () => {
		const result = parseRequirements('pydantic[email,dotenv]==2.5.0');
		expect(result[0]).toMatchObject({ name: 'pydantic[email,dotenv]', version: '2.5.0', exactVersion: true });
	});

	it('parsea ~= (compatible release)', () => {
		const result = parseRequirements('django~=4.2.0');
		expect(result[0]).toMatchObject({ name: 'django', exactVersion: false });
	});

	it('parsea rango compuesto como no exacto', () => {
		const result = parseRequirements('numpy>=1.20,<2.0');
		expect(result[0]).toMatchObject({ name: 'numpy', exactVersion: false });
	});

	it('parsea múltiples paquetes', () => {
		const input = 'requests==2.28.0\nflask==3.0.0\ncelery>=5.3.0';
		const result = parseRequirements(input);
		expect(result).toHaveLength(3);
		expect(result.map(p => p.name)).toEqual(['requests', 'flask', 'celery']);
	});

	it('ignora líneas vacías', () => {
		const result = parseRequirements('\n\nrequests==2.28.0\n\n');
		expect(result).toHaveLength(1);
	});

	it('soporta nombres con guiones y puntos', () => {
		const result = parseRequirements('python-dotenv==1.0.0\ntyping-extensions==4.9.0');
		expect(result[0].name).toBe('python-dotenv');
		expect(result[1].name).toBe('typing-extensions');
	});

	it('no marca == con coma como exacta', () => {
		const result = parseRequirements('package==1.0.0,<2.0.0');
		expect(result[0].exactVersion).toBe(false);
	});
});

// ─── parseRequirementsFile — archivo simple sin -r ───────────────────────────

describe('parseRequirementsFile — archivo simple', () => {

	it('lee un archivo sin directivas -r', () => {
		const root = writeRequirementsTree({
			'requirements.txt': 'requests==2.31.0\nflask==3.0.3\n',
		});
		const result = parseRequirementsFile(root);
		expect(result).toHaveLength(2);
		expect(result.map(p => p.name)).toEqual(['requests', 'flask']);
	});

	it('devuelve vacío si el archivo no existe', () => {
		const result = parseRequirementsFile('/ruta/inexistente/requirements.txt');
		expect(result).toHaveLength(0);
	});

	it('ignora opciones pip como --no-binary', () => {
		const root = writeRequirementsTree({
			'requirements.txt': '--no-binary caio\nrequests==2.31.0\n',
		});
		const result = parseRequirementsFile(root);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('requests');
	});

	it('parsea formato pip-compile con hashes — elimina \\ trailing y ignora líneas --hash', () => {
		// Formato generado por pip-compile --generate-hashes (patrón apt-mirror2)
		const root = writeRequirementsTree({
			'requirements.txt': [
				'aiofile==3.9.0 \\',
				'    --hash=sha256:ce2f6c1571538cbdfa0143b04e16b208ecb0e9cb4148e528af8a640ed51cc8aa \\',
				'    --hash=sha256:e5ad718bb148b265b6df1b3752c4d1d83024b93da9bd599df74b9d9ffcf7919b',
				'    # via apt-mirror2',
				'requests==2.31.0 \\',
				'    --hash=sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
			].join('\n'),
		});
		const result = parseRequirementsFile(root);
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ name: 'aiofile', version: '3.9.0', exactVersion: true });
		expect(result[1]).toMatchObject({ name: 'requests', version: '2.31.0', exactVersion: true });
	});
});

// ─── parseRequirementsFile — directiva -r ────────────────────────────────────

describe('parseRequirementsFile — directiva -r', () => {

	it('resuelve -r a un archivo hijo y consolida los paquetes (patrón apt-mirror2)', () => {
		const root = writeRequirementsTree({
			'requirements.txt':         '-r requirements/prod.txt\n-r requirements/dev.txt\n',
			'requirements/prod.txt':    'gunicorn==21.2.0\npsycopg2==2.9.9\n',
			'requirements/dev.txt':     'pytest==8.1.0\n',
		});
		const result = parseRequirementsFile(root);
		expect(result).toHaveLength(3);
		expect(result.map(p => p.name)).toEqual(['gunicorn', 'psycopg2', 'pytest']);
	});

	it('resuelve --requirement (forma larga)', () => {
		const root = writeRequirementsTree({
			'requirements.txt':      '--requirement requirements/prod.txt\n',
			'requirements/prod.txt': 'celery==5.3.6\n',
		});
		const result = parseRequirementsFile(root);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('celery');
	});

	it('combina paquetes del raíz con paquetes del hijo', () => {
		const root = writeRequirementsTree({
			'requirements.txt':      'flask==3.0.3\n-r requirements/prod.txt\n',
			'requirements/prod.txt': 'gunicorn==21.2.0\n',
		});
		const result = parseRequirementsFile(root);
		expect(result).toHaveLength(2);
		expect(result.map(p => p.name)).toEqual(['flask', 'gunicorn']);
	});

	it('-r anidado (-r a→b→c) resuelve recursivamente', () => {
		const root = writeRequirementsTree({
			'requirements.txt':      '-r requirements/base.txt\n',
			'requirements/base.txt': '-r core.txt\nflask==3.0.3\n',
			'requirements/core.txt': 'sqlalchemy==2.0.31\n',
		});
		const result = parseRequirementsFile(root);
		expect(result).toHaveLength(2);
		expect(result.map(p => p.name)).toEqual(['sqlalchemy', 'flask']);
	});

	it('ignora silenciosamente un archivo hijo que no existe', () => {
		const root = writeRequirementsTree({
			'requirements.txt': '-r requirements/opcional.txt\nrequests==2.31.0\n',
		});
		const result = parseRequirementsFile(root);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('requests');
	});

	it('deduplica paquetes entre archivos — primera aparición gana', () => {
		const root = writeRequirementsTree({
			'requirements.txt':      'requests==2.31.0\n-r requirements/prod.txt\n',
			'requirements/prod.txt': 'requests==2.28.0\ngunicorn==21.2.0\n',
		});
		const result = parseRequirementsFile(root);
		expect(result).toHaveLength(2);
		// requests del raíz gana (2.31.0), no el del hijo
		expect(result.find(p => p.name === 'requests')?.version).toBe('2.31.0');
		expect(result.find(p => p.name === 'gunicorn')).toBeDefined();
	});

	it('protección anti-bucle circular: no entra en loop infinito', () => {
		// a.txt → b.txt → a.txt — el ciclo debe cortarse silenciosamente
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanreq-python-loop-'));
		const aPath = path.join(dir, 'a.txt');
		const bPath = path.join(dir, 'b.txt');
		fs.writeFileSync(aPath, `-r b.txt\nflask==3.0.3\n`);
		fs.writeFileSync(bPath, `-r a.txt\nrequests==2.31.0\n`);

		const result = parseRequirementsFile(aPath);
		// flask del raíz (a.txt) + requests de b.txt — sin duplicados, sin crash
		expect(result.map(p => p.name)).toContain('flask');
		expect(result.map(p => p.name)).toContain('requests');
		// No debe haber bucle infinito — la función debe completar
	});

	it('ignora líneas -c (constraints) sin incluir sus paquetes', () => {
		const root = writeRequirementsTree({
			'requirements.txt':         '-c constraints.txt\nrequests==2.31.0\n',
			'constraints.txt':          'urllib3==2.2.1\n',
		});
		const result = parseRequirementsFile(root);
		// -c no debe incluir urllib3 — solo requests
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('requests');
	});
});

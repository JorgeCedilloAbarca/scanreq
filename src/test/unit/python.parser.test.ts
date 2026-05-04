import { describe, it, expect } from 'vitest';
import { parseRequirements } from '../../ecosystems/python/parser';

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

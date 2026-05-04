import { describe, it, expect } from 'vitest';
import { parseCargoToml } from '../../ecosystems/rust/parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function writeTempCargoToml(content: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanreq-test-'));
	const filePath = path.join(dir, 'Cargo.toml');
	fs.writeFileSync(filePath, content);
	return filePath;
}

describe('parseCargoToml', () => {

	it('parsea versión exacta (solo número)', () => {
		const file = writeTempCargoToml(`[dependencies]\nserde = "1.0.195"`);
		const result = parseCargoToml(file);
		expect(result[0]).toMatchObject({ name: 'serde', version: '1.0.195', exactVersion: true });
	});

	it('parsea versión con ^ como no exacta', () => {
		const file = writeTempCargoToml(`[dependencies]\nserde = "^1.0"`);
		const result = parseCargoToml(file);
		expect(result[0]).toMatchObject({ name: 'serde', exactVersion: false, version: '1.0' });
	});

	it('parsea versión con ~ como no exacta', () => {
		const file = writeTempCargoToml(`[dependencies]\ntokio = "~1.35"`);
		const result = parseCargoToml(file);
		expect(result[0]).toMatchObject({ name: 'tokio', exactVersion: false });
	});

	it('parsea formato tabla { version = "..." }', () => {
		const file = writeTempCargoToml(`[dependencies]\nserde = { version = "1.0", features = ["derive"] }`);
		const result = parseCargoToml(file);
		expect(result[0]).toMatchObject({ name: 'serde', version: '1.0', exactVersion: false });
	});

	it('ignora workspace dependencies', () => {
		const file = writeTempCargoToml(`[dependencies]\nmylib = { workspace = true }`);
		const result = parseCargoToml(file);
		expect(result).toHaveLength(0);
	});

	it('ignora path dependencies', () => {
		const file = writeTempCargoToml(`[dependencies]\nmylib = { path = "../mylib" }`);
		const result = parseCargoToml(file);
		expect(result).toHaveLength(0);
	});

	it('parsea [dev-dependencies]', () => {
		const file = writeTempCargoToml(`[dev-dependencies]\nmockall = "0.12.0"`);
		const result = parseCargoToml(file);
		expect(result[0]).toMatchObject({ name: 'mockall', section: 'dev-dependencies' });
	});

	it('parsea [build-dependencies]', () => {
		const file = writeTempCargoToml(`[build-dependencies]\ncc = "1.0"`);
		const result = parseCargoToml(file);
		expect(result[0]).toMatchObject({ name: 'cc', section: 'build-dependencies' });
	});

	it('deduplica — dependencies tiene prioridad sobre dev-dependencies', () => {
		const file = writeTempCargoToml(`[dependencies]\nserde = "1.0.195"\n[dev-dependencies]\nserde = "1.0"`);
		const result = parseCargoToml(file);
		expect(result).toHaveLength(1);
		expect(result[0].section).toBe('dependencies');
		expect(result[0].exactVersion).toBe(true);
	});

	it('ignora comentarios', () => {
		const file = writeTempCargoToml(`[dependencies]\n# esto es un comentario\nserde = "1.0"`);
		const result = parseCargoToml(file);
		expect(result).toHaveLength(1);
	});

	it('parsea múltiples paquetes en la misma sección', () => {
		const file = writeTempCargoToml(`[dependencies]\nserde = "1.0"\ntokio = "1.35"\naxum = "0.7"`);
		const result = parseCargoToml(file);
		expect(result).toHaveLength(3);
		expect(result.map(p => p.name)).toEqual(['serde', 'tokio', 'axum']);
	});

	it('no parsea dependencias fuera de las secciones conocidas', () => {
		const file = writeTempCargoToml(`[package]\nname = "myapp"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1.0"`);
		const result = parseCargoToml(file);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('serde');
	});

	it('parsea versión con guiones en el nombre del crate', () => {
		const file = writeTempCargoToml(`[dependencies]\ntokio-util = "0.7.10"`);
		const result = parseCargoToml(file);
		expect(result[0].name).toBe('tokio-util');
	});
});

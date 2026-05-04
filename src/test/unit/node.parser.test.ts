import { describe, it, expect } from 'vitest';
import { parsePackageJson } from '../../ecosystems/node/parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function writeTempPackageJson(content: object): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanreq-test-'));
	const filePath = path.join(dir, 'package.json');
	fs.writeFileSync(filePath, JSON.stringify(content));
	return filePath;
}

describe('parsePackageJson', () => {

	it('parsea versión exacta (sin prefijo)', () => {
		const file = writeTempPackageJson({ dependencies: { react: '18.2.0' } });
		const result = parsePackageJson(file);
		expect(result[0]).toMatchObject({ name: 'react', version: '18.2.0', exactVersion: true });
	});

	it('parsea versión con ^ como no exacta', () => {
		const file = writeTempPackageJson({ dependencies: { react: '^18.2.0' } });
		const result = parsePackageJson(file);
		expect(result[0]).toMatchObject({ name: 'react', exactVersion: false, version: '18.2.0' });
	});

	it('parsea versión con ~ como no exacta', () => {
		const file = writeTempPackageJson({ dependencies: { lodash: '~4.17.21' } });
		const result = parsePackageJson(file);
		expect(result[0]).toMatchObject({ name: 'lodash', exactVersion: false });
	});

	it('parsea versión >= como no exacta', () => {
		const file = writeTempPackageJson({ dependencies: { typescript: '>=5.0.0' } });
		const result = parsePackageJson(file);
		expect(result[0].exactVersion).toBe(false);
	});

	it('parsea devDependencies', () => {
		const file = writeTempPackageJson({ devDependencies: { vitest: '^1.0.0' } });
		const result = parsePackageJson(file);
		expect(result[0]).toMatchObject({ name: 'vitest', section: 'devDependencies' });
	});

	it('parsea peerDependencies', () => {
		const file = writeTempPackageJson({ peerDependencies: { react: '>=18.0.0' } });
		const result = parsePackageJson(file);
		expect(result[0]).toMatchObject({ name: 'react', section: 'peerDependencies' });
	});

	it('deduplica paquetes — dependencies tiene prioridad sobre peerDependencies', () => {
		const file = writeTempPackageJson({
			dependencies: { react: '18.2.0' },
			peerDependencies: { react: '>=18.0.0' }
		});
		const result = parsePackageJson(file);
		expect(result).toHaveLength(1);
		expect(result[0].section).toBe('dependencies');
		expect(result[0].exactVersion).toBe(true);
	});

	it('deduplica — devDependencies tiene prioridad sobre peerDependencies', () => {
		const file = writeTempPackageJson({
			devDependencies: { vitest: '1.0.0' },
			peerDependencies: { vitest: '>=1.0.0' }
		});
		const result = parsePackageJson(file);
		expect(result).toHaveLength(1);
		expect(result[0].section).toBe('devDependencies');
	});

	it('ignora referencias locales file:', () => {
		const file = writeTempPackageJson({ dependencies: { mylib: 'file:../mylib' } });
		const result = parsePackageJson(file);
		expect(result).toHaveLength(0);
	});

	it('ignora referencias git:', () => {
		const file = writeTempPackageJson({ dependencies: { pkg: 'git+https://github.com/user/pkg.git' } });
		const result = parsePackageJson(file);
		expect(result).toHaveLength(0);
	});

	it('ignora referencias github:', () => {
		const file = writeTempPackageJson({ dependencies: { pkg: 'github:user/pkg' } });
		const result = parsePackageJson(file);
		expect(result).toHaveLength(0);
	});

	it('soporta scoped packages @types/node', () => {
		const file = writeTempPackageJson({ devDependencies: { '@types/node': '^22.0.0' } });
		const result = parsePackageJson(file);
		expect(result[0].name).toBe('@types/node');
	});

	it('devuelve vacío si no hay secciones de dependencias', () => {
		const file = writeTempPackageJson({ name: 'my-app', version: '1.0.0' });
		const result = parsePackageJson(file);
		expect(result).toHaveLength(0);
	});

	it('devuelve vacío si el JSON es inválido', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanreq-test-'));
		const filePath = path.join(dir, 'package.json');
		fs.writeFileSync(filePath, 'esto no es json{{{');
		const result = parsePackageJson(filePath);
		expect(result).toHaveLength(0);
	});
});

import { describe, it, expect } from 'vitest';
import { parseGoMod } from '../../ecosystems/go/parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function writeTempGoMod(content: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanreq-test-'));
	const filePath = path.join(dir, 'go.mod');
	fs.writeFileSync(filePath, content);
	return filePath;
}

describe('parseGoMod', () => {

	it('parsea require en bloque multilínea', () => {
		const file = writeTempGoMod(`module myapp\n\ngo 1.21\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgithub.com/stretchr/testify v1.8.4\n)`);
		const result = parseGoMod(file);
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ name: 'github.com/gin-gonic/gin', version: '1.9.1', exactVersion: true });
		expect(result[1]).toMatchObject({ name: 'github.com/stretchr/testify', version: '1.8.4', exactVersion: true });
	});

	it('elimina el prefijo v de la versión', () => {
		const file = writeTempGoMod(`require (\n\tgolang.org/x/crypto v0.17.0\n)`);
		const result = parseGoMod(file);
		expect(result[0].version).toBe('0.17.0');
		expect(result[0].version).not.toContain('v');
	});

	it('parsea require individual (una línea)', () => {
		const file = writeTempGoMod(`require github.com/some/pkg v0.1.0`);
		const result = parseGoMod(file);
		expect(result[0]).toMatchObject({ name: 'github.com/some/pkg', version: '0.1.0' });
	});

	it('ignora comentarios // indirect', () => {
		const file = writeTempGoMod(`require (\n\tgithub.com/pkg/errors v0.9.1 // indirect\n)`);
		const result = parseGoMod(file);
		expect(result[0]).toMatchObject({ name: 'github.com/pkg/errors', version: '0.9.1' });
	});

	it('todas las versiones son exactas en go.mod', () => {
		const file = writeTempGoMod(`require (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgithub.com/some/pkg v0.1.0\n)`);
		const result = parseGoMod(file);
		expect(result.every(p => p.exactVersion)).toBe(true);
	});

	it('ignora líneas de comentario puro', () => {
		const file = writeTempGoMod(`require (\n\t// esto es un comentario\n\tgithub.com/gin-gonic/gin v1.9.1\n)`);
		const result = parseGoMod(file);
		expect(result).toHaveLength(1);
	});

	it('devuelve vacío si no hay require', () => {
		const file = writeTempGoMod(`module myapp\n\ngo 1.21`);
		const result = parseGoMod(file);
		expect(result).toHaveLength(0);
	});

	it('soporta módulos con rutas largas', () => {
		const file = writeTempGoMod(`require (\n\tgoogle.golang.org/grpc v1.60.1\n)`);
		const result = parseGoMod(file);
		expect(result[0].name).toBe('google.golang.org/grpc');
	});

	it('ignora líneas sin versión con v', () => {
		const file = writeTempGoMod(`require (\n\treplace github.com/old v1.0 => github.com/new v2.0\n\tgithub.com/valid/pkg v1.0.0\n)`);
		const result = parseGoMod(file);
		// Solo debe parsear el paquete válido
		const valid = result.filter(p => p.name === 'github.com/valid/pkg');
		expect(valid).toHaveLength(1);
	});

	it('parsea múltiples bloques require', () => {
		const file = writeTempGoMod(`require (\n\tgithub.com/a/pkg v1.0.0\n)\n\nrequire (\n\tgithub.com/b/pkg v2.0.0\n)`);
		const result = parseGoMod(file);
		expect(result).toHaveLength(2);
	});
});

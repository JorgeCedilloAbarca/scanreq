import { describe, it, expect } from 'vitest';
import { parsePomXml } from '../../ecosystems/java/parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function writeTempPom(content: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanreq-java-test-'));
	const filePath = path.join(dir, 'pom.xml');
	fs.writeFileSync(filePath, content);
	return filePath;
}

// ─── Helpers de XML ──────────────────────────────────────────────────────────

function pomWith(depsXml: string, extra = ''): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>my-app</artifactId>
  <version>1.0.0</version>
  ${extra}
  <dependencies>
    ${depsXml}
  </dependencies>
</project>`;
}

function dep(groupId: string, artifactId: string, version?: string, scope?: string): string {
	return `
    <dependency>
      <groupId>${groupId}</groupId>
      <artifactId>${artifactId}</artifactId>
      ${version !== undefined ? `<version>${version}</version>` : ''}
      ${scope ? `<scope>${scope}</scope>` : ''}
    </dependency>`;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('parsePomXml', () => {

	// ─── Versiones exactas ────────────────────────────────────────────────────

	it('parsea versión exacta', () => {
		const file = writeTempPom(pomWith(dep('org.springframework', 'spring-core', '6.1.2')));
		const result = parsePomXml(file);
		expect(result[0]).toMatchObject({
			name: 'org.springframework:spring-core',
			groupId: 'org.springframework',
			artifactId: 'spring-core',
			version: '6.1.2',
			exactVersion: true,
		});
	});

	it('name tiene formato groupId:artifactId', () => {
		const file = writeTempPom(pomWith(dep('com.fasterxml.jackson.core', 'jackson-databind', '2.16.0')));
		const result = parsePomXml(file);
		expect(result[0].name).toBe('com.fasterxml.jackson.core:jackson-databind');
	});

	// ─── Versiones como properties ────────────────────────────────────────────

	it('resuelve ${property} desde <properties>', () => {
		const pom = `<?xml version="1.0"?>
<project>
  <groupId>com.example</groupId>
  <artifactId>app</artifactId>
  <version>1.0.0</version>
  <properties>
    <spring.version>6.1.2</spring.version>
  </properties>
  <dependencies>
    ${dep('org.springframework', 'spring-core', '${spring.version}')}
  </dependencies>
</project>`;
		const file = writeTempPom(pom);
		const result = parsePomXml(file);
		expect(result[0]).toMatchObject({ version: '6.1.2', exactVersion: true });
	});

	it('resuelve ${project.version}', () => {
		const pom = `<?xml version="1.0"?>
<project>
  <groupId>com.example</groupId>
  <artifactId>app</artifactId>
  <version>2.5.0</version>
  <dependencies>
    ${dep('com.example', 'my-lib', '${project.version}')}
  </dependencies>
</project>`;
		const file = writeTempPom(pom);
		const result = parsePomXml(file);
		expect(result[0]).toMatchObject({ version: '2.5.0', exactVersion: true });
	});

	it('deja ${property} sin resolver como exactVersion: false', () => {
		const file = writeTempPom(pomWith(dep('org.springframework', 'spring-core', '${unknown.version}')));
		const result = parsePomXml(file);
		expect(result[0]).toMatchObject({ exactVersion: false });
		expect(result[0].version).toContain('${');
	});

	// ─── Sin versión ──────────────────────────────────────────────────────────

	it('dependencia sin versión → version: unknown, exactVersion: false', () => {
		const file = writeTempPom(pomWith(dep('org.slf4j', 'slf4j-api')));
		const result = parsePomXml(file);
		expect(result[0]).toMatchObject({ version: 'unknown', exactVersion: false });
	});

	// ─── Scopes ───────────────────────────────────────────────────────────────

	it('parsea scope test', () => {
		const file = writeTempPom(pomWith(dep('org.junit.jupiter', 'junit-jupiter', '5.10.1', 'test')));
		const result = parsePomXml(file);
		expect(result[0]).toMatchObject({ scope: 'test' });
	});

	it('parsea scope provided', () => {
		const file = writeTempPom(pomWith(dep('jakarta.servlet', 'jakarta.servlet-api', '6.0.0', 'provided')));
		const result = parsePomXml(file);
		expect(result[0]).toMatchObject({ scope: 'provided' });
	});

	it('scope por defecto es compile', () => {
		const file = writeTempPom(pomWith(dep('org.springframework', 'spring-core', '6.1.2')));
		const result = parsePomXml(file);
		expect(result[0].scope).toBe('compile');
	});

	// ─── dependencyManagement ─────────────────────────────────────────────────

	it('parsea dependencias en dependencyManagement', () => {
		const pom = `<?xml version="1.0"?>
<project>
  <groupId>com.example</groupId>
  <artifactId>app</artifactId>
  <version>1.0.0</version>
  <dependencyManagement>
    <dependencies>
      ${dep('org.springframework', 'spring-core', '6.1.2')}
    </dependencies>
  </dependencyManagement>
  <dependencies>
  </dependencies>
</project>`;
		const file = writeTempPom(pom);
		const result = parsePomXml(file);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			name: 'org.springframework:spring-core',
			version: '6.1.2',
			section: 'dependencyManagement',
		});
	});

	it('dependencies sobreescribe dependencyManagement para el mismo artefacto', () => {
		const pom = `<?xml version="1.0"?>
<project>
  <groupId>com.example</groupId>
  <artifactId>app</artifactId>
  <version>1.0.0</version>
  <dependencyManagement>
    <dependencies>
      ${dep('org.springframework', 'spring-core', '6.0.0')}
    </dependencies>
  </dependencyManagement>
  <dependencies>
    ${dep('org.springframework', 'spring-core', '6.1.2')}
  </dependencies>
</project>`;
		const file = writeTempPom(pom);
		const result = parsePomXml(file);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ version: '6.1.2', section: 'dependencies' });
	});

	it('ignora BOM imports (type=pom, scope=import)', () => {
		const pom = `<?xml version="1.0"?>
<project>
  <groupId>com.example</groupId>
  <artifactId>app</artifactId>
  <version>1.0.0</version>
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-dependencies</artifactId>
        <version>3.2.1</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>
</project>`;
		const file = writeTempPom(pom);
		const result = parsePomXml(file);
		expect(result).toHaveLength(0);
	});

	// ─── Versiones no exactas ─────────────────────────────────────────────────

	it('rango Maven [1.0,2.0) → exactVersion: false', () => {
		const file = writeTempPom(pomWith(dep('org.example', 'lib', '[1.0,2.0)')));
		const result = parsePomXml(file);
		expect(result[0].exactVersion).toBe(false);
	});

	it('SNAPSHOT → exactVersion: false', () => {
		const file = writeTempPom(pomWith(dep('org.example', 'lib', '2.0.0-SNAPSHOT')));
		const result = parsePomXml(file);
		expect(result[0].exactVersion).toBe(false);
	});

	it('LATEST → exactVersion: false', () => {
		const file = writeTempPom(pomWith(dep('org.example', 'lib', 'LATEST')));
		const result = parsePomXml(file);
		expect(result[0].exactVersion).toBe(false);
	});

	// ─── Múltiples dependencias ───────────────────────────────────────────────

	it('parsea múltiples dependencias', () => {
		const pom = pomWith(`
      ${dep('org.springframework', 'spring-core', '6.1.2')}
      ${dep('com.fasterxml.jackson.core', 'jackson-databind', '2.16.0')}
      ${dep('org.slf4j', 'slf4j-api', '2.0.9')}
    `);
		const file = writeTempPom(pom);
		const result = parsePomXml(file);
		expect(result).toHaveLength(3);
		expect(result.map(p => p.name)).toEqual([
			'org.springframework:spring-core',
			'com.fasterxml.jackson.core:jackson-databind',
			'org.slf4j:slf4j-api',
		]);
	});

	// ─── Casos borde ─────────────────────────────────────────────────────────

	it('devuelve vacío si el archivo no existe', () => {
		const result = parsePomXml('/ruta/que/no/existe/pom.xml');
		expect(result).toHaveLength(0);
	});

	it('devuelve vacío si el XML está vacío', () => {
		const file = writeTempPom('<project></project>');
		const result = parsePomXml(file);
		expect(result).toHaveLength(0);
	});

	it('parsea artifact con guiones en el nombre', () => {
		const file = writeTempPom(pomWith(dep('org.apache.httpcomponents', 'httpclient', '4.5.14')));
		const result = parsePomXml(file);
		expect(result[0].name).toBe('org.apache.httpcomponents:httpclient');
	});

	it('deduplica — la misma dependencia en dependencies y dependencyManagement cuenta una vez', () => {
		const pom = `<?xml version="1.0"?>
<project>
  <groupId>com.example</groupId>
  <artifactId>app</artifactId>
  <version>1.0.0</version>
  <dependencyManagement>
    <dependencies>
      ${dep('org.slf4j', 'slf4j-api', '2.0.9')}
    </dependencies>
  </dependencyManagement>
  <dependencies>
    ${dep('org.slf4j', 'slf4j-api', '2.0.9')}
  </dependencies>
</project>`;
		const file = writeTempPom(pom);
		const result = parsePomXml(file);
		expect(result).toHaveLength(1);
	});
});

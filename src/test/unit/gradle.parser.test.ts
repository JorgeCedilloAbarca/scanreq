import { describe, it, expect } from 'vitest';
import { parseBuildGradle } from '../../ecosystems/gradle/parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function writeTempGradle(content: string, filename = 'build.gradle'): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanreq-gradle-test-'));
	const filePath = path.join(dir, filename);
	fs.writeFileSync(filePath, content);
	return filePath;
}

describe('parseBuildGradle', () => {

	// ─── Groovy DSL — formato string ─────────────────────────────────────────

	it('parsea implementation con comillas simples', () => {
		const file = writeTempGradle(`
dependencies {
    implementation 'org.springframework:spring-core:6.1.2'
}`);
		const result = parseBuildGradle(file);
		expect(result[0]).toMatchObject({
			name: 'org.springframework:spring-core',
			groupId: 'org.springframework',
			artifactId: 'spring-core',
			version: '6.1.2',
			exactVersion: true,
			section: 'implementation',
			scope: 'compile',
		});
	});

	it('parsea implementation con comillas dobles', () => {
		const file = writeTempGradle(`
dependencies {
    implementation "com.google.guava:guava:32.1.3-jre"
}`);
		const result = parseBuildGradle(file);
		expect(result[0]).toMatchObject({
			name: 'com.google.guava:guava',
			version: '32.1.3-jre',
			exactVersion: true,
		});
	});

	it('parsea testImplementation con scope test', () => {
		const file = writeTempGradle(`
dependencies {
    testImplementation 'org.junit.jupiter:junit-jupiter:5.10.1'
}`);
		const result = parseBuildGradle(file);
		expect(result[0]).toMatchObject({ section: 'testImplementation', scope: 'test' });
	});

	it('parsea api con scope compile', () => {
		const file = writeTempGradle(`
dependencies {
    api 'com.squareup.retrofit2:retrofit:2.9.0'
}`);
		const result = parseBuildGradle(file);
		expect(result[0]).toMatchObject({ section: 'api', scope: 'compile' });
	});

	it('parsea compileOnly con scope provided', () => {
		const file = writeTempGradle(`
dependencies {
    compileOnly 'org.projectlombok:lombok:1.18.30'
}`);
		const result = parseBuildGradle(file);
		expect(result[0]).toMatchObject({ scope: 'provided' });
	});

	it('parsea runtimeOnly con scope runtime', () => {
		const file = writeTempGradle(`
dependencies {
    runtimeOnly 'com.h2database:h2:2.2.224'
}`);
		const result = parseBuildGradle(file);
		expect(result[0]).toMatchObject({ scope: 'runtime' });
	});

	it('parsea kapt con scope provided', () => {
		const file = writeTempGradle(`
dependencies {
    kapt 'com.google.dagger:dagger-compiler:2.50'
}`);
		const result = parseBuildGradle(file);
		expect(result[0]).toMatchObject({ scope: 'provided' });
	});

	// ─── Kotlin DSL ───────────────────────────────────────────────────────────

	it('parsea Kotlin DSL con paréntesis y comillas dobles', () => {
		const file = writeTempGradle(`
dependencies {
    implementation("org.springframework:spring-core:6.1.2")
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.1")
}`, 'build.gradle.kts');
		const result = parseBuildGradle(file);
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ name: 'org.springframework:spring-core', version: '6.1.2' });
		expect(result[1]).toMatchObject({ name: 'org.junit.jupiter:junit-jupiter', scope: 'test' });
	});

	// ─── Formato named (group/name/version) ──────────────────────────────────

	it('parsea formato named Groovy (group:, name:, version:)', () => {
		const file = writeTempGradle(`
dependencies {
    implementation group: 'org.springframework', name: 'spring-core', version: '6.1.2'
}`);
		const result = parseBuildGradle(file);
		expect(result[0]).toMatchObject({
			name: 'org.springframework:spring-core',
			version: '6.1.2',
			exactVersion: true,
		});
	});

	it('parsea formato named Kotlin (group =, name =, version =)', () => {
		const file = writeTempGradle(`
dependencies {
    implementation(group = "org.springframework", name = "spring-core", version = "6.1.2")
}`, 'build.gradle.kts');
		const result = parseBuildGradle(file);
		expect(result[0]).toMatchObject({
			name: 'org.springframework:spring-core',
			version: '6.1.2',
		});
	});

	// ─── Variables de versión ─────────────────────────────────────────────────

	it('resuelve variable de versión definida en el mismo archivo (Groovy)', () => {
		const file = writeTempGradle(`
def springVersion = "6.1.2"

dependencies {
    implementation "org.springframework:spring-core:$springVersion"
}`);
		const result = parseBuildGradle(file);
		expect(result[0]).toMatchObject({ version: '6.1.2', exactVersion: true });
	});

	it('resuelve variable con ${} (Groovy)', () => {
		const file = writeTempGradle(`
def springVersion = "6.1.2"

dependencies {
    implementation "org.springframework:spring-core:\${springVersion}"
}`);
		const result = parseBuildGradle(file);
		expect(result[0]).toMatchObject({ version: '6.1.2', exactVersion: true });
	});

	it('marca como unknown si la variable no se puede resolver', () => {
		const file = writeTempGradle(`
dependencies {
    implementation "org.springframework:spring-core:$libs.versions.spring"
}`);
		const result = parseBuildGradle(file);
		// Variable de catálogo no resoluble → version unknown o vacía
		if (result.length > 0) {
			expect(result[0].exactVersion).toBe(false);
		}
	});

	// ─── Exclusiones ─────────────────────────────────────────────────────────

	it('ignora dependencias de proyecto local project(:module)', () => {
		const file = writeTempGradle(`
dependencies {
    implementation project(':core')
    implementation 'com.google.guava:guava:32.1.3-jre'
}`);
		const result = parseBuildGradle(file);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('com.google.guava:guava');
	});

	it('ignora comentarios de línea', () => {
		const file = writeTempGradle(`
dependencies {
    // implementation 'org.example:commented-out:1.0'
    implementation 'com.google.guava:guava:32.1.3-jre'
}`);
		const result = parseBuildGradle(file);
		expect(result).toHaveLength(1);
	});

	it('ignora comentarios de bloque', () => {
		const file = writeTempGradle(`
dependencies {
    /* implementation 'org.example:commented-out:1.0' */
    implementation 'com.google.guava:guava:32.1.3-jre'
}`);
		const result = parseBuildGradle(file);
		expect(result).toHaveLength(1);
	});

	it('deduplica dependencias repetidas', () => {
		const file = writeTempGradle(`
dependencies {
    implementation 'org.springframework:spring-core:6.1.2'
    testImplementation 'org.springframework:spring-core:6.0.0'
}`);
		const result = parseBuildGradle(file);
		expect(result).toHaveLength(1);
		expect(result[0].version).toBe('6.1.2');
	});

	// ─── SNAPSHOT y versiones no exactas ─────────────────────────────────────

	it('marca SNAPSHOT como no exacto', () => {
		const file = writeTempGradle(`
dependencies {
    implementation 'org.example:lib:2.0.0-SNAPSHOT'
}`);
		const result = parseBuildGradle(file);
		expect(result[0].exactVersion).toBe(false);
	});

	// ─── Múltiples dependencias ───────────────────────────────────────────────

	it('parsea múltiples dependencias', () => {
		const file = writeTempGradle(`
dependencies {
    implementation 'org.springframework:spring-core:6.1.2'
    implementation 'com.fasterxml.jackson.core:jackson-databind:2.16.0'
    testImplementation 'org.junit.jupiter:junit-jupiter:5.10.1'
    compileOnly 'org.projectlombok:lombok:1.18.30'
}`);
		const result = parseBuildGradle(file);
		expect(result).toHaveLength(4);
		expect(result.map(p => p.name)).toEqual([
			'org.springframework:spring-core',
			'com.fasterxml.jackson.core:jackson-databind',
			'org.junit.jupiter:junit-jupiter',
			'org.projectlombok:lombok',
		]);
	});

	// ─── Casos borde ─────────────────────────────────────────────────────────

	it('devuelve vacío si el archivo no existe', () => {
		const result = parseBuildGradle('/ruta/que/no/existe/build.gradle');
		expect(result).toHaveLength(0);
	});

	it('devuelve vacío si no hay bloque dependencies', () => {
		const file = writeTempGradle(`
plugins {
    id 'java'
}
group = 'com.example'
version = '1.0.0'`);
		const result = parseBuildGradle(file);
		expect(result).toHaveLength(0);
	});

	it('parsea build.gradle.kts correctamente', () => {
		const file = writeTempGradle(`
plugins {
    kotlin("jvm") version "1.9.22"
}

dependencies {
    implementation("io.ktor:ktor-server-core:2.3.7")
    implementation("io.ktor:ktor-server-netty:2.3.7")
    testImplementation(kotlin("test"))
}`, 'build.gradle.kts');
		const result = parseBuildGradle(file);
		expect(result.length).toBeGreaterThanOrEqual(2);
		expect(result[0].name).toBe('io.ktor:ktor-server-core');
	});
});

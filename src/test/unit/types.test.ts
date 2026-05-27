import { describe, it, expect } from 'vitest';
import { calcMajorVersionJump, calcMigrationRisk, maxSeverityOf, Vulnerability } from '../../ecosystems/types';

describe('calcMajorVersionJump', () => {

	it('mismo major — devuelve 0', () => {
		expect(calcMajorVersionJump('1.2.3', '1.5.0')).toBe(0);
	});

	it('salto de un major — devuelve 1', () => {
		expect(calcMajorVersionJump('1.2.3', '2.0.0')).toBe(1);
	});

	it('salto de varios majors — devuelve la diferencia', () => {
		expect(calcMajorVersionJump('3.0.0', '7.0.0')).toBe(4);
	});

	it('numpy 1.x → 2.x — devuelve 1', () => {
		expect(calcMajorVersionJump('1.26.3', '2.0.0')).toBe(1);
	});

	it('vite 4.x → 8.x — devuelve 4', () => {
		expect(calcMajorVersionJump('4.4.9', '8.0.10')).toBe(4);
	});

	it('versiones iguales — devuelve 0', () => {
		expect(calcMajorVersionJump('2.0.0', '2.0.0')).toBe(0);
	});

	it('versión unknown — devuelve 0 (no negativo)', () => {
		expect(calcMajorVersionJump('unknown', '2.0.0')).toBe(0);
	});

	it('latest Not found — devuelve 0', () => {
		expect(calcMajorVersionJump('1.0.0', 'Not found')).toBe(0);
	});

	// Fix G3: en SemVer la zona 0.x se trata como "salvaje oeste" — cualquier
	// cambio en X puede ser breaking. El salto en el segundo componente cuenta
	// como mayor cuando ambos están en 0.x.
	it('0.x → 0.x — devuelve diferencia en el segundo componente (G3)', () => {
		expect(calcMajorVersionJump('0.8.0', '0.12.0')).toBe(4);
	});

	it('0.x → 0.x con salto pequeño — devuelve diferencia (G3)', () => {
		expect(calcMajorVersionJump('0.28.0', '0.30.0')).toBe(2);
	});

	it('0.x → 0.x mismo minor — devuelve 0', () => {
		expect(calcMajorVersionJump('0.8.0', '0.8.5')).toBe(0);
	});

	it('0.x → 1.x — devuelve 1 (major real)', () => {
		expect(calcMajorVersionJump('0.8.0', '1.0.0')).toBe(1);
	});

	// Fix JM1: CalVer (YYYYMMDD) no debe calcular major jump
	it('CalVer org.json YYYYMMDD — devuelve 0', () => {
		expect(calcMajorVersionJump('20231013', '20250517')).toBe(0);
	});

	it('CalVer YYYY.MM.DD — devuelve 0', () => {
		expect(calcMajorVersionJump('2024.01.15', '2024.06.20')).toBe(0);
	});

	it('CalVer YYYYMMDD.N (build suffix) — devuelve 0', () => {
		expect(calcMajorVersionJump('20231013.1', '20250517.2')).toBe(0);
	});
});

describe('calcMigrationRisk', () => {

	it('sin salto sin CVEs — riesgo low', () => {
		expect(calcMigrationRisk(0, false)).toBe('low');
	});

	it('sin salto con CVEs sin severidad — riesgo medium', () => {
		expect(calcMigrationRisk(0, true)).toBe('medium');
	});

	// Cualquier salto de major es Phase 3 (high), independientemente de CVEs.
	it('salto de 1 major sin CVEs — riesgo high', () => {
		expect(calcMigrationRisk(1, false)).toBe('high');
	});

	it('salto de 1 major con CVEs — riesgo high', () => {
		expect(calcMigrationRisk(1, true)).toBe('high');
	});

	it('salto de 2 majors — riesgo high', () => {
		expect(calcMigrationRisk(2, false)).toBe('high');
	});

	it('salto de 4 majors — riesgo high', () => {
		expect(calcMigrationRisk(4, true)).toBe('high');
	});

	// Fix JM2: CVE CRITICAL en paquete al día → Phase 3 directo
	it('CVE CRITICAL sin major jump — riesgo high', () => {
		expect(calcMigrationRisk(0, true, 'CRITICAL')).toBe('high');
	});

	it('CVE HIGH sin major jump — riesgo high', () => {
		expect(calcMigrationRisk(0, true, 'HIGH')).toBe('high');
	});

	it('CVE MEDIUM sin major jump — riesgo medium', () => {
		expect(calcMigrationRisk(0, true, 'MEDIUM')).toBe('medium');
	});

	it('CVE MODERATE sin major jump — riesgo medium', () => {
		expect(calcMigrationRisk(0, true, 'MODERATE')).toBe('medium');
	});

	it('CVE LOW sin major jump — riesgo medium', () => {
		expect(calcMigrationRisk(0, true, 'LOW')).toBe('medium');
	});

	it('CVE UNKNOWN sin major jump — riesgo medium', () => {
		expect(calcMigrationRisk(0, true, 'UNKNOWN')).toBe('medium');
	});
});

describe('maxSeverityOf', () => {

	const mk = (severity: string): Vulnerability => ({ id: 'X', summary: '', severity });

	it('array vacío — devuelve undefined', () => {
		expect(maxSeverityOf([])).toBeUndefined();
	});

	it('una sola severidad', () => {
		expect(maxSeverityOf([mk('HIGH')])).toBe('HIGH');
	});

	it('CRITICAL gana a HIGH', () => {
		expect(maxSeverityOf([mk('HIGH'), mk('CRITICAL'), mk('LOW')])).toBe('CRITICAL');
	});

	it('HIGH gana a MEDIUM', () => {
		expect(maxSeverityOf([mk('MEDIUM'), mk('HIGH'), mk('LOW')])).toBe('HIGH');
	});

	it('MEDIUM y MODERATE equivalen', () => {
		expect(maxSeverityOf([mk('MODERATE'), mk('LOW')])).toBe('MODERATE');
	});

	it('UNKNOWN al final', () => {
		expect(maxSeverityOf([mk('UNKNOWN'), mk('LOW')])).toBe('LOW');
	});

	it('case-insensitive', () => {
		expect(maxSeverityOf([mk('critical')])).toBe('CRITICAL');
	});
});

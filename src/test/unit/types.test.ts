import { describe, it, expect } from 'vitest';
import { calcMajorVersionJump, calcMigrationRisk } from '../../ecosystems/types';

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

	it('0.x → 0.x — devuelve 0', () => {
		expect(calcMajorVersionJump('0.8.0', '0.12.0')).toBe(0);
	});

	it('0.x → 1.x — devuelve 1', () => {
		expect(calcMajorVersionJump('0.8.0', '1.0.0')).toBe(1);
	});
});

describe('calcMigrationRisk', () => {

	it('mismo major sin CVEs — riesgo low', () => {
		expect(calcMigrationRisk(0, false)).toBe('low');
	});

	it('mismo major con CVEs — riesgo medium', () => {
		expect(calcMigrationRisk(0, true)).toBe('medium');
	});

	it('salto de 1 major sin CVEs — riesgo medium', () => {
		expect(calcMigrationRisk(1, false)).toBe('medium');
	});

	it('salto de 1 major con CVEs — riesgo medium', () => {
		expect(calcMigrationRisk(1, true)).toBe('medium');
	});

	it('salto de 2 majors — riesgo high', () => {
		expect(calcMigrationRisk(2, false)).toBe('high');
	});

	it('salto de 4 majors — riesgo high', () => {
		expect(calcMigrationRisk(4, true)).toBe('high');
	});

	it('sin salto sin CVEs — siempre low', () => {
		expect(calcMigrationRisk(0, false)).toBe('low');
	});
});

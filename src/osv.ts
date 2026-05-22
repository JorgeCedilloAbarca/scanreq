import { Vulnerability, OsvEcosystem } from './ecosystems/types';

/** Resultado de checkCVEs — distingue "sin CVEs confirmado" de "fallo al verificar" */
export interface CveCheckResult {
	vulnerabilities: Vulnerability[];
	/** true si la consulta a OSV falló (timeout, error de red, 4xx/5xx) */
	failed: boolean;
}

/**
 * Compara dos strings de versión numérica (semver simplificado).
 * Devuelve negativo si a < b, 0 si iguales, positivo si a > b.
 */
function compareVersions(a: string, b: string): number {
	const pa = a.split(/[.\-]/).map(p => parseInt(p, 10) || 0);
	const pb = b.split(/[.\-]/).map(p => parseInt(p, 10) || 0);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) { return diff; }
	}
	return 0;
}

/**
 * Extrae la versión de fix correcta para la versión instalada dada.
 *
 * OSV puede reportar múltiples rangos de vulnerabilidad con distintos `fixed`
 * correspondientes a diferentes ramas de mantenimiento (p.ej. 1.x y 2.x).
 * Tomar siempre la fixed más alta es incorrecto: si el usuario tiene 1.8.0,
 * la recomendación correcta es 1.9.5 (su rama), no 2.3.1 (otra rama).
 *
 * Algoritmo:
 * 1. Para cada rango SEMVER/ECOSYSTEM, reconstruir los pares (introduced, fixed).
 * 2. Filtrar solo los rangos donde installedVersion >= introduced (el usuario está afectado).
 * 3. Entre esos rangos, devolver la fixed más baja que sea > installedVersion
 *    (el parche mínimo necesario en la rama afectada).
 * 4. Si no hay ninguna fixed aplicable, devolver undefined (sin parche conocido).
 */
function extractFixedVersion(vuln: any, installedVersion?: string): string | undefined {
	// Pares {introduced, fixed} de todos los rangos SEMVER y ECOSYSTEM
	const candidates: Array<{ introduced: string; fixed: string }> = [];

	for (const affected of vuln.affected ?? []) {
		for (const range of affected.ranges ?? []) {
			if (range.type !== 'SEMVER' && range.type !== 'ECOSYSTEM') { continue; }

			let introduced: string | undefined;
			for (const event of range.events ?? []) {
				if (event.introduced !== undefined) {
					introduced = event.introduced === '0' ? '0.0.0' : event.introduced;
				} else if (event.fixed !== undefined && introduced !== undefined) {
					candidates.push({ introduced, fixed: event.fixed });
					introduced = undefined; // reset para el siguiente par en el mismo rango
				}
			}
		}
	}

	if (candidates.length === 0) { return undefined; }

	// Si no tenemos versión instalada, devolver la fixed más baja disponible
	// (comportamiento conservador: siempre mostrar algo útil).
	if (!installedVersion || installedVersion === 'unknown') {
		const fixes = candidates.map(c => c.fixed);
		fixes.sort((a, b) => compareVersions(a, b));
		return fixes[0];
	}

	// Filtrar rangos donde el usuario está afectado: introduced <= installed < fixed
	const applicable = candidates.filter(c => {
		const afterIntroduced = compareVersions(installedVersion, c.introduced) >= 0;
		const beforeFixed     = compareVersions(installedVersion, c.fixed) < 0;
		return afterIntroduced && beforeFixed;
	});

	if (applicable.length === 0) { return undefined; }

	// Devolver la fixed más baja entre las aplicables (mínimo parche necesario en esa rama)
	applicable.sort((a, b) => compareVersions(a.fixed, b.fixed));
	return applicable[0].fixed;
}

export async function checkCVEs(
	packageName: string,
	version: string,
	ecosystem: OsvEcosystem
): Promise<CveCheckResult> {
	// Timeout de 10 s — evita que un OSV lento bloquee el scan indefinidamente
	const controller = new AbortController();
	const timeoutId  = setTimeout(() => controller.abort(), 10_000);

	try {
		const response = await fetch('https://api.osv.dev/v1/query', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				version: version,
				package: { name: packageName, ecosystem }
			}),
			signal: controller.signal,
		});

		// Un 429 o 5xx no equivale a "sin vulnerabilidades" — logueamos y
		// marcamos como failed para que el webview no muestre "✓ Sin CVEs".
		if (!response.ok) {
			console.warn(`ScanReq: OSV responded ${response.status} for ${packageName}@${version}`);
			return { vulnerabilities: [], failed: true };
		}

		const data = await response.json() as any;
		if (!data.vulns) {
			return { vulnerabilities: [], failed: false };
		}

		// Ordenar por severidad ANTES de truncar — nunca ocultar un CRITICAL
		const SEVERITY_ORDER: Record<string, number> = {
			CRITICAL: 0,
			HIGH:     1,
			MEDIUM:   2,
			LOW:      3,
		};

		const sorted = (data.vulns as any[]).slice().sort((a, b) => {
			const sa = SEVERITY_ORDER[a.database_specific?.severity ?? ''] ?? 4;
			const sb = SEVERITY_ORDER[b.database_specific?.severity ?? ''] ?? 4;
			return sa - sb;
		});

		const vulnerabilities = sorted.slice(0, 5).map((v: any) => ({
			id: v.id,
			summary: v.summary || 'No description',
			severity: v.database_specific?.severity || 'UNKNOWN',
			fixedVersion: extractFixedVersion(v, version),
		}));

		return { vulnerabilities, failed: false };

	} catch (err: any) {
		// AbortError = timeout expirado, o error de red
		if (err?.name === 'AbortError') {
			console.warn(`ScanReq: OSV query timed out for ${packageName}@${version}`);
		}
		return { vulnerabilities: [], failed: true };
	} finally {
		clearTimeout(timeoutId);
	}
}

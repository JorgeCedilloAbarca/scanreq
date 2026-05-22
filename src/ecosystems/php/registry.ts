import { PackageResult, EcosystemId } from '../types';
import { checkCVEs } from '../../osv';
import { calcMajorVersionJump } from '../types';

const ECOSYSTEM: EcosystemId = 'php';
const OSV_ECOSYSTEM = 'Packagist';

/**
 * Consulta Packagist API para un paquete PHP.
 *
 * Endpoint: https://repo.packagist.org/p2/{vendor}/{package}.json
 *
 * La respuesta contiene un array "packages.{name}" con todos los releases
 * ordenados de más reciente a más antiguo. El primer elemento es el latest
 * no-dev (Packagist los marca con "version_normalized").
 *
 * Notas:
 * - Los nombres en Packagist son "vendor/package" (siempre con slash)
 * - Las versiones llevan prefijo "v" en el campo "version" de la API
 *   pero no en "version_normalized" → usamos "version" y normalizamos
 */
export async function checkPackagist(
	name: string,
	installedVersion: string,
	exactVersion: boolean,
	isPro: boolean
): Promise<PackageResult> {
	const notFound: PackageResult = {
		name,
		installedVersion,
		latestVersion: 'Not found',
		upToDate: false,
		exactVersion,
		vulnerabilities: [],
		detectedByTool: false,
		ecosystem: ECOSYSTEM,
		majorVersionJump: 0,
	};

	// Packagist requiere el formato "vendor/package"
	if (!name.includes('/')) { return notFound; }

	const controller = new AbortController();
	const timeoutId  = setTimeout(() => controller.abort(), 10_000);

	try {
		const url = `https://repo.packagist.org/p2/${name}.json`;
		const response = await fetch(url, {
			headers: { 'User-Agent': 'ScanReq-VSCode-Extension/2.5 (https://scanreq.com)' },
			signal: controller.signal,
		});

		if (!response.ok) { return notFound; }

		const data = await response.json() as any;

		// La clave en "packages" es el nombre exacto del paquete
		const releases: any[] = data?.packages?.[name];
		if (!Array.isArray(releases) || releases.length === 0) { return notFound; }

		// El primer release estable (sin "dev-", "-alpha", "-beta", "-RC")
		const latest = findLatestStable(releases);
		if (!latest) { return notFound; }

		const latestVersion = normalizeVersion(latest.version);
		const upToDate = installedVersion !== 'unknown' && installedVersion === latestVersion;
		const majorVersionJump = calcMajorVersionJump(installedVersion, latestVersion);

		// CVEs: solo si la versión es exacta (Free) o si es Pro
		let vulnerabilities: import('../types').Vulnerability[] = [];
		if (exactVersion || isPro) {
			vulnerabilities = await checkCVEs(name, installedVersion, OSV_ECOSYSTEM);
		}

		return {
			name,
			installedVersion,
			latestVersion,
			upToDate,
			exactVersion,
			vulnerabilities,
			detectedByTool: false,
			ecosystem: ECOSYSTEM,
			majorVersionJump,
		};
	} catch {
		return notFound;
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Encuentra el primer release estable en la lista de Packagist.
 * Packagist devuelve releases de más reciente a más antiguo.
 * Excluye: dev-, alpha, beta, RC.
 */
function findLatestStable(releases: any[]): any | null {
	for (const release of releases) {
		const version: string = release?.version ?? '';
		if (!version) { continue; }

		// Excluir ramas dev
		if (version.startsWith('dev-') || version.endsWith('-dev')) { continue; }

		// Excluir pre-releases
		const lower = version.toLowerCase();
		if (lower.includes('alpha') || lower.includes('beta') || lower.includes('-rc')) { continue; }

		return release;
	}
	return null;
}

function normalizeVersion(version: string): string {
	return version.startsWith('v') ? version.slice(1) : version;
}

/**
 * Encuentra el primer release estable en la lista de Packagist.
 * Packagist devuelve releases de más reciente a más antiguo.
 * Excluye: dev-, alpha, beta, RC.
 */
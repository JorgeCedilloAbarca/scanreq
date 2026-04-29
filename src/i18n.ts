import * as vscode from 'vscode';

const i18n: Record<string, Record<string, string>> = {
	es: {
		title: 'ScanReq',
		subtitle: 'Análisis de requirements.txt',
		upToDate: 'al día',
		outdated: 'desactualizados',
		withCVEs: 'con CVEs',
		colPackage: 'Paquete',
		colInstalled: 'Instalado',
		colAvailable: 'Disponible',
		colVersion: 'Versión',
		colSecurity: 'Seguridad',
		badgeOk: '✓ Al día',
		badgeNoCVEs: '✓ Sin CVEs',
		badgeAvailable: 'disponible',
		noWorkspace: 'ScanReq: No hay ninguna carpeta abierta.',
		noReqFile: 'ScanReq: No se encontró requirements.txt.',
		analyzing: 'ScanReq: Analizando',
		analyzingPackages: 'paquetes...',
		notFound: 'No encontrado',
		statusOk: 'ScanReq ✓ Todo al día',
		statusCVEs: 'ScanReq ⚠ CVEs',
		statusOutdated: 'ScanReq ↑ Actualizaciones',
		statusTooltipOk: 'ScanReq: Todo al día',
		statusTooltipCVEs: 'ScanReq: Hay vulnerabilidades — click para ver',
		statusTooltipOutdated: 'ScanReq: Hay actualizaciones disponibles — click para ver',
	},
	en: {
		title: 'ScanReq',
		subtitle: 'requirements.txt analysis',
		upToDate: 'up to date',
		outdated: 'outdated',
		withCVEs: 'with CVEs',
		colPackage: 'Package',
		colInstalled: 'Installed',
		colAvailable: 'Available',
		colVersion: 'Version',
		colSecurity: 'Security',
		badgeOk: '✓ Up to date',
		badgeNoCVEs: '✓ No CVEs',
		badgeAvailable: 'available',
		noWorkspace: 'ScanReq: No folder is open.',
		noReqFile: 'ScanReq: No requirements.txt found.',
		analyzing: 'ScanReq: Analyzing',
		analyzingPackages: 'packages...',
		notFound: 'Not found',
		statusOk: 'ScanReq ✓ All good',
		statusCVEs: 'ScanReq ⚠ CVEs found',
		statusOutdated: 'ScanReq ↑ Updates available',
		statusTooltipOk: 'ScanReq: Everything is up to date',
		statusTooltipCVEs: 'ScanReq: Vulnerabilities found — click to view',
		statusTooltipOutdated: 'ScanReq: Updates available — click to view',
	}
};

export function getLocale(): string {
	const lang = vscode.env.language;
	if (lang.startsWith('es')) { return 'es'; }
	return 'en';
}

export function t(key: string): string {
	const locale = getLocale();
	return i18n[locale][key] ?? i18n['en'][key] ?? key;
}
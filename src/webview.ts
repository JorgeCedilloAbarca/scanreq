import { PackageInfo } from './pypi';
import { t, getLocale } from './i18n';

function getSeverityColor(severity: string): string {
	switch (severity.toUpperCase()) {
		case 'CRITICAL': return '#ff4444';
		case 'HIGH': return '#ff6b35';
		case 'MEDIUM': return '#ffa500';
		case 'LOW': return '#ffcc00';
		default: return '#888888';
	}
}

function generateInsights(packages: PackageInfo[]): string {
	const locale = getLocale();
	const criticalCVEs = packages.filter(p =>
		p.vulnerabilities.some(v => v.severity === 'CRITICAL' || v.severity === 'HIGH')
	);
	const anyCVEs = packages.filter(p => p.vulnerabilities.length > 0);
	const outdated = packages.filter(p => !p.upToDate);
	const inexact = packages.filter(p => !p.exactVersion);

	const insights: { type: string; message: string }[] = [];

	if (locale === 'es') {
		if (criticalCVEs.length > 0) {
			insights.push({
				type: 'critical',
				message: `⚠ Atención: ${criticalCVEs.map(p => p.name).join(', ')} ${criticalCVEs.length === 1 ? 'tiene' : 'tienen'} vulnerabilidades de severidad alta o crítica. Actualiza estos paquetes antes de desplegar en producción.`
			});
		} else if (anyCVEs.length > 0) {
			insights.push({
				type: 'warning',
				message: `${anyCVEs.length} paquete${anyCVEs.length > 1 ? 's tienen' : ' tiene'} CVEs conocidos. Revisa si afectan a tu caso de uso antes de decidir si actualizar.`
			});
		}
		if (outdated.length > 5) {
			insights.push({
				type: 'warning',
				message: `Tienes ${outdated.length} paquetes desactualizados. No actualices todos a la vez — hazlo de forma gradual y ejecuta tus tests después de cada actualización para detectar incompatibilidades.`
			});
		} else if (outdated.length > 0) {
			insights.push({
				type: 'info',
				message: `${outdated.length} paquete${outdated.length > 1 ? 's disponibles' : ' disponible'} para actualizar. Revisa los changelogs antes de actualizar para evitar breaking changes.`
			});
		}
		if (anyCVEs.length === 0 && outdated.length === 0 && inexact.length === 0) {
			insights.push({ type: 'ok', message: '✓ Tu stack está al día y sin vulnerabilidades conocidas. Buen trabajo.' });
		}
		if (inexact.length > 0) {
			insights.push({
				type: 'warning',
				message: `${inexact.length} paquete${inexact.length > 1 ? 's no tienen' : ' no tiene'} una versión exacta — no es posible analizar sus vulnerabilidades. Cámbialos a <code>==</code> para un análisis completo, o activa el plan Pro en <a href="https://scanreq.com" style="color:#b899ee;">scanreq.com</a> para que ScanReq detecte automáticamente las versiones instaladas en tu entorno.`
			});
		}
		insights.push({
			type: 'pro',
			message: '🔒 Las posibles incompatibilidades entre versiones no se analizan en el plan Free. Activa el plan Pro en <a href="https://scanreq.com" style="color:#b899ee;">scanreq.com</a> para un análisis completo de compatibilidad y recomendaciones de actualización segura.'
		});
	} else {
		if (criticalCVEs.length > 0) {
			insights.push({
				type: 'critical',
				message: `⚠ Warning: ${criticalCVEs.map(p => p.name).join(', ')} ${criticalCVEs.length === 1 ? 'has' : 'have'} high or critical severity vulnerabilities. Update these packages before deploying to production.`
			});
		} else if (anyCVEs.length > 0) {
			insights.push({
				type: 'warning',
				message: `${anyCVEs.length} package${anyCVEs.length > 1 ? 's have' : ' has'} known CVEs. Check if they affect your use case before deciding to update.`
			});
		}
		if (outdated.length > 5) {
			insights.push({
				type: 'warning',
				message: `You have ${outdated.length} outdated packages. Don't update all at once — do it gradually and run your tests after each update to catch incompatibilities.`
			});
		} else if (outdated.length > 0) {
			insights.push({
				type: 'info',
				message: `${outdated.length} package${outdated.length > 1 ? 's available' : ' available'} to update. Review changelogs before updating to avoid breaking changes.`
			});
		}
		if (anyCVEs.length === 0 && outdated.length === 0 && inexact.length === 0) {
			insights.push({ type: 'ok', message: '✓ Your stack is up to date and has no known vulnerabilities. Great job.' });
		}
		if (inexact.length > 0) {
			insights.push({
				type: 'warning',
				message: `${inexact.length} package${inexact.length > 1 ? 's do not have' : ' does not have'} an exact version — vulnerabilities cannot be analyzed. Switch them to <code>==</code> for a full scan, or activate the Pro plan at <a href="https://scanreq.com" style="color:#b899ee;">scanreq.com</a> so ScanReq automatically detects the installed versions in your environment.`
			});
		}
		insights.push({
			type: 'pro',
			message: '🔒 Possible version incompatibilities are not analyzed in the Free plan. Activate the Pro plan at <a href="https://scanreq.com" style="color:#b899ee;">scanreq.com</a> for full compatibility analysis and safe update recommendations.'
		});
	}

	return insights.map(i => `<div class="insight insight-${i.type}">${i.message}</div>`).join('');
}

export function getWebviewContent(packages: PackageInfo[]): string {
	const rows = packages.map(pkg => {
		const displayVersion = pkg.exactVersion
			? pkg.installedVersion
			: `∼${pkg.installedVersion}`;

		const status = pkg.exactVersion
			? pkg.upToDate
				? `<span class="badge ok">${t('badgeOk')}</span>`
				: `<span class="badge outdated">↑ ${pkg.installedVersion} → ${pkg.latestVersion}</span>`
			: `<span class="badge approx">↑ ${pkg.latestVersion} ${t('badgeAvailable')}</span>`;

		const vulnBadge = pkg.vulnerabilities.length > 0
			? `<span class="badge vuln">⚠ ${pkg.vulnerabilities.length} CVE</span>`
			: pkg.exactVersion
				? `<span class="badge safe">${t('badgeNoCVEs')}</span>`
				: `<span class="badge unknown">— Pro</span>`;

		const vulnDetails = pkg.vulnerabilities.map(v => `
			<div class="vuln-detail">
				<span class="vuln-id" style="color:${getSeverityColor(v.severity)}">${v.id}</span>
				<span class="vuln-summary">${v.summary}</span>
			</div>
		`).join('');

		return `
			<tr>
				<td><a href="https://pypi.org/project/${pkg.name}" class="pkg-link">${pkg.name}</a></td>
				<td>${displayVersion}</td>
				<td>${pkg.latestVersion}</td>
				<td>${status}</td>
				<td>${vulnBadge}${vulnDetails}</td>
			</tr>`;
	}).join('');

	const outdatedCount = packages.filter(p => !p.upToDate).length;
	const okCount = packages.filter(p => p.upToDate).length;
	const vulnCount = packages.filter(p => p.vulnerabilities.length > 0).length;

	return `<!DOCTYPE html>
	<html lang="es">
	<head>
		<meta charset="UTF-8">
		<style>
			html, body { height: auto; overflow-y: auto; }
			body {
				font-family: var(--vscode-font-family);
				font-size: var(--vscode-font-size);
				color: var(--vscode-foreground);
				background: var(--vscode-editor-background);
				padding: 20px;
				margin: 0;
			}
			h1 { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
			.subtitle { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 20px; }
			.summary { display: flex; gap: 16px; margin-bottom: 24px; }
			.summary-card { padding: 12px 20px; border-radius: 6px; font-size: 13px; font-weight: 500; }
			.summary-card.ok { background: rgba(40,167,69,0.15); border: 1px solid rgba(40,167,69,0.3); color: #28a745; }
			.summary-card.outdated { background: rgba(255,165,0,0.15); border: 1px solid rgba(255,165,0,0.3); color: #ffa500; }
			.summary-card.vuln { background: rgba(255,68,68,0.15); border: 1px solid rgba(255,68,68,0.3); color: #ff4444; }
			table { width: 100%; border-collapse: collapse; font-size: 13px; }
			thead tr { border-bottom: 1px solid var(--vscode-panel-border); }
			th {
				text-align: left; padding: 8px 12px;
				font-size: 11px; letter-spacing: 0.05em;
				text-transform: uppercase;
				color: var(--vscode-descriptionForeground);
				font-weight: 500;
			}
			td { padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: top; }
			tr:hover td { background: var(--vscode-list-hoverBackground); }
			.pkg-link { color: var(--vscode-textLink-foreground); text-decoration: none; font-weight: 500; }
			.pkg-link:hover { text-decoration: underline; }
			.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
			.badge.ok { background: rgba(40,167,69,0.15); color: #28a745; }
			.badge.outdated { background: rgba(255,165,0,0.15); color: #ffa500; }
			.badge.approx { background: rgba(255,165,0,0.1); color: #ffcc77; }
			.badge.vuln { background: rgba(255,68,68,0.15); color: #ff4444; }
			.badge.safe { background: rgba(40,167,69,0.15); color: #28a745; }
			.badge.unknown { background: rgba(147,112,219,0.15); color: #9370db; font-style: italic; }
			.vuln-detail { margin-top: 6px; font-size: 11px; }
			.vuln-id { font-weight: 600; margin-right: 6px; }
			.vuln-summary { color: var(--vscode-descriptionForeground); }
			.insights { margin-top: 32px; display: flex; flex-direction: column; gap: 10px; padding-bottom: 32px; }
			.insight { padding: 12px 16px; border-radius: 6px; font-size: 12px; line-height: 1.7; border-left: 3px solid; }
			.insight-critical { background: rgba(255,68,68,0.1); border-color: #ff4444; color: #ff8888; }
			.insight-warning { background: rgba(255,165,0,0.1); border-color: #ffa500; color: #ffcc77; }
			.insight-info { background: rgba(100,160,255,0.1); border-color: #64a0ff; color: #99bfff; }
			.insight-ok { background: rgba(40,167,69,0.1); border-color: #28a745; color: #5fcc7f; }
			.insight-pro { background: rgba(147,112,219,0.1); border-color: #9370db; color: #b899ee; font-style: italic; }
			code { background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-style: normal; }
		</style>
	</head>
	<body>
		<h1>${t('title')}</h1>
		<div class="subtitle">${t('subtitle')}</div>
		<div class="summary">
			<div class="summary-card ok">✓ ${okCount} ${t('upToDate')}</div>
			<div class="summary-card outdated">↑ ${outdatedCount} ${t('outdated')}</div>
			<div class="summary-card vuln">⚠ ${vulnCount} ${t('withCVEs')}</div>
		</div>
		<table>
			<thead>
				<tr>
					<th>${t('colPackage')}</th>
					<th>${t('colInstalled')}</th>
					<th>${t('colAvailable')}</th>
					<th>${t('colVersion')}</th>
					<th>${t('colSecurity')}</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
		<div class="insights">
			${generateInsights(packages)}
		</div>
	</body>
	</html>`;
}
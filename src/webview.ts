import { PackageInfo } from './pypi';
import { LicenseStatus } from './license';
import { CompatibilityReport } from './compatibility';
import { t, getLocale } from './i18n';

function getSeverityColor(severity: string): string {
	switch (severity.toUpperCase()) {
		case 'CRITICAL': return '#ff4444';
		case 'HIGH':     return '#ff6b35';
		case 'MEDIUM':   return '#ffa500';
		case 'LOW':      return '#ffcc00';
		default:         return '#888888';
	}
}

function generateInsights(packages: PackageInfo[], isPro: boolean): string {
	const locale = getLocale();
	const criticalCVEs = packages.filter(p =>
		p.vulnerabilities.some(v => v.severity === 'CRITICAL' || v.severity === 'HIGH')
	);
	const anyCVEs = packages.filter(p => p.vulnerabilities.length > 0);
	const outdated = packages.filter(p => !p.upToDate);
	const inexact = packages.filter(p => !p.exactVersion);
	const detectedByPip = packages.filter(p => p.detectedByPip);

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
				message: `Tienes ${outdated.length} paquetes desactualizados. No actualices todos a la vez — hazlo de forma gradual y ejecuta tus tests tras cada cambio.`
			});
		} else if (outdated.length > 0) {
			insights.push({
				type: 'info',
				message: `${outdated.length} paquete${outdated.length > 1 ? 's disponibles' : ' disponible'} para actualizar. Revisa los changelogs antes de actualizar.`
			});
		}
		if (isPro && detectedByPip.length > 0) {
			insights.push({
				type: 'info',
				message: `✓ Pro: versión instalada detectada automáticamente con pip para ${detectedByPip.length} paquete${detectedByPip.length > 1 ? 's' : ''} con especificador no exacto.`
			});
		}
		if (anyCVEs.length === 0 && outdated.length === 0 && inexact.length === 0) {
			insights.push({ type: 'ok', message: '✓ Tu stack está al día y sin vulnerabilidades conocidas. Buen trabajo.' });
		}
		if (!isPro && inexact.length > 0) {
			insights.push({
				type: 'warning',
				message: `${inexact.length} paquete${inexact.length > 1 ? 's no tienen' : ' no tiene'} versión exacta — vulnerabilidades no analizadas. Cámbialos a <code>==</code> o activa el plan Pro en <a href="https://scanreq.com" style="color:#b899ee;">scanreq.com</a> para detección automática.`
			});
		}
		if (!isPro) {
			insights.push({
				type: 'pro',
				message: '🔒 Análisis de compatibilidad entre versiones no disponible en el plan Free. Activa el plan Pro en <a href="https://scanreq.com" style="color:#b899ee;">scanreq.com</a>.<br><br><strong>¿Por qué Pro y no pedírselo a una IA?</strong> Un agente IA necesitaría consultar PyPI, OSV.dev y cruzar dependencias en tiempo real — eso cuesta ~$0.85 por scan en tokens. Con Pro pagas $19 una vez y escaneas ilimitado. Además, la IA no tiene acceso a tu entorno local ni conoce los CVEs publicados esta semana.'
			});
		}
	} else {
		if (criticalCVEs.length > 0) {
			insights.push({
				type: 'critical',
				message: `⚠ Warning: ${criticalCVEs.map(p => p.name).join(', ')} ${criticalCVEs.length === 1 ? 'has' : 'have'} high or critical severity vulnerabilities. Update before deploying to production.`
			});
		} else if (anyCVEs.length > 0) {
			insights.push({
				type: 'warning',
				message: `${anyCVEs.length} package${anyCVEs.length > 1 ? 's have' : ' has'} known CVEs. Check if they affect your use case before updating.`
			});
		}
		if (outdated.length > 5) {
			insights.push({
				type: 'warning',
				message: `You have ${outdated.length} outdated packages. Don't update all at once — do it gradually and run your tests after each change.`
			});
		} else if (outdated.length > 0) {
			insights.push({
				type: 'info',
				message: `${outdated.length} package${outdated.length > 1 ? 's' : ''} available to update. Review changelogs before updating.`
			});
		}
		if (isPro && detectedByPip.length > 0) {
			insights.push({
				type: 'info',
				message: `✓ Pro: installed version auto-detected via pip for ${detectedByPip.length} package${detectedByPip.length > 1 ? 's' : ''} with non-exact specifiers.`
			});
		}
		if (anyCVEs.length === 0 && outdated.length === 0 && inexact.length === 0) {
			insights.push({ type: 'ok', message: '✓ Your stack is up to date and has no known vulnerabilities. Great job.' });
		}
		if (!isPro && inexact.length > 0) {
			insights.push({
				type: 'warning',
				message: `${inexact.length} package${inexact.length > 1 ? 's do not have' : ' does not have'} an exact version — vulnerabilities not analyzed. Switch to <code>==</code> or activate the Pro plan at <a href="https://scanreq.com" style="color:#b899ee;">scanreq.com</a>.`
			});
		}
		if (!isPro) {
			insights.push({
				type: 'pro',
				message: '🔒 Version compatibility analysis is not available in the Free plan. Activate the Pro plan at <a href="https://scanreq.com" style="color:#b899ee;">scanreq.com</a>.<br><br><strong>Why Pro instead of asking an AI?</strong> An AI agent would need to query PyPI, OSV.dev and cross-reference dependencies in real time — that costs ~$0.85 per scan in tokens. With Pro you pay $19 once and scan unlimited. Plus, AI has no access to your local environment and doesn\'t know about CVEs published this week.'
			});
		}
	}

	return insights.map(i => `<div class="insight insight-${i.type}">${i.message}</div>`).join('');
}

function generateCompatibilitySection(report: CompatibilityReport, locale: string): string {
	const { conflicts, safeUpdates, pipUnavailable } = report;

	let html = `<div class="compat-section">`;
	html += `<h2 class="section-title">${locale === 'es' ? '🔍 Análisis de Compatibilidad Pro' : '🔍 Pro Compatibility Analysis'}</h2>`;

	if (pipUnavailable) {
		html += `<div class="insight insight-warning">
			${locale === 'es'
				? '⚠ pip no está disponible en el PATH. Instala Python y pip para que ScanReq pueda detectar versiones instaladas y completar el análisis de compatibilidad. <a href="https://pip.pypa.io/en/stable/installation/" style="color:#b899ee;">Ver instrucciones</a>'
				: '⚠ pip is not available in PATH. Install Python and pip so ScanReq can detect installed versions and complete the compatibility analysis. <a href="https://pip.pypa.io/en/stable/installation/" style="color:#b899ee;">See instructions</a>'
			}
		</div>`;
	}

	if (conflicts.length === 0 && !pipUnavailable) {
		html += `<div class="insight insight-ok">
			${locale === 'es'
				? '✓ No se detectaron conflictos de dependencias entre los paquetes instalados.'
				: '✓ No dependency conflicts detected among installed packages.'}
		</div>`;
	}

	if (conflicts.length > 0) {
		html += `<div class="insight insight-critical" style="margin-bottom:8px;">
			${locale === 'es'
				? `⚠ Se detectaron ${conflicts.length} conflicto${conflicts.length > 1 ? 's' : ''} de dependencias:`
				: `⚠ ${conflicts.length} dependency conflict${conflicts.length > 1 ? 's' : ''} detected:`}
		</div>`;
		html += `<table class="compat-table">
			<thead><tr>
				<th>${locale === 'es' ? 'Paquete' : 'Package'}</th>
				<th>${locale === 'es' ? 'Versión instalada' : 'Installed version'}</th>
				<th>${locale === 'es' ? 'Requerido por' : 'Required by'}</th>
				<th>${locale === 'es' ? 'Requisito' : 'Requirement'}</th>
				<th>${locale === 'es' ? 'Recomendación' : 'Recommendation'}</th>
			</tr></thead>
			<tbody>`;
		for (const conflict of conflicts) {
			html += `<tr>
				<td><strong>${conflict.packageName}</strong></td>
				<td><span class="badge vuln">${conflict.installedVersion}</span></td>
				<td>${conflict.requiredBy}</td>
				<td><code>${conflict.requiredSpec}</code></td>
				<td class="recommendation">${conflict.recommendation}</td>
			</tr>`;
		}
		html += `</tbody></table>`;
	}

	if (safeUpdates.length > 0) {
		html += `<h3 class="subsection-title" style="margin-top:24px;">
			${locale === 'es' ? '✓ Actualizaciones seguras recomendadas' : '✓ Recommended safe updates'}
		</h3>`;
		html += `<table class="compat-table">
			<thead><tr>
				<th>${locale === 'es' ? 'Paquete' : 'Package'}</th>
				<th>${locale === 'es' ? 'Actual' : 'Current'}</th>
				<th>${locale === 'es' ? 'Recomendado' : 'Recommended'}</th>
				<th>${locale === 'es' ? 'Motivo' : 'Reason'}</th>
			</tr></thead>
			<tbody>`;
		for (const upd of safeUpdates) {
			html += `<tr>
				<td><strong>${upd.packageName}</strong></td>
				<td><span class="badge outdated">${upd.currentVersion}</span></td>
				<td><span class="badge ok">${upd.recommendedVersion}</span></td>
				<td>${upd.reason}</td>
			</tr>`;
		}
		html += `</tbody></table>`;
	}

	html += `</div>`;
	return html;
}

function buildAIPrompt(
	packages: PackageInfo[],
	compatReport: CompatibilityReport | null,
	locale: string
): string {
	const lines: string[] = [];

	const reqLines = packages.map(pkg => {
		const op = pkg.exactVersion ? '==' : '>=';
		return `${pkg.name}${op}${pkg.installedVersion}`;
	});

	if (locale === 'es') {
		lines.push('Tengo el siguiente requirements.txt:');
		lines.push('');
		lines.push(...reqLines);
		lines.push('');
		lines.push('ScanReq Pro ha analizado mis dependencias y ha encontrado lo siguiente:');
		lines.push('');

		const withCVEs = packages.filter(p => p.vulnerabilities.length > 0);
		if (withCVEs.length > 0) {
			lines.push('VULNERABILIDADES DETECTADAS:');
			for (const pkg of withCVEs) {
				lines.push(`- ${pkg.name} ${pkg.installedVersion}: ${pkg.vulnerabilities.length} CVE(s) — actualizar a ${pkg.latestVersion}`);
				for (const v of pkg.vulnerabilities) {
					lines.push(`  · ${v.id} [${v.severity}]: ${v.summary}`);
				}
			}
			lines.push('');
		}

		if (compatReport && compatReport.conflicts.length > 0) {
			lines.push('CONFLICTOS DE DEPENDENCIAS:');
			for (const c of compatReport.conflicts) {
				lines.push(`- ${c.packageName} ${c.installedVersion} no cumple el requisito ${c.requiredSpec} de ${c.requiredBy}`);
				lines.push(`  Recomendación: ${c.recommendation}`);
			}
			lines.push('');
		}

		if (compatReport && compatReport.safeUpdates.length > 0) {
			lines.push('ACTUALIZACIONES SEGURAS RECOMENDADAS:');
			for (const u of compatReport.safeUpdates) {
				lines.push(`- ${u.packageName}: ${u.currentVersion} → ${u.recommendedVersion} (${u.reason})`);
			}
			lines.push('');
		}

		lines.push('Por favor:');
		lines.push('1. Actualiza el requirements.txt aplicando primero las correcciones de CVEs y conflictos, luego las actualizaciones seguras.');
		lines.push('2. Explica brevemente cada cambio que hagas y por qué.');
		lines.push('3. Si alguna actualización puede introducir breaking changes, avísame antes de aplicarla.');
	} else {
		lines.push('I have the following requirements.txt:');
		lines.push('');
		lines.push(...reqLines);
		lines.push('');
		lines.push('ScanReq Pro has analyzed my dependencies and found the following:');
		lines.push('');

		const withCVEs = packages.filter(p => p.vulnerabilities.length > 0);
		if (withCVEs.length > 0) {
			lines.push('VULNERABILITIES DETECTED:');
			for (const pkg of withCVEs) {
				lines.push(`- ${pkg.name} ${pkg.installedVersion}: ${pkg.vulnerabilities.length} CVE(s) — update to ${pkg.latestVersion}`);
				for (const v of pkg.vulnerabilities) {
					lines.push(`  · ${v.id} [${v.severity}]: ${v.summary}`);
				}
			}
			lines.push('');
		}

		if (compatReport && compatReport.conflicts.length > 0) {
			lines.push('DEPENDENCY CONFLICTS:');
			for (const c of compatReport.conflicts) {
				lines.push(`- ${c.packageName} ${c.installedVersion} does not satisfy ${c.requiredSpec} required by ${c.requiredBy}`);
				lines.push(`  Recommendation: ${c.recommendation}`);
			}
			lines.push('');
		}

		if (compatReport && compatReport.safeUpdates.length > 0) {
			lines.push('RECOMMENDED SAFE UPDATES:');
			for (const u of compatReport.safeUpdates) {
				lines.push(`- ${u.packageName}: ${u.currentVersion} → ${u.recommendedVersion} (${u.reason})`);
			}
			lines.push('');
		}

		lines.push('Please:');
		lines.push('1. Update the requirements.txt applying CVE fixes and conflict resolutions first, then safe updates.');
		lines.push('2. Briefly explain each change and why.');
		lines.push('3. If any update may introduce breaking changes, warn me before applying it.');
	}

	return lines.join('\n');
}

export function getWebviewContent(
	packages: PackageInfo[],
	license: LicenseStatus,
	compatReport: CompatibilityReport | null
): string {
	const locale = getLocale();
	const isPro = license.active;

	const okCount = packages.filter(p => p.upToDate && p.vulnerabilities.length === 0).length;
	const outdatedCount = packages.filter(p => !p.upToDate).length;
	const vulnCount = packages.filter(p => p.vulnerabilities.length > 0).length;

	const licenceBadge = isPro
		? `<span class="license-badge pro">${license.isAdmin ? '👑 Admin' : '⚡ Pro'}</span>`
		: `<span class="license-badge free">Free — <a href="command:scanreq.activateLicense" style="color:#b899ee;">Activar Pro</a></span>`;

	// El prompt se genera en JS del lado del webview para no exponerlo en el HTML
	const aiPromptEscaped = isPro
		? buildAIPrompt(packages, compatReport, locale)
			.replace(/\\/g, '\\\\')
			.replace(/`/g, '\\`')
			.replace(/\$/g, '\\$')
		: '';

	const copyButtonHtml = isPro ? `
		<button class="copy-prompt-btn" id="copyPromptBtn" onclick="copyPrompt()">
			${locale === 'es' ? '🤖 Copiar prompt para IA' : '🤖 Copy AI prompt'}
		</button>
		<span class="copy-feedback" id="copyFeedback">
			${locale === 'es' ? '✓ Copiado al portapapeles' : '✓ Copied to clipboard'}
		</span>
	` : '';

	const rows = packages.map(pkg => {
		const versionLabel = pkg.detectedByPip
			? `${pkg.installedVersion} <span class="pip-detected" title="${locale === 'es' ? 'Detectado con pip' : 'Detected via pip'}">pip</span>`
			: pkg.exactVersion
				? pkg.installedVersion
				: `<span style="color:#ffcc77;" title="${locale === 'es' ? 'Versión no exacta' : 'Non-exact version'}">∼${pkg.installedVersion}</span>`;

		const versionStatus = pkg.exactVersion || pkg.detectedByPip
			? pkg.upToDate
				? `<span class="badge ok">${t('badgeOk')}</span>`
				: `<span class="badge outdated">↑ ${pkg.latestVersion} ${t('badgeAvailable')}</span>`
			: `<span class="badge approx">${locale === 'es' ? '∼ Sin fijar' : '∼ Unpinned'}</span>`;

		const securityBadge = pkg.vulnerabilities.length > 0
			? `<span class="badge vuln">⚠ ${pkg.vulnerabilities.length} CVE${pkg.vulnerabilities.length > 1 ? 's' : ''}</span>`
			: (pkg.exactVersion || pkg.detectedByPip)
				? `<span class="badge safe">${t('badgeNoCVEs')}</span>`
				: `<span class="badge unknown">${locale === 'es' ? '— No analizado' : '— Not analyzed'}</span>`;

		const vulnDetails = pkg.vulnerabilities.map(v => `
			<div class="vuln-detail">
				<span class="vuln-id" style="color:${getSeverityColor(v.severity)};">${v.id}</span>
				<span class="vuln-severity" style="color:${getSeverityColor(v.severity)};">[${v.severity}]</span>
				<span class="vuln-summary">${v.summary}</span>
			</div>
		`).join('');

		const pkgDisplayName = pkg.name.replace(/\[.*?\]/g, '');

		return `<tr>
			<td>
				<a class="pkg-link" href="https://pypi.org/project/${pkgDisplayName}/" target="_blank">${pkg.name}</a>
			</td>
			<td>${versionLabel}</td>
			<td>${pkg.latestVersion}</td>
			<td>${versionStatus}</td>
			<td>${securityBadge}${vulnDetails}</td>
		</tr>`;
	}).join('');

	const compatSection = isPro && compatReport
		? generateCompatibilitySection(compatReport, locale)
		: '';

	return `<!DOCTYPE html>
	<html lang="${locale}">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>ScanReq</title>
		<style>
			*, *::before, *::after { box-sizing: border-box; }
			body {
				font-family: var(--vscode-font-family);
				color: var(--vscode-foreground);
				background: var(--vscode-editor-background);
				padding: 24px 32px;
				margin: 0;
				font-size: 13px;
				line-height: 1.5;
			}
			.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; flex-wrap: wrap; gap: 8px; }
			h1 { font-size: 20px; font-weight: 700; margin: 0; }
			h2.section-title { font-size: 15px; font-weight: 600; margin: 0 0 16px 0; }
			h3.subsection-title { font-size: 13px; font-weight: 600; margin: 0 0 12px 0; }
			.subtitle { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 20px; }
			.header-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
			.license-badge {
				font-size: 11px; font-weight: 600; padding: 3px 10px;
				border-radius: 12px; display: inline-block;
			}
			.license-badge.pro { background: rgba(147,112,219,0.2); color: #b899ee; border: 1px solid rgba(147,112,219,0.4); }
			.license-badge.free { background: rgba(100,100,100,0.15); color: var(--vscode-descriptionForeground); border: 1px solid rgba(100,100,100,0.3); }
			.copy-prompt-btn {
				font-size: 12px; font-weight: 600;
				padding: 5px 14px; border-radius: 6px; border: none; cursor: pointer;
				background: rgba(147,112,219,0.2); color: #b899ee;
				border: 1px solid rgba(147,112,219,0.4);
				transition: background 0.15s;
			}
			.copy-prompt-btn:hover { background: rgba(147,112,219,0.35); }
			.copy-prompt-btn:active { transform: scale(0.97); }
			.copy-feedback {
				font-size: 11px; color: #5fcc7f;
				opacity: 0; transition: opacity 0.3s;
				pointer-events: none;
			}
			.copy-feedback.visible { opacity: 1; }
			.summary { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
			.summary-card {
				padding: 10px 18px; border-radius: 6px; font-size: 12px;
				font-weight: 600; border: 1px solid transparent;
			}
			.summary-card.ok { background: rgba(40,167,69,0.15); border-color: rgba(40,167,69,0.3); color: #28a745; }
			.summary-card.outdated { background: rgba(255,165,0,0.15); border-color: rgba(255,165,0,0.3); color: #ffa500; }
			.summary-card.vuln { background: rgba(255,68,68,0.15); border-color: rgba(255,68,68,0.3); color: #ff4444; }
			table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
			.compat-table { margin-top: 8px; }
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
			.badge {
				display: inline-block; padding: 2px 8px;
				border-radius: 4px; font-size: 11px; font-weight: 600;
			}
			.badge.ok      { background: rgba(40,167,69,0.15); color: #28a745; }
			.badge.outdated{ background: rgba(255,165,0,0.15); color: #ffa500; }
			.badge.approx  { background: rgba(255,165,0,0.1); color: #ffcc77; }
			.badge.vuln    { background: rgba(255,68,68,0.15); color: #ff4444; }
			.badge.safe    { background: rgba(40,167,69,0.15); color: #28a745; }
			.badge.unknown { background: rgba(147,112,219,0.15); color: #9370db; font-style: italic; }
			.pip-detected {
				display: inline-block; font-size: 9px; font-weight: 700;
				background: rgba(147,112,219,0.2); color: #b899ee;
				border-radius: 3px; padding: 1px 4px; margin-left: 4px;
				vertical-align: middle; letter-spacing: 0.03em;
			}
			.vuln-detail { margin-top: 6px; font-size: 11px; }
			.vuln-id { font-weight: 600; margin-right: 6px; }
			.vuln-summary { color: var(--vscode-descriptionForeground); }
			.recommendation { color: #5fcc7f; font-size: 12px; }
			.insights { margin-top: 32px; display: flex; flex-direction: column; gap: 10px; }
			.compat-section { margin-top: 36px; padding-top: 24px; border-top: 1px solid var(--vscode-panel-border); padding-bottom: 8px; }
			.insight { padding: 12px 16px; border-radius: 6px; font-size: 12px; line-height: 1.7; border-left: 3px solid; }
			.insight-critical { background: rgba(255,68,68,0.1); border-color: #ff4444; color: #ff8888; }
			.insight-warning  { background: rgba(255,165,0,0.1); border-color: #ffa500; color: #ffcc77; }
			.insight-info     { background: rgba(100,160,255,0.1); border-color: #64a0ff; color: #99bfff; }
			.insight-ok       { background: rgba(40,167,69,0.1); border-color: #28a745; color: #5fcc7f; }
			.insight-pro      { background: rgba(147,112,219,0.1); border-color: #9370db; color: #b899ee; font-style: italic; }
			code {
				background: rgba(255,255,255,0.08); padding: 1px 5px;
				border-radius: 3px; font-family: var(--vscode-editor-font-family); font-style: normal;
			}
			.footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--vscode-panel-border); font-size: 11px; color: var(--vscode-descriptionForeground); padding-bottom: 32px; }
		</style>
	</head>
	<body>
		<div class="header">
			<h1>${t('title')}</h1>
			<div class="header-right">
				${copyButtonHtml}
				${licenceBadge}
			</div>
		</div>
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
		${compatSection}
		<div class="insights">
			${generateInsights(packages, isPro)}
		</div>
		<div class="footer">
			ScanReq · <a href="https://scanreq.com" style="color:inherit;">scanreq.com</a>
			${isPro ? ` · ${locale === 'es' ? 'Plan Pro activo' : 'Pro plan active'}` : ''}
		</div>
		<script>
			const aiPrompt = \`${aiPromptEscaped}\`;

			function copyPrompt() {
				navigator.clipboard.writeText(aiPrompt).then(() => {
					const btn = document.getElementById('copyPromptBtn');
					const feedback = document.getElementById('copyFeedback');
					btn.style.opacity = '0.6';
					feedback.classList.add('visible');
					setTimeout(() => {
						btn.style.opacity = '1';
						feedback.classList.remove('visible');
					}, 2000);
				}).catch(() => {
					// Fallback para entornos sin clipboard API
					const ta = document.createElement('textarea');
					ta.value = aiPrompt;
					ta.style.position = 'fixed';
					ta.style.opacity = '0';
					document.body.appendChild(ta);
					ta.select();
					document.execCommand('copy');
					document.body.removeChild(ta);
					const feedback = document.getElementById('copyFeedback');
					feedback.classList.add('visible');
					setTimeout(() => feedback.classList.remove('visible'), 2000);
				});
			}
		</script>
	</body>
	</html>`;
}
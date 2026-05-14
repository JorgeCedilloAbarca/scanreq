import { ScanResult, PackageResult, CompatibilityReport, EcosystemId } from './ecosystems/types';
import { LicenseStatus } from './license';
import { t, getLocale } from './i18n';

// ─── Sanitización XSS ─────────────────────────────────────────────────────────
// Escapa todos los caracteres que el navegador interpreta como HTML.
// Debe aplicarse a CUALQUIER dato externo antes de insertarlo en el DOM:
// nombres de paquetes, versiones, summaries de CVEs, rutas de archivos, etc.

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

// ─── Helpers visuales ─────────────────────────────────────────────────────────

function getSeverityColor(severity: string): string {
	switch (severity.toUpperCase()) {
		case 'CRITICAL': return '#ff4444';
		case 'HIGH':     return '#ff6b35';
		case 'MEDIUM':   return '#ffa500';
		case 'LOW':      return '#ffcc00';
		default:         return '#888888';
	}
}

const ECOSYSTEM_ICONS: Record<EcosystemId, string> = {
	python: '🐍',
	node:   '🟩',
	rust:   '🦀',
	go:     '🔵',
	php:    '🐘',
	ruby:   '💎',
	java:   '☕',
	gradle: '🐘',
};

const ECOSYSTEM_REGISTRY_LINKS: Record<EcosystemId, (name: string) => string> = {
	python: (n) => `https://pypi.org/project/${encodeURIComponent(n.replace(/\[.*?\]/g, ''))}/`,
	node:   (n) => `https://www.npmjs.com/package/${encodeURIComponent(n)}`,
	rust:   (n) => `https://crates.io/crates/${encodeURIComponent(n)}`,
	go:     (n) => `https://pkg.go.dev/${encodeURIComponent(n)}`,
	php:    (n) => `https://packagist.org/packages/${encodeURIComponent(n)}`,
	ruby:   (n) => `https://rubygems.org/gems/${encodeURIComponent(n)}`,
	java:   (n) => `https://search.maven.org/artifact/${encodeURIComponent(n.replace(':', '/'))}`,
	gradle: (n) => `https://search.maven.org/artifact/${encodeURIComponent(n.replace(':', '/'))}`,
};

// ─── Insights por ecosistema ──────────────────────────────────────────────────

function generateInsights(packages: PackageResult[], isPro: boolean, ecosystem: EcosystemId): string {
	const locale = getLocale();
	const criticalCVEs = packages.filter(p =>
		p.vulnerabilities.some(v => v.severity === 'CRITICAL' || v.severity === 'HIGH')
	);
	const anyCVEs = packages.filter(p => p.vulnerabilities.length > 0);
	const outdated = packages.filter(p => !p.upToDate);
	const inexact = packages.filter(p => !p.exactVersion);
	const detectedByTool = packages.filter(p => p.detectedByTool);

	const insights: { type: string; message: string }[] = [];

	if (locale === 'es') {
		if (criticalCVEs.length > 0) {
			insights.push({
				type: 'critical',
				message: `⚠ Atención: ${criticalCVEs.map(p => escapeHtml(p.name)).join(', ')} ${criticalCVEs.length === 1 ? 'tiene' : 'tienen'} vulnerabilidades de severidad alta o crítica. Actualiza estos paquetes antes de desplegar en producción.`
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
		if (isPro && detectedByTool.length > 0) {
			insights.push({
				type: 'info',
				message: `✓ Pro: versión instalada detectada automáticamente para ${detectedByTool.length} paquete${detectedByTool.length > 1 ? 's' : ''} con especificador no exacto.`
			});
		}
		if (anyCVEs.length === 0 && outdated.length === 0 && inexact.length === 0) {
			insights.push({ type: 'ok', message: '✓ Tu stack está al día y sin vulnerabilidades conocidas. Buen trabajo.' });
		}
		if (!isPro && inexact.length > 0) {
			insights.push({
				type: 'warning',
				message: `${inexact.length} paquete${inexact.length > 1 ? 's no tienen' : ' no tiene'} versión exacta — vulnerabilidades no analizadas. Activa el plan Pro en <a href="https://scanreq.com" style="color:#b899ee;">scanreq.com</a> para detección automática.`
			});
		}
		if (!isPro) {
			insights.push({
				type: 'pro',
				message: '🔒 Análisis de compatibilidad entre versiones no disponible en el plan Free. Activa el plan Pro en <a href="https://scanreq.com" style="color:#b899ee;">scanreq.com</a>.<br><br><strong>¿Por qué Pro y no pedírselo a una IA?</strong> Un agente IA necesitaría consultar los registros de paquetes, OSV.dev y cruzar dependencias en tiempo real — eso cuesta ~$0.85 por scan en tokens. Con Pro pagas $19 una vez y escaneas ilimitado. Además, la IA no tiene acceso a tu entorno local ni conoce los CVEs publicados esta semana.'
			});
		}
	} else {
		if (criticalCVEs.length > 0) {
			insights.push({
				type: 'critical',
				message: `⚠ Warning: ${criticalCVEs.map(p => escapeHtml(p.name)).join(', ')} ${criticalCVEs.length === 1 ? 'has' : 'have'} high or critical severity vulnerabilities. Update before deploying to production.`
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
		if (isPro && detectedByTool.length > 0) {
			insights.push({
				type: 'info',
				message: `✓ Pro: installed version auto-detected for ${detectedByTool.length} package${detectedByTool.length > 1 ? 's' : ''} with non-exact specifiers.`
			});
		}
		if (anyCVEs.length === 0 && outdated.length === 0 && inexact.length === 0) {
			insights.push({ type: 'ok', message: '✓ Your stack is up to date and has no known vulnerabilities. Great job.' });
		}
		if (!isPro && inexact.length > 0) {
			insights.push({
				type: 'warning',
				message: `${inexact.length} package${inexact.length > 1 ? 's do not have' : ' does not have'} an exact version — vulnerabilities not analyzed. Activate the Pro plan at <a href="https://scanreq.com" style="color:#b899ee;">scanreq.com</a>.`
			});
		}
		if (!isPro) {
			insights.push({
				type: 'pro',
				message: '🔒 Version compatibility analysis is not available in the Free plan. Activate the Pro plan at <a href="https://scanreq.com" style="color:#b899ee;">scanreq.com</a>.<br><br><strong>Why Pro instead of asking an AI?</strong> An AI agent would need to query package registries, OSV.dev and cross-reference dependencies in real time — that costs ~$0.85 per scan in tokens. With Pro you pay $19 once and scan unlimited. Plus, AI has no access to your local environment and doesn\'t know about CVEs published this week.'
			});
		}
	}

	return insights.map(i => `<div class="insight insight-${i.type}">${i.message}</div>`).join('');
}

// ─── Sección de compatibilidad (Pro) ─────────────────────────────────────────

function generateCompatibilitySection(report: CompatibilityReport, locale: string): string {
	const { conflicts, safeUpdates, toolUnavailable } = report;

	let html = `<div class="compat-section">`;
	html += `<h3 class="subsection-title">${locale === 'es' ? '🔍 Análisis de Compatibilidad Pro' : '🔍 Pro Compatibility Analysis'}</h3>`;

	if (toolUnavailable) {
		html += `<div class="insight insight-warning">
			${locale === 'es'
				? '⚠ La herramienta de detección de versiones no está disponible en el PATH. Instálala para que ScanReq pueda completar el análisis de compatibilidad.'
				: '⚠ The version detection tool is not available in PATH. Install it so ScanReq can complete the compatibility analysis.'
			}
		</div>`;
	}

	if (conflicts.length === 0 && !toolUnavailable) {
		const hasRealAnalysis = report.conflicts !== undefined;
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
				<td><strong>${escapeHtml(conflict.packageName)}</strong></td>
				<td><span class="badge vuln">${escapeHtml(conflict.installedVersion)}</span></td>
				<td>${escapeHtml(conflict.requiredBy)}</td>
				<td><code>${escapeHtml(conflict.requiredSpec)}</code></td>
				<td class="recommendation">${escapeHtml(conflict.recommendation)}</td>
			</tr>`;
		}
		html += `</tbody></table>`;
	}

	if (safeUpdates.length > 0) {
		html += `<h3 class="subsection-title" style="margin-top:20px;">
			${locale === 'es' ? '✓ Actualizaciones recomendadas' : '✓ Recommended updates'}
		</h3>`;

		const phases: Array<{ risk: 'low'|'medium'|'high'|'unpatched'; label: string; note: string }> = [
			{
				risk: 'low',
				label: locale === 'es' ? 'Fase 1 — Riesgo bajo' : 'Phase 1 — Low risk',
				note: locale === 'es' ? 'Actualiza primero. Sin riesgo de breaking changes.' : 'Update first. No breaking change risk.'
			},
			{
				risk: 'medium',
				label: locale === 'es' ? 'Fase 2 — Riesgo medio' : 'Phase 2 — Medium risk',
				note: locale === 'es' ? 'Revisa el changelog antes de actualizar.' : 'Review changelog before updating.'
			},
			{
				risk: 'high',
				label: locale === 'es' ? 'Fase 3 — Riesgo alto (Major)' : 'Phase 3 — High risk (Major)',
				note: locale === 'es' ? 'Requiere revisión de código. Posibles breaking changes.' : 'Requires code review. Possible breaking changes.'
			},
			{
				risk: 'unpatched',
				label: locale === 'es' ? '⚠ Sin parche disponible' : '⚠ No patch available',
				note: locale === 'es' ? 'CVEs activos sin versión parcheada conocida. Evalúa mitigar o reemplazar.' : 'Active CVEs with no known patched version. Consider mitigating or replacing.'
			}
		];

		for (const phase of phases) {
			const phaseUpdates = safeUpdates
				.filter(u => u.migrationRisk === phase.risk)
				.sort((a, b) => {
					const aHasCVE = a.reason.includes('CVE') ? 0 : 1;
					const bHasCVE = b.reason.includes('CVE') ? 0 : 1;
					return aHasCVE - bHasCVE;
				});

			if (phaseUpdates.length === 0) { continue; }

			html += `<div class="phase-header phase-${phase.risk}">
				<span class="phase-label">${phase.label}</span>
				<span class="phase-note">${phase.note}</span>
			</div>`;

			html += `<table class="compat-table">
				<thead><tr>
					<th>${locale === 'es' ? 'Paquete' : 'Package'}</th>
					<th>${locale === 'es' ? 'Actual' : 'Current'}</th>
					${phase.risk !== 'unpatched' ? `<th>${locale === 'es' ? 'Recomendado' : 'Recommended'}</th>` : ''}
					<th>${locale === 'es' ? 'Motivo' : 'Reason'}</th>
				</tr></thead>
				<tbody>`;

			for (const upd of phaseUpdates) {
				html += `<tr>
					<td><strong>${escapeHtml(upd.packageName)}</strong></td>
					<td><span class="badge vuln">${escapeHtml(upd.currentVersion)}</span></td>
					${phase.risk !== 'unpatched' ? `<td><span class="badge ok">${escapeHtml(upd.recommendedVersion)}</span></td>` : ''}
					<td>${escapeHtml(upd.reason)}</td>
				</tr>`;
			}
			html += `</tbody></table>`;
		}
	}

	html += `</div>`;
	return html;
}

// ─── Tabla de paquetes por ecosistema ─────────────────────────────────────────

function generatePackageTable(result: ScanResult, isPro: boolean, locale: string): string {
	const { packages, ecosystem, compatReport } = result;
	const getLinkFn = ECOSYSTEM_REGISTRY_LINKS[ecosystem];

	const rows = packages.map(pkg => {
		const safeName    = escapeHtml(pkg.name);
		const safeInstalled = escapeHtml(pkg.installedVersion);
		const safeLatest  = escapeHtml(pkg.latestVersion);

		const versionLabel = pkg.detectedByTool
			? `${safeInstalled} <span class="tool-detected" title="${locale === 'es' ? 'Detectado automáticamente' : 'Auto-detected'}">auto</span>`
			: pkg.exactVersion
				? safeInstalled
				: `<span style="color:#ffcc77;" title="${locale === 'es' ? 'Versión no exacta' : 'Non-exact version'}">∼${safeInstalled}</span>`;

		const majorBadge = isPro && !pkg.upToDate && pkg.majorVersionJump >= 1
			? pkg.majorVersionJump === 1
				? `<span class="badge major" title="${locale === 'es' ? 'Salto de versión mayor — puede incluir cambios incompatibles' : 'Major version jump — may include breaking changes'}">⚠ Major</span>`
				: `<span class="badge major" title="${locale === 'es' ? 'Salto de versión mayor — puede incluir cambios incompatibles' : 'Major version jump — may include breaking changes'}">⚠ +${pkg.majorVersionJump} major</span>`
			: '';

		const SPECIAL_LABELS = ['Not found', 'Versión dinámica', 'Repositorio privado', 'No disponible', 'Dynamic version', 'Private repository', 'Not available'];
		const isSpecialLabel = SPECIAL_LABELS.includes(pkg.latestVersion);
		const versionStatus = pkg.exactVersion || pkg.detectedByTool
			? pkg.upToDate
				? `<span class="badge ok">${t('badgeOk')}</span>`
				: `<span class="badge outdated">↑ ${safeLatest} ${t('badgeAvailable')}</span>${majorBadge}`
			: pkg.latestVersion && !isSpecialLabel
				? `<span class="badge outdated">↑ ${safeLatest} ${t('badgeAvailable')}</span>${majorBadge}<span style="font-size:10px;color:var(--vscode-descriptionForeground);margin-left:4px;" title="${locale === 'es' ? 'Versión instalada no fijada' : 'Installed version not pinned'}">(∼)</span>`
				: `<span class="badge approx">${locale === 'es' ? '∼ Sin fijar' : '∼ Unpinned'}</span>`;

		// Fix #3: "— No analizado" era ambiguo — el usuario podía interpretarlo como
		// "sin riesgo". Ahora es un badge naranja explícito que deja claro que la
		// versión instalada no está fijada y por tanto los CVEs no han sido verificados.
		const securityBadge = pkg.vulnerabilities.length > 0
			? `<span class="badge vuln">⚠ ${pkg.vulnerabilities.length} CVE${pkg.vulnerabilities.length > 1 ? 's' : ''}</span>`
			: (pkg.exactVersion || pkg.detectedByTool)
				? `<span class="badge safe">${t('badgeNoCVEs')}</span>`
				: `<span class="badge unverified" title="${locale === 'es' ? 'Versión no fijada — no se puede verificar si esta versión exacta tiene CVEs conocidos. Fija la versión o activa el Plan Pro.' : 'Version not pinned — cannot verify if this exact version has known CVEs. Pin the version or activate the Pro plan.'}">⚠ ${locale === 'es' ? 'No verificado' : 'Unverified'}</span>`;

		const vulnDetails = pkg.vulnerabilities.map(v => `
			<div class="vuln-detail">
				<span class="vuln-id" style="color:${getSeverityColor(v.severity)};">${escapeHtml(v.id)}</span>
				<span class="vuln-severity" style="color:${getSeverityColor(v.severity)};">[${escapeHtml(v.severity)}]</span>
				<span class="vuln-summary">${escapeHtml(v.summary)}</span>
			</div>
		`).join('');

		const pkgLink = getLinkFn(pkg.name);

		return `<tr>
			<td><a class="pkg-link" href="${escapeHtml(pkgLink)}" target="_blank">${safeName}</a></td>
			<td>${versionLabel}</td>
			<td>${safeLatest}</td>
			<td>${versionStatus}</td>
			<td>${securityBadge}${vulnDetails}</td>
		</tr>`;
	}).join('');

	const compatHtml = isPro && compatReport
		? generateCompatibilitySection(compatReport, locale)
		: '';

	return `
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
		${compatHtml}
		<div class="insights" style="margin-top:20px;">
			${generateInsights(packages, isPro, ecosystem)}
		</div>
	`;
}

// ─── Prompt IA (Pro) ─────────────────────────────────────────────────────────

function buildAIPrompt(results: ScanResult[], locale: string): string {
	const lines: string[] = [];

	if (locale === 'es') {
		lines.push('ScanReq Pro ha analizado las dependencias de mi proyecto y ha encontrado lo siguiente:');
		lines.push('');
	} else {
		lines.push('ScanReq Pro has analyzed my project dependencies and found the following:');
		lines.push('');
	}

	for (const result of results) {
		const { ecosystem, packages, compatReport } = result;
		const icon = ECOSYSTEM_ICONS[ecosystem];

		lines.push(`${icon} ${ecosystem.toUpperCase()}`);
		lines.push('---');

		const reqLines = packages.map(pkg => {
			const op = pkg.exactVersion ? '==' : '>=';
			return `${pkg.name}${op}${pkg.installedVersion}`;
		});
		lines.push(...reqLines);
		lines.push('');

		const withCVEs = packages.filter(p => p.vulnerabilities.length > 0);
		if (withCVEs.length > 0) {
			lines.push(locale === 'es' ? 'VULNERABILIDADES:' : 'VULNERABILITIES:');
			for (const pkg of withCVEs) {
				lines.push(`- ${pkg.name} ${pkg.installedVersion}: ${pkg.vulnerabilities.length} CVE(s) — ${locale === 'es' ? 'actualizar a' : 'update to'} ${pkg.latestVersion}`);
				for (const v of pkg.vulnerabilities) {
					lines.push(`  · ${v.id} [${v.severity}]: ${v.summary}`);
				}
			}
			lines.push('');
		}

		if (compatReport && compatReport.conflicts.length > 0) {
			lines.push(locale === 'es' ? 'CONFLICTOS DE DEPENDENCIAS:' : 'DEPENDENCY CONFLICTS:');
			for (const c of compatReport.conflicts) {
				lines.push(`- ${c.packageName} ${c.installedVersion}: ${c.recommendation}`);
			}
			lines.push('');
		}

		if (compatReport && compatReport.safeUpdates.length > 0) {
			lines.push(locale === 'es' ? 'ACTUALIZACIONES SEGURAS:' : 'SAFE UPDATES:');
			for (const u of compatReport.safeUpdates) {
				lines.push(`- ${u.packageName}: ${u.currentVersion} → ${u.recommendedVersion} (${u.reason})`);
			}
			lines.push('');
		}
	}

	if (locale === 'es') {
		lines.push('Por favor:');
		lines.push('1. Actualiza los archivos de dependencias aplicando primero las correcciones de CVEs y conflictos, luego las actualizaciones seguras.');
		lines.push('2. Explica brevemente cada cambio que hagas y por qué.');
		lines.push('3. Si alguna actualización puede introducir breaking changes, avísame antes de aplicarla.');
	} else {
		lines.push('Please:');
		lines.push('1. Update the dependency files applying CVE fixes and conflict resolutions first, then safe updates.');
		lines.push('2. Briefly explain each change and why.');
		lines.push('3. If any update may introduce breaking changes, warn me before applying it.');
	}

	return lines.join('\n');
}

// ─── Punto de entrada principal ───────────────────────────────────────────────

function getRelativePath(filePath: string): string {
	const workspaceFolders = (globalThis as any).__vscode_workspace_folders as string[] | undefined;
	const normalized = filePath.replace(/\\/g, '/');
	const parts = normalized.split('/');
	if (parts.length >= 2) {
		const last = parts[parts.length - 1];
		const parent = parts[parts.length - 2];
		const rootLikeFolders = new Set(['src', 'lib', 'app', 'packages', 'apps', 'services', 'modules']);
		return rootLikeFolders.has(parent) ? `${parent}/${last}` : `${parent}/${last}`;
	}
	return parts[parts.length - 1] ?? filePath;
}

export function getWebviewContent(results: ScanResult[], license: LicenseStatus): string {
	const locale = getLocale();
	const isPro = license.active;

	// Subtítulo dinámico según los archivos escaneados
	const subtitleItems = results.map(r => {
		const parts = r.filePath.replace(/\\\\/g, '/').split('/');
		const display = parts.length >= 2
			? parts.slice(-2).join('/')
			: (parts[parts.length - 1] ?? '');
		return `${ECOSYSTEM_ICONS[r.ecosystem]} ${display}`;
	});

	const SUBTITLE_COLLAPSE_THRESHOLD = 3;
	const subtitle = subtitleItems.length <= SUBTITLE_COLLAPSE_THRESHOLD
		? subtitleItems.join(' · ')
		: '__COLLAPSIBLE__';

	// Totales globales para el summary header
	const allPackages = results.flatMap(r => r.packages);
	const okCount      = allPackages.filter(p => p.upToDate && p.vulnerabilities.length === 0).length;
	const outdatedCount = allPackages.filter(p => !p.upToDate).length;
	const vulnCount    = allPackages.filter(p => p.vulnerabilities.length > 0).length;

	const licenceBadge = isPro
		? `<span class="license-badge pro">${license.isAdmin ? '👑 Admin' : '⚡ Pro'}</span>`
		: `<span class="license-badge free">Free — <a href="command:scanreq.activateLicense" style="color:#b899ee;">Activar Pro</a> · <a href="https://scanreq.com/recover" style="color:var(--vscode-descriptionForeground);font-size:11px;">${locale === 'es' ? '¿Perdiste tu token?' : 'Lost your token?'}</a></span>`;

	// El prompt se codifica en Base64 para evitar cualquier problema de inyección
	// en atributos HTML, scripts inline o template literals del webview de VS Code.
	const aiPromptB64 = isPro
		? Buffer.from(buildAIPrompt(results, locale), 'utf8').toString('base64')
		: '';

	const copyButtonHtml = isPro ? `
		<button class="copy-prompt-btn" id="copyPromptBtn" onclick="copyPrompt()">
			${locale === 'es' ? '🤖 Copiar prompt para IA' : '🤖 Copy AI prompt'}
		</button>
		<span class="copy-feedback" id="copyFeedback">
			${locale === 'es' ? '✓ Copiado al portapapeles' : '✓ Copied to clipboard'}
		</span>
	` : '';

	const ecosystemSections = results.map(result => {
		const icon = ECOSYSTEM_ICONS[result.ecosystem];
		const tableHtml = generatePackageTable(result, isPro, locale);

		if (results.length === 1) {
			return tableHtml;
		}

		const parts = result.filePath.replace(/\\\\/g, '/').split('/');
		const fileDisplay = escapeHtml(parts.length >= 2 ? parts.slice(-2).join('/') : (parts[parts.length-1] ?? ''));

		return `
			<div class="ecosystem-section">
				<div class="ecosystem-header">
					<span class="ecosystem-icon">${icon}</span>
					<span class="ecosystem-name">${escapeHtml(result.ecosystem.charAt(0).toUpperCase() + result.ecosystem.slice(1))}</span>
					<span class="ecosystem-file">${fileDisplay}</span>
				</div>
				${tableHtml}
			</div>
		`;
	}).join('');

	return `<!DOCTYPE html>
	<html lang="${locale}">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src vscode-resource: https:; connect-src 'none';">
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
			.subtitle-collapsible { margin-bottom: 20px; }
			.subtitle-summary {
				color: var(--vscode-descriptionForeground); font-size: 12px;
				cursor: pointer; list-style: none; display: flex; align-items: center; gap: 6px;
				user-select: none;
			}
			.subtitle-summary::-webkit-details-marker { display: none; }
			.subtitle-summary::before { content: '▶'; font-size: 9px; transition: transform 0.15s; }
			.subtitle-collapsible[open] .subtitle-summary::before { transform: rotate(90deg); }
			.subtitle-toggle-hint { color: var(--vscode-textLink-foreground); font-size: 11px; }
			.subtitle-list { display: flex; flex-direction: column; gap: 3px; margin-top: 6px; padding-left: 14px; }
			.subtitle-item {
				color: var(--vscode-descriptionForeground); font-size: 11px;
			}
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
			.ecosystem-section { margin-bottom: 40px; padding-bottom: 8px; }
			.ecosystem-section + .ecosystem-section { border-top: 1px solid var(--vscode-panel-border); padding-top: 32px; }
			.ecosystem-header {
				display: flex; align-items: center; gap: 10px;
				margin-bottom: 16px;
			}
			.ecosystem-icon { font-size: 18px; }
			.ecosystem-name { font-size: 15px; font-weight: 700; }
			.ecosystem-file { font-size: 11px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); }
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
			.badge.ok         { background: rgba(40,167,69,0.15); color: #28a745; }
			.badge.outdated   { background: rgba(255,165,0,0.15); color: #ffa500; }
			.badge.approx     { background: rgba(255,165,0,0.1); color: #ffcc77; }
			.badge.vuln       { background: rgba(255,68,68,0.15); color: #ff4444; }
			.badge.safe       { background: rgba(40,167,69,0.15); color: #28a745; }
			.badge.unknown    { background: rgba(147,112,219,0.15); color: #9370db; font-style: italic; }
			/* Fix #3: badge naranja explícito para versiones no fijadas sin análisis CVE */
			.badge.unverified { background: rgba(255,140,0,0.15); color: #ff8c00; border: 1px solid rgba(255,140,0,0.3); cursor: help; }
			.badge.major   { background: rgba(255,100,50,0.15); color: #ff6432; border: 1px solid rgba(255,100,50,0.3); margin-left: 6px; font-size: 10px; }
			.phase-header {
				display: flex; align-items: baseline; gap: 10px;
				margin: 16px 0 6px 0; padding: 8px 12px;
				border-radius: 6px; border-left: 3px solid;
			}
			.phase-low    { background: rgba(40,167,69,0.08); border-color: #28a745; }
			.phase-medium { background: rgba(255,165,0,0.08); border-color: #ffa500; }
			.phase-high      { background: rgba(255,100,50,0.08); border-color: #ff6432; }
			.phase-unpatched { background: rgba(180,0,0,0.1);        border-color: #cc2222; }
			.phase-label  { font-size: 12px; font-weight: 700; color: var(--vscode-foreground); }
			.phase-note   { font-size: 11px; color: var(--vscode-descriptionForeground); }
			.tool-detected {
				display: inline-block; font-size: 9px; font-weight: 700;
				background: rgba(147,112,219,0.2); color: #b899ee;
				border-radius: 3px; padding: 1px 4px; margin-left: 4px;
				vertical-align: middle; letter-spacing: 0.03em;
			}
			.vuln-detail { margin-top: 6px; font-size: 11px; }
			.vuln-id { font-weight: 600; margin-right: 6px; }
			.vuln-summary { color: var(--vscode-descriptionForeground); }
			.recommendation { color: #5fcc7f; font-size: 12px; }
			.insights { display: flex; flex-direction: column; gap: 10px; }
			.compat-section { margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.06); }
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
			.major-note {
				margin-top: 24px; padding: 10px 16px;
				background: rgba(255,100,50,0.08); border-left: 3px solid #ff6432;
				border-radius: 6px; font-size: 11px; color: #ff9070; line-height: 1.6;
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
		${subtitle === '__COLLAPSIBLE__' ? `
		<details class="subtitle-collapsible">
			<summary class="subtitle-summary">
				${subtitleItems.length} ${locale === 'es' ? 'archivos escaneados' : 'files scanned'}
				<span class="subtitle-toggle-hint">(click para ver)</span>
			</summary>
			<div class="subtitle-list">
				${subtitleItems.map(item => `<span class="subtitle-item">${item}</span>`).join('')}
			</div>
		</details>
		` : `<div class="subtitle">${subtitle}</div>`}
		<div class="summary">
			<div class="summary-card ok">✓ ${okCount} ${t('upToDate')}</div>
			<div class="summary-card outdated">↑ ${outdatedCount} ${t('outdated')}</div>
			<div class="summary-card vuln">⚠ ${vulnCount} ${t('withCVEs')}</div>
		</div>
		${ecosystemSections}
		${isPro ? `<div class="major-note">
			${locale === 'es'
				? '⚠ Los badges <strong>Major</strong> indican un salto de versión mayor. Estos suelen incluir cambios incompatibles con versiones anteriores. Revisa el changelog antes de actualizar.'
				: '⚠ <strong>Major</strong> badges indicate a major version jump. These often include breaking changes. Review the changelog before updating.'
			}
		</div>` : ''}
		<div class="footer">
			ScanReq · <a href="https://scanreq.com" style="color:inherit;">scanreq.com</a>
			${isPro ? ` · ${locale === 'es' ? 'Plan Pro activo' : 'Pro plan active'}` : ` · <a href="https://scanreq.com/recover" style="color:inherit;">${locale === 'es' ? '¿Perdiste tu token?' : 'Lost your token?'}</a>`}
		</div>
		<script>
			// Fix #11: el prompt se guarda en una variable JS en memoria (closure),
			// NO en un data-attribute del DOM. Así no es accesible vía
			// document.getElementById().dataset desde una posible inyección XSS.
			(function () {
				${isPro ? `const _b64 = ${JSON.stringify(aiPromptB64)};` : 'const _b64 = "";'}

				window.copyPrompt = function copyPrompt() {
					if (!_b64) { return; }
					const aiPrompt = new TextDecoder().decode(
						Uint8Array.from(atob(_b64), c => c.charCodeAt(0))
					);
					const showFeedback = function () {
						const btn      = document.getElementById('copyPromptBtn');
						const feedback = document.getElementById('copyFeedback');
						if (btn)      { btn.style.opacity = '0.6'; }
						if (feedback) { feedback.classList.add('visible'); }
						setTimeout(function () {
							if (btn)      { btn.style.opacity = '1'; }
							if (feedback) { feedback.classList.remove('visible'); }
						}, 2000);
					};
					if (navigator.clipboard && navigator.clipboard.writeText) {
						navigator.clipboard.writeText(aiPrompt).then(showFeedback).catch(function () {
							const ta = document.createElement('textarea');
							ta.value = aiPrompt;
							ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
							document.body.appendChild(ta);
							ta.select();
							document.execCommand('copy');
							document.body.removeChild(ta);
							showFeedback();
						});
					} else {
						const ta = document.createElement('textarea');
						ta.value = aiPrompt;
						ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
						document.body.appendChild(ta);
						ta.select();
						document.execCommand('copy');
						document.body.removeChild(ta);
						showFeedback();
					}
				};
			})();
		</script>
	</body>
	</html>`;
}

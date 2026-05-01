import * as vscode from 'vscode';
import { ScanResult } from './ecosystems/types';
import { t } from './i18n';

export function updateStatusBar(statusBar: vscode.StatusBarItem, results: ScanResult[]): void {
	// Aplanar todos los paquetes de todos los ecosistemas
	const allPackages = results.flatMap(r => r.packages);

	if (allPackages.length === 0) {
		statusBar.hide();
		return;
	}

	const hasCVEs = allPackages.some(p => p.vulnerabilities.length > 0);
	const hasOutdated = allPackages.some(p => !p.upToDate);

	if (hasCVEs) {
		statusBar.text = t('statusCVEs');
		statusBar.tooltip = t('statusTooltipCVEs');
		statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
	} else if (hasOutdated) {
		statusBar.text = t('statusOutdated');
		statusBar.tooltip = t('statusTooltipOutdated');
		statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
	} else {
		statusBar.text = t('statusOk');
		statusBar.tooltip = t('statusTooltipOk');
		statusBar.backgroundColor = undefined;
	}

	statusBar.show();
}

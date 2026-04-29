import * as vscode from 'vscode';
import { PackageInfo } from './pypi';
import { t } from './i18n';

export function updateStatusBar(statusBar: vscode.StatusBarItem, packages: PackageInfo[]): void {
	const hasCVEs = packages.some(p => p.vulnerabilities.length > 0);
	const hasOutdated = packages.some(p => !p.upToDate);

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

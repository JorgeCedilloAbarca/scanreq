import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { t } from './i18n';
import { readFileWithEncoding, parseRequirements } from './parser';
import { checkPyPI } from './pypi';
import { updateStatusBar } from './statusbar';
import { getWebviewContent } from './webview';
import { getLicenseStatus, activateLicense, deactivateLicense } from './license';
import { checkPipAvailability } from './pip';
import { runCompatibilityAnalysis } from './compatibility';

export function activate(context: vscode.ExtensionContext) {
	console.log('ScanReq is now active!');

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBar.command = 'scanreq.scan';
	context.subscriptions.push(statusBar);

	const runScan = async (autoTriggered = false) => {
		const config = vscode.workspace.getConfiguration('scanreq');
		const autoOpenPanel = config.get<boolean>('autoOpenPanel', false);
		const showNotification = config.get<boolean>('showNotification', true);

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) { return; }

		const reqPath = path.join(workspaceFolders[0].uri.fsPath, 'requirements.txt');
		if (!fs.existsSync(reqPath)) {
			statusBar.hide();
			return;
		}

		const license = getLicenseStatus(context);
		const isPro = license.active;

		const content = readFileWithEncoding(reqPath);
		const packages = parseRequirements(content);

		if (showNotification) {
			vscode.window.showInformationMessage(
				`${t('analyzing')} ${packages.length} ${t('analyzingPackages')}`
			);
		}

		const results = await Promise.all(
			packages.map(pkg => checkPyPI(pkg.name, pkg.version, pkg.exactVersion, isPro))
		);

		// Análisis de compatibilidad — solo Pro
		let compatReport = null;
		if (isPro) {
			const pip = await checkPipAvailability();
			compatReport = await runCompatibilityAnalysis(results, !pip.available);
		}

		updateStatusBar(statusBar, results);

		if (!autoTriggered || autoOpenPanel) {
			const panel = vscode.window.createWebviewPanel(
				'scanreq',
				'ScanReq',
				vscode.ViewColumn.One,
				{ enableScripts: true, enableFindWidget: true }
			);
			panel.webview.html = getWebviewContent(results, license, compatReport);
		}
	};

	// Comando principal — escanear
	context.subscriptions.push(
		vscode.commands.registerCommand('scanreq.scan', () => runScan(false))
	);

	// Comando — activar licencia Pro
	context.subscriptions.push(
		vscode.commands.registerCommand('scanreq.activateLicense', async () => {
			const token = await vscode.window.showInputBox({
				title: 'ScanReq — Activar Plan Pro',
				prompt: 'Introduce tu token de licencia',
				placeHolder: 'SCANREQ-PRO-XXXX-XXXX-XXXX',
				ignoreFocusOut: true,
				password: false
			});
			if (!token) { return; }

			const result = await activateLicense(context, token);
			if (result.success) {
				vscode.window.showInformationMessage(`ScanReq ✓ ${result.message}`);
				runScan(false); // re-escanear con Pro activo
			} else {
				vscode.window.showErrorMessage(`ScanReq: ${result.message}`);
			}
		})
	);

	// Comando — desactivar licencia
	context.subscriptions.push(
		vscode.commands.registerCommand('scanreq.deactivateLicense', async () => {
			const confirm = await vscode.window.showWarningMessage(
				'¿Desactivar el Plan Pro de ScanReq? Perderás acceso a las funciones avanzadas.',
				'Desactivar',
				'Cancelar'
			);
			if (confirm !== 'Desactivar') { return; }
			await deactivateLicense(context);
			vscode.window.showInformationMessage('ScanReq: Plan Pro desactivado.');
			runScan(false);
		})
	);

	// Watcher
	const watcher = vscode.workspace.createFileSystemWatcher('**/requirements.txt');
	watcher.onDidChange(() => runScan(true));
	watcher.onDidCreate(() => runScan(true));
	context.subscriptions.push(watcher);

	// Scan inicial
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders) {
		const reqPath = path.join(workspaceFolders[0].uri.fsPath, 'requirements.txt');
		if (fs.existsSync(reqPath)) {
			runScan(true);
		}
	}
}

export function deactivate() {}
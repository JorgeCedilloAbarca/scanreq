import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { t } from './i18n';
import { ScanResult } from './ecosystems/types';
import { getAdapterForFile, getAllWatchPatterns } from './ecosystems/registry';
import { updateStatusBar } from './statusbar';
import { getWebviewContent } from './webview';
import { getLicenseStatus, activateLicense, deactivateLicense } from './license';

export function activate(context: vscode.ExtensionContext) {
	console.log('ScanReq is now active!');

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBar.command = 'scanreq.scan';
	context.subscriptions.push(statusBar);

	// Referencia al panel activo — se reutiliza en lugar de crear uno nuevo cada vez
	let activePanel: vscode.WebviewPanel | undefined;

	const runScan = async (autoTriggered = false) => {
		const config = vscode.workspace.getConfiguration('scanreq');
		const autoOpenPanel = config.get<boolean>('autoOpenPanel', false);
		const showNotification = config.get<boolean>('showNotification', true);

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) { return; }

		const workspaceRoot = workspaceFolders[0].uri.fsPath;
		const license = getLicenseStatus(context);
		const isPro = license.active;

		// Detectar qué archivos de dependencias existen en el workspace
		const watchPatterns = getAllWatchPatterns();
		const foundFiles: Array<{ filePath: string; fileName: string }> = [];

		for (const pattern of watchPatterns) {
			const filePath = path.join(workspaceRoot, pattern);
			if (fs.existsSync(filePath)) {
				foundFiles.push({ filePath, fileName: pattern });
			}
		}

		if (foundFiles.length === 0) {
			statusBar.hide();
			return;
		}

		if (showNotification) {
			const ecosystemNames = foundFiles.map(f => f.fileName).join(', ');
			vscode.window.showInformationMessage(
				`${t('analyzing')} ${ecosystemNames}...`
			);
		}

		// Ejecutar el scan de cada ecosistema encontrado en paralelo
		const scanPromises = foundFiles.map(({ filePath, fileName }) => {
			const adapter = getAdapterForFile(fileName);
			if (!adapter) { return null; }
			return adapter.scan(filePath, isPro);
		}).filter(Boolean) as Promise<ScanResult>[];

		const results = await Promise.all(scanPromises);

		updateStatusBar(statusBar, results);

		if (!autoTriggered || autoOpenPanel) {
			if (activePanel) {
				// Reutilizar el panel existente — actualizarlo y traerlo al frente
				activePanel.webview.html = getWebviewContent(results, license);
				activePanel.reveal(vscode.ViewColumn.One, true);
			} else {
				// Crear panel nuevo
				activePanel = vscode.window.createWebviewPanel(
					'scanreq',
					'ScanReq',
					vscode.ViewColumn.One,
					{ enableScripts: true, enableFindWidget: true }
				);
				activePanel.webview.html = getWebviewContent(results, license);

				// Limpiar referencia cuando el usuario cierra el panel
				activePanel.onDidDispose(() => {
					activePanel = undefined;
				}, null, context.subscriptions);
			}
		} else if (activePanel) {
			// Auto-triggered y panel ya abierto — actualizar silenciosamente
			activePanel.webview.html = getWebviewContent(results, license);
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
				runScan(false);
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

	// Watcher — observa todos los archivos de dependencias registrados
	const watchGlob = `**/{${getAllWatchPatterns().join(',')}}`;
	const watcher = vscode.workspace.createFileSystemWatcher(watchGlob);
	watcher.onDidChange(() => runScan(true));
	watcher.onDidCreate(() => runScan(true));
	watcher.onDidDelete(() => runScan(true));
	context.subscriptions.push(watcher);

	// Scan inicial
	runScan(true);
}

export function deactivate() {}

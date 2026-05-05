import * as vscode from 'vscode';
import * as path from 'path';
import { t } from './i18n';
import { ScanResult } from './ecosystems/types';
import { getAdapterForFile, getAllWatchPatterns } from './ecosystems/registry';
import { updateStatusBar } from './statusbar';
import { getWebviewContent } from './webview';
import { getLicenseStatus, activateLicense, deactivateLicense } from './license';

// Directorios a excluir de la búsqueda
const EXCLUDE_GLOB = '{**/node_modules/**,**/.git/**,**/vendor/**,**/target/**,**/.build/**,**/dist/**,**/build/**,**/__pycache__/**,**/.venv/**,**/venv/**,**/env/**,**/.cargo/**}';

// Máximo de archivos a escanear por patrón
const MAX_FILES_PER_PATTERN = 20;

/**
 * Busca todos los archivos de dependencias en el workspace completo.
 * Soporta monorepos con múltiples archivos por ecosistema.
 */
async function findDependencyFiles(): Promise<Array<{ filePath: string; fileName: string }>> {
	const patterns = getAllWatchPatterns();
	const found: Array<{ filePath: string; fileName: string }> = [];
	const seenPaths = new Set<string>();

	await Promise.all(patterns.map(async (pattern) => {
		const uris = await vscode.workspace.findFiles(
			`**/${pattern}`,
			EXCLUDE_GLOB,
			MAX_FILES_PER_PATTERN
		);

		for (const uri of uris) {
			const filePath = uri.fsPath;
			if (!seenPaths.has(filePath)) {
				seenPaths.add(filePath);
				found.push({ filePath, fileName: pattern });
			}
		}
	}));

	// Ordenar: raíz primero, luego por profundidad, luego alfabético
	found.sort((a, b) => {
		const depthA = a.filePath.split(path.sep).length;
		const depthB = b.filePath.split(path.sep).length;
		if (depthA !== depthB) { return depthA - depthB; }
		return a.filePath.localeCompare(b.filePath);
	});

	return found;
}

export function activate(context: vscode.ExtensionContext) {
	console.log('ScanReq is now active!');

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBar.command = 'scanreq.scan';
	context.subscriptions.push(statusBar);

	let activePanel: vscode.WebviewPanel | undefined;
	let initialScanDone = false;

	const runScan = async (autoTriggered = false) => {
		const config = vscode.workspace.getConfiguration('scanreq');
		const autoOpenPanel    = config.get<boolean>('autoOpenPanel', false);
		const showNotification = config.get<boolean>('showNotification', true);

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) { return; }

		const license = getLicenseStatus(context);
		const isPro   = license.active;

		const foundFiles = await findDependencyFiles();

		if (foundFiles.length === 0) {
			statusBar.hide();
			return;
		}

		// Marcar que el scan inicial se completó al menos una vez
		initialScanDone = true;

		if (showNotification) {
			const ecosystemNames = [...new Set(foundFiles.map(f => f.fileName))].join(', ');
			vscode.window.showInformationMessage(
				`${t('analyzing')} ${ecosystemNames}...`
			);
		}

		const scanPromises = foundFiles.map(({ filePath, fileName }) => {
			const adapter = getAdapterForFile(fileName);
			if (!adapter) { return null; }
			return adapter.scan(filePath, isPro);
		}).filter(Boolean) as Promise<ScanResult>[];

		const results = await Promise.all(scanPromises);

		updateStatusBar(statusBar, results);

		if (!autoTriggered || autoOpenPanel) {
			if (activePanel) {
				activePanel.webview.html = getWebviewContent(results, license);
				activePanel.reveal(vscode.ViewColumn.One, true);
			} else {
				activePanel = vscode.window.createWebviewPanel(
					'scanreq',
					'ScanReq',
					vscode.ViewColumn.One,
					{ enableScripts: true, enableFindWidget: true }
				);
				activePanel.webview.html = getWebviewContent(results, license);

				activePanel.onDidDispose(() => {
					activePanel = undefined;
				}, null, context.subscriptions);
			}
		} else if (activePanel) {
			activePanel.webview.html = getWebviewContent(results, license);
		}
	};

	// Comando principal
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

	// Watcher — observa todos los archivos en cualquier subcarpeta
	// onDidCreate también actúa como fallback del scan inicial:
	// cuando Java Extension Pack termina de indexar (~30s), los archivos
	// se vuelven visibles y onDidCreate dispara para pom.xml/build.gradle,
	// lo que ejecuta runScan(true) automáticamente.
	const watchGlob = `**/{${getAllWatchPatterns().join(',')}}`;
	const watcher   = vscode.workspace.createFileSystemWatcher(watchGlob);

	watcher.onDidChange(() => runScan(true));
	watcher.onDidDelete(() => runScan(true));

	// onDidCreate: si el scan inicial no encontró archivos (workspace aún indexando),
	// este evento actuará de fallback cuando los archivos sean visibles para VS Code.
	watcher.onDidCreate(() => {
		if (!initialScanDone) {
			// Primera vez que aparece un archivo de dependencias — ejecutar scan inicial
			runScan(true);
		} else {
			// Archivo nuevo añadido al proyecto — rescanear normalmente
			runScan(true);
		}
	});

	context.subscriptions.push(watcher);

	// Scan inicial — intento inmediato.
	// Para proyectos Python/Node/Rust/Go/PHP/Ruby esto es suficiente.
	// Para proyectos Java con Extension Pack, el workspace puede no estar
	// indexado aún — el watcher onDidCreate actuará como fallback automático.
	runScan(true);
}

export function deactivate() {}

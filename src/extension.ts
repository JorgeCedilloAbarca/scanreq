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

	const runScan = async (autoTriggered = false) => {
		const config = vscode.workspace.getConfiguration('scanreq');
		const autoOpenPanel  = config.get<boolean>('autoOpenPanel', false);
		const showNotification = config.get<boolean>('showNotification', true);

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) { return; }

		const license = getLicenseStatus(context);
		const isPro   = license.active;

		// Buscar archivos de dependencias en todo el workspace (monorepo support)
		const foundFiles = await findDependencyFiles();

		if (foundFiles.length === 0) {
			statusBar.hide();
			return;
		}

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
	const watchGlob = `**/{${getAllWatchPatterns().join(',')}}`;
	const watcher = vscode.workspace.createFileSystemWatcher(watchGlob);
	watcher.onDidChange(() => runScan(true));
	watcher.onDidCreate(() => runScan(true));
	watcher.onDidDelete(() => runScan(true));
	context.subscriptions.push(watcher);

	// Scan inicial con retry.
	// VS Code puede tardar en indexar el workspace al abrirlo (especialmente proyectos
	// Java/Maven con muchos archivos). findFiles() puede devolver 0 resultados si se
	// llama demasiado pronto. Esperamos a que el workspace esté listo y reintentamos
	// una vez si el primer intento no encuentra archivos.
	const initialScan = async () => {
		// Primer intento inmediato
		const firstFound = await findDependencyFiles();
		if (firstFound.length > 0) {
			runScan(true);
			return;
		}

		// Si no encontró nada, esperar a que VS Code termine de indexar y reintentar
		// onDidChangeWorkspaceFolders no ayuda aquí — usamos un delay razonable
		setTimeout(async () => {
			const retryFound = await findDependencyFiles();
			if (retryFound.length > 0) {
				runScan(true);
			}
			// Si sigue sin encontrar nada, el proyecto no tiene archivos soportados
		}, 3000);
	};

	initialScan();
}

export function deactivate() {}

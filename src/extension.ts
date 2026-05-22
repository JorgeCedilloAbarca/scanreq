import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { t } from './i18n';
import { ScanResult } from './ecosystems/types';
import { getAdapterForFile, getAllWatchPatterns } from './ecosystems/registry';
import { updateStatusBar } from './statusbar';
import { getWebviewContent } from './webview';
import { getLicenseStatus, activateLicense, deactivateLicense, revalidateLicenseIfNeeded } from './license';

const EXCLUDE_DIRS = new Set([
	'node_modules', '.git', 'vendor', 'target', '.build',
	'dist', 'build', '__pycache__', '.venv', 'venv', 'env',
	'.cargo', '.mvn', '.idea', '.vscode', 'out', 'bin', 'obj',
	'.gradle', '.m2', 'gradle', '.dart_tool', 'Pods',
]);

const MAX_DEPTH             = 5;
const MAX_FILES_PER_PATTERN = 20;

/**
 * Búsqueda síncrona y rápida de archivos de dependencias.
 * No usa setImmediate — el walk es lo suficientemente rápido
 * cuando excluimos los directorios pesados correctamente.
 */
function findDependencyFiles(workspaceRoot: string): Array<{ filePath: string; fileName: string }> {
	const patterns    = getAllWatchPatterns();
	const patternSet  = new Set(patterns);
	const found: Array<{ filePath: string; fileName: string }> = [];
	const countPerPattern = new Map<string, number>();

	function walk(dir: string, depth: number): void {
		if (depth > MAX_DEPTH) { return; }

		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			// Ignorar symlinks — evita path traversal hacia fuera del workspace
			if (entry.isSymbolicLink()) { continue; }
			if (entry.isDirectory()) {
				if (EXCLUDE_DIRS.has(entry.name) || entry.name.startsWith('.')) { continue; }
				walk(path.join(dir, entry.name), depth + 1);
			} else if (entry.isFile()) {
				if (!patternSet.has(entry.name)) { continue; }
				const count = countPerPattern.get(entry.name) ?? 0;
				if (count >= MAX_FILES_PER_PATTERN) { continue; }
				countPerPattern.set(entry.name, count + 1);
				found.push({ filePath: path.join(dir, entry.name), fileName: entry.name });
			}
		}
	}

	walk(workspaceRoot, 0);

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
	let scanInProgress = false;

	// Fix R3: timer para debounce del watcher — se limpia en deactivate()
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	const getWorkspaceRoot = (): string | null => {
		const folders = vscode.workspace.workspaceFolders;
		return folders ? folders[0].uri.fsPath : null;
	};

	const showScanning = () => {
		statusBar.text             = '$(sync~spin) ScanReq';
		statusBar.tooltip          = t('analyzing') + '...';
		statusBar.backgroundColor  = undefined;
		statusBar.show();
	};

	const runScan = async (autoTriggered = false) => {
		if (scanInProgress) { return; }
		scanInProgress = true;

		try {
			const config           = vscode.workspace.getConfiguration('scanreq');
			const autoOpenPanel    = config.get<boolean>('autoOpenPanel', false);
			const showNotification = config.get<boolean>('showNotification', true);

			const workspaceRoot = getWorkspaceRoot();
			if (!workspaceRoot) { return; }

			const license = getLicenseStatus(context);
			const isPro   = license.active;

			// Mostrar badge de progreso inmediatamente
			showScanning();

			// Buscar archivos — síncrono pero rápido gracias a EXCLUDE_DIRS
			const foundFiles = findDependencyFiles(workspaceRoot);

			if (foundFiles.length === 0) {
				statusBar.hide();
				return;
			}

			if (showNotification) {
				const ecosystemNames = [...new Set(foundFiles.map(f => f.fileName))].join(', ');
				vscode.window.showInformationMessage(`${t('analyzing')} ${ecosystemNames}...`);
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
						'scanreq', 'ScanReq', vscode.ViewColumn.One,
						{ enableScripts: true, enableFindWidget: true }
					);
					activePanel.webview.html = getWebviewContent(results, license);
					// Escuchar mensajes del webview (p.ej. botón "Activar Pro")
					activePanel.webview.onDidReceiveMessage(
						async (message: { command: string }) => {
							if (message.command === 'activateLicense') {
								await vscode.commands.executeCommand('scanreq.activateLicense');
							}
						},
						null,
						context.subscriptions
					);
					activePanel.onDidDispose(
						() => { activePanel = undefined; },
						null,
						context.subscriptions
					);
				}
			} else if (activePanel) {
				activePanel.webview.html = getWebviewContent(results, license);
			}
		} finally {
			scanInProgress = false;
		}
	};

	// Comandos
	context.subscriptions.push(
		vscode.commands.registerCommand('scanreq.scan', () => runScan(false))
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('scanreq.activateLicense', async () => {
			// Fix U1: mensajes bilingües via i18n
			const token = await vscode.window.showInputBox({
				title: t('licenseActivateTitle'),
				prompt: t('licenseActivatePrompt'),
				placeHolder: 'SCANREQ-PRO-XXXX-XXXX-XXXX',
				ignoreFocusOut: true,
				password: true
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

	context.subscriptions.push(
		vscode.commands.registerCommand('scanreq.deactivateLicense', async () => {
			// Fix U1: mensajes bilingües via i18n
			const confirm = await vscode.window.showWarningMessage(
				t('licenseDeactivateConfirm'),
				t('licenseDeactivateBtn'), t('licenseCancelBtn')
			);
			if (confirm !== t('licenseDeactivateBtn')) { return; }
			await deactivateLicense(context);
			vscode.window.showInformationMessage(t('licenseDeactivated'));
			runScan(false);
		})
	);

	// Fix R3: Watcher con debounce de 2 segundos.
	// Sin debounce, un npm install dispara múltiples scans en ráfaga porque
	// modifica package.json + package-lock.json + archivos en node_modules.
	// El primer scan se ejecuta con archivos a medio instalar, dando resultados
	// incorrectos temporales. Con debounce, esperamos a que la actividad termine.
	const watchGlob = `**/{${getAllWatchPatterns().join(',')}}`;
	const watcher   = vscode.workspace.createFileSystemWatcher(watchGlob);
	const debouncedScan = () => {
		if (debounceTimer) { clearTimeout(debounceTimer); }
		debounceTimer = setTimeout(() => runScan(true), 2000);
	};
	watcher.onDidChange(debouncedScan);
	watcher.onDidCreate(debouncedScan);
	watcher.onDidDelete(debouncedScan);
	context.subscriptions.push(watcher);

	// Fix U4: comentario actualizado — revalidación cada 24 horas, no 7 días
	// Revalidación periódica silenciosa (cada 24 horas)
	// No bloquea el arranque — se ejecuta en background
	revalidateLicenseIfNeeded(context).then(() => {
		// Relanzar scan si el estado de licencia cambió durante la revalidación
		runScan(true);
	});
}

export function deactivate() {}

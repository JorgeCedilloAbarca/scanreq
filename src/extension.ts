import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { t } from './i18n';
import { readFileWithEncoding, parseRequirements } from './parser';
import { checkPyPI } from './pypi';
import { updateStatusBar } from './statusbar';
import { getWebviewContent } from './webview';

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
		if (!workspaceFolders) {
			return;
		}

		const reqPath = path.join(workspaceFolders[0].uri.fsPath, 'requirements.txt');
		if (!fs.existsSync(reqPath)) {
			statusBar.hide();
			return;
		}

		const content = readFileWithEncoding(reqPath);
		const packages = parseRequirements(content);

		if (showNotification) {
			vscode.window.showInformationMessage(`${t('analyzing')} ${packages.length} ${t('analyzingPackages')}`);
		}

		const results = await Promise.all(
			packages.map(pkg => checkPyPI(pkg.name, pkg.version, pkg.exactVersion))
		);

		updateStatusBar(statusBar, results);

		if (!autoTriggered || autoOpenPanel) {
			const panel = vscode.window.createWebviewPanel(
				'scanreq',
				'ScanReq',
				vscode.ViewColumn.One,
				{ enableScripts: true, enableFindWidget: true }
			);
			panel.webview.html = getWebviewContent(results);
		}
	};

	const disposable = vscode.commands.registerCommand('scanreq.scan', () => runScan(false));

	context.subscriptions.push(disposable);

	const watcher = vscode.workspace.createFileSystemWatcher('**/requirements.txt');
	watcher.onDidChange(() => runScan(true));
	watcher.onDidCreate(() => runScan(true));
	context.subscriptions.push(watcher);

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders) {
		const reqPath = path.join(workspaceFolders[0].uri.fsPath, 'requirements.txt');
		if (fs.existsSync(reqPath)) {
			runScan(true);
		}
	}
}

export function deactivate() {}

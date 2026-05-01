import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Detecta la versión instalada de un paquete npm leyendo directamente
 * node_modules/{package}/package.json del workspace actual.
 *
 * No requiere ejecutar `npm` — funciona aunque npm no esté en el PATH,
 * y es instantáneo porque es solo lectura de disco.
 *
 * Devuelve null si node_modules no existe o el paquete no está instalado.
 */
export async function getInstalledVersionFromNodeModules(
	packageName: string
): Promise<string | null> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) { return null; }

	const workspaceRoot = workspaceFolders[0].uri.fsPath;

	// Soporte para scoped packages como @types/node → node_modules/@types/node/package.json
	const pkgJsonPath = path.join(workspaceRoot, 'node_modules', packageName, 'package.json');

	try {
		if (!fs.existsSync(pkgJsonPath)) { return null; }
		const content = fs.readFileSync(pkgJsonPath, 'utf8');
		const json = JSON.parse(content);
		return typeof json.version === 'string' ? json.version : null;
	} catch {
		return null;
	}
}

/**
 * Verifica si node_modules existe en el workspace.
 * Útil para mostrar aviso si no existe (dependencias no instaladas).
 */
export function checkNodeModulesAvailability(): boolean {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) { return false; }

	const nodeModulesPath = path.join(workspaceFolders[0].uri.fsPath, 'node_modules');
	return fs.existsSync(nodeModulesPath);
}

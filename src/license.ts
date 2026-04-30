import * as vscode from 'vscode';

const LICENSE_KEY = 'scanreq.licenseToken';
const ADMIN_TOKEN = 'SCANREQ-ADMIN-2025-MASTER';
const BACKEND_URL = 'https://scanreq.com/api/validate-license';

export interface LicenseStatus {
	active: boolean;
	token: string | null;
	isAdmin: boolean;
}

export function getLicenseStatus(context: vscode.ExtensionContext): LicenseStatus {
	const token = context.globalState.get<string>(LICENSE_KEY) ?? null;
	if (!token) {
		return { active: false, token: null, isAdmin: false };
	}
	if (token === ADMIN_TOKEN) {
		return { active: true, token, isAdmin: true };
	}
	// Token guardado pero aún no revalidado en esta sesión — se considera activo
	// La validación real ocurre en activateLicense()
	return { active: true, token, isAdmin: false };
}

export async function activateLicense(
	context: vscode.ExtensionContext,
	token: string
): Promise<{ success: boolean; message: string }> {
	const trimmed = token.trim();

	if (!trimmed) {
		return { success: false, message: 'El token no puede estar vacío.' };
	}

	// Token ADMIN — validación local, nunca llama al backend
	if (trimmed === ADMIN_TOKEN) {
		await context.globalState.update(LICENSE_KEY, trimmed);
		return { success: true, message: 'Licencia Admin activada correctamente.' };
	}

	// Validación contra backend
	try {
		const response = await fetch(BACKEND_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: trimmed })
		});

		if (response.ok) {
			const data = await response.json() as any;
			if (data.valid) {
				await context.globalState.update(LICENSE_KEY, trimmed);
				return { success: true, message: 'Licencia Pro activada correctamente. ¡Bienvenido!' };
			} else {
				return { success: false, message: data.message ?? 'Token inválido o ya usado.' };
			}
		} else if (response.status === 404) {
			return { success: false, message: 'Token no encontrado. Revisa que lo hayas copiado correctamente.' };
		} else {
			return { success: false, message: `Error del servidor (${response.status}). Inténtalo de nuevo.` };
		}
	} catch {
		return {
			success: false,
			message: 'No se pudo conectar con el servidor de licencias. Comprueba tu conexión a Internet.'
		};
	}
}

export async function deactivateLicense(context: vscode.ExtensionContext): Promise<void> {
	await context.globalState.update(LICENSE_KEY, undefined);
}
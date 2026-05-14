import * as vscode from 'vscode';

const LICENSE_KEY  = 'scanreq.licenseToken';
const BACKEND_URL  = 'https://scanreq.com/api/validate-license';

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
	// Token guardado pero aún no revalidado en esta sesión — se considera activo.
	// La validación real ocurre en activateLicense().
	// isAdmin se determina únicamente por el backend (campo data.isAdmin).
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

	// Validación contra backend — todos los tokens pasan por aquí, sin excepción.
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
				// El backend puede devolver data.isAdmin = true para tokens especiales.
				// Se guarda en globalState para usarlo en la sesión actual.
				await context.globalState.update('scanreq.isAdmin', data.isAdmin === true);
				const welcome = data.isAdmin
					? 'Licencia Admin activada correctamente.'
					: 'Licencia Pro activada correctamente. ¡Bienvenido!';
				return { success: true, message: welcome };
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
	await context.globalState.update('scanreq.isAdmin', undefined);
}

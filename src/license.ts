import * as vscode from 'vscode';

const LICENSE_KEY        = 'scanreq.licenseToken';
const IS_ADMIN_KEY       = 'scanreq.isAdmin';
const LAST_VALIDATED_KEY = 'scanreq.lastValidated';
const BACKEND_URL        = 'https://scanreq.com/api/validate-license';

// NOTA DE SEGURIDAD: VS Code almacena globalState en texto plano en el perfil del usuario
// (~/.vscode/globalStorage/trustdev.scanreq/ en macOS/Linux,
//  %APPDATA%\Code\User\globalStorage\trustdev.scanreq\ en Windows).
// No actives el Plan Pro en máquinas compartidas, CI/CD, o entornos multi-usuario
// donde otros procesos puedan acceder al filesystem del perfil de VS Code.

// Revalidar cada 24 horas (en milisegundos).
// 7 días era demasiado: un token robado o un chargeback mantenían acceso Pro
// una semana entera. 24 h es un compromiso razonable entre UX offline y seguridad.
const REVALIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface LicenseStatus {
	active: boolean;
	token: string | null;
	isAdmin: boolean;
}

export function getLicenseStatus(context: vscode.ExtensionContext): LicenseStatus {
	const token   = context.globalState.get<string>(LICENSE_KEY) ?? null;
	const isAdmin = context.globalState.get<boolean>(IS_ADMIN_KEY) ?? false;
	if (!token) {
		return { active: false, token: null, isAdmin: false };
	}
	return { active: true, token, isAdmin };
}

/**
 * Revalidación silenciosa en background.
 * Se llama al arrancar la extensión si han pasado más de 24 horas desde la última validación.
 * - Si el backend confirma el token → actualiza el timestamp, sin notificación.
 * - Si el backend rechaza el token → borra la licencia y notifica al usuario.
 * - Si no hay conexión → no hace nada, reintentará en el próximo arranque.
 */
export async function revalidateLicenseIfNeeded(
	context: vscode.ExtensionContext
): Promise<void> {
	const token = context.globalState.get<string>(LICENSE_KEY);
	if (!token) { return; }

	const lastValidated = context.globalState.get<number>(LAST_VALIDATED_KEY) ?? 0;
	const now = Date.now();

	if (now - lastValidated < REVALIDATION_INTERVAL_MS) { return; }

	// Han pasado más de 24 horas — revalidar silenciosamente
	try {
		const response = await fetch(BACKEND_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token })
		});

		if (!response.ok) {
			// Error de servidor (5xx) o red — no borrar el token, reintentar en el próximo arranque
			return;
		}

		const data = await response.json() as any;

		if (data.valid) {
			// Token sigue válido — actualizar timestamp e isAdmin
			await context.globalState.update(LAST_VALIDATED_KEY, now);
			await context.globalState.update(IS_ADMIN_KEY, data.isAdmin === true);
		} else {
			// Token revocado — borrar licencia y notificar
			await context.globalState.update(LICENSE_KEY, undefined);
			await context.globalState.update(IS_ADMIN_KEY, undefined);
			await context.globalState.update(LAST_VALIDATED_KEY, undefined);
			vscode.window.showWarningMessage(
				'ScanReq: Tu licencia Pro ha sido desactivada. Visita scanreq.com para más información.',
				'Recover token',
				'Ir a scanreq.com'
			).then(action => {
				if (action === 'Recover token') {
					vscode.env.openExternal(vscode.Uri.parse('https://scanreq.com/recover'));
				} else if (action === 'Ir a scanreq.com') {
					vscode.env.openExternal(vscode.Uri.parse('https://scanreq.com'));
				}
			});
		}
	} catch {
		// Sin conexión — no hacer nada, reintentar en el próximo arranque
	}
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
				await context.globalState.update(IS_ADMIN_KEY, data.isAdmin === true);
				// Registrar timestamp de activación como primera validación
				await context.globalState.update(LAST_VALIDATED_KEY, Date.now());
				const welcome = data.isAdmin === true
					? 'Licencia Admin activada correctamente.'
					: 'Licencia Pro activada correctamente. ¡Bienvenido!';
				return { success: true, message: welcome };
			} else {
				const msg = data.message ?? 'Token inválido o ya usado.';
				return {
					success: false,
					message: `${msg} ¿Perdiste tu token? Recupéralo en scanreq.com/recover`
				};
			}
		} else if (response.status === 404) {
			return {
				success: false,
				message: 'Token no encontrado. Revisa que lo hayas copiado correctamente. ¿Perdiste tu token? Recupéralo en scanreq.com/recover'
			};
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
	await context.globalState.update(IS_ADMIN_KEY, undefined);
	await context.globalState.update(LAST_VALIDATED_KEY, undefined);
}

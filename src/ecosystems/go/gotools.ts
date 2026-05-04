import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export interface GoAvailability {
	available: boolean;
	version: string | null;   // e.g. "1.22.0"
}

export interface GoModEdge {
	from: string;   // módulo que requiere → "github.com/gin-gonic/gin@v1.9.1"
	to: string;     // módulo requerido → "github.com/bytedance/sonic@v1.11.3"
}

let cachedGoAvailability: GoAvailability | undefined = undefined;

/**
 * Detecta si `go` está disponible en el PATH.
 * Resultado cacheado para el ciclo de vida de la extensión.
 */
export async function checkGoAvailability(): Promise<GoAvailability> {
	if (cachedGoAvailability !== undefined) {
		return cachedGoAvailability;
	}

	try {
		const { stdout } = await execFileAsync('go', ['version'], { timeout: 5000 });
		// stdout: "go version go1.22.0 linux/amd64"
		const match = stdout.match(/go(\d+\.\d+(?:\.\d+)?)/);
		cachedGoAvailability = {
			available: true,
			version: match ? match[1] : null,
		};
	} catch {
		cachedGoAvailability = { available: false, version: null };
	}

	return cachedGoAvailability;
}

/**
 * Ejecuta `go mod graph` en el directorio del go.mod y devuelve
 * la lista de aristas del grafo de dependencias.
 *
 * Formato de salida de `go mod graph`:
 *   github.com/myapp/myapp github.com/gin-gonic/gin@v1.9.1
 *   github.com/gin-gonic/gin@v1.9.1 github.com/bytedance/sonic@v1.11.3
 *   ...
 *
 * Cada línea es "from to" donde:
 *   - from: módulo raíz (sin @version) o dependencia con @version
 *   - to: dependencia con @version obligatorio
 */
export async function runGoModGraph(goModPath: string): Promise<GoModEdge[]> {
	const goAvailability = await checkGoAvailability();
	if (!goAvailability.available) {
		return [];
	}

	const cwd = path.dirname(goModPath);

	try {
		const { stdout } = await execFileAsync('go', ['mod', 'graph'], {
			cwd,
			timeout: 30000,    // go mod graph puede tardar si descarga módulos
		});

		const edges: GoModEdge[] = [];
		for (const rawLine of stdout.split('\n')) {
			const line = rawLine.trim();
			if (!line) { continue; }

			const parts = line.split(' ');
			if (parts.length !== 2) { continue; }

			edges.push({ from: parts[0], to: parts[1] });
		}

		return edges;
	} catch {
		return [];
	}
}

/**
 * Parsea un módulo@versión de la salida de go mod graph.
 * "github.com/gin-gonic/gin@v1.9.1" → { module: "github.com/gin-gonic/gin", version: "1.9.1" }
 * "github.com/myapp/myapp" → { module: "github.com/myapp/myapp", version: null }
 */
export function parseModuleRef(ref: string): { module: string; version: string | null } {
	const atIdx = ref.lastIndexOf('@');
	if (atIdx === -1) {
		return { module: ref, version: null };
	}
	const module  = ref.slice(0, atIdx);
	const rawVer  = ref.slice(atIdx + 1);
	const version = rawVer.startsWith('v') ? rawVer.slice(1) : rawVer;
	return { module, version };
}

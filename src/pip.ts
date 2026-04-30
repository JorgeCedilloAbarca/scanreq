import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface InstalledPackage {
	name: string;
	version: string;
}

export interface PipAvailability {
	available: boolean;
	command: string | null;
}

let cachedPipCommand: string | null | undefined = undefined; // undefined = no comprobado todavía

async function findPipCommand(): Promise<string | null> {
	if (cachedPipCommand !== undefined) {
		return cachedPipCommand;
	}
	for (const cmd of ['pip', 'pip3', 'python -m pip', 'python3 -m pip']) {
		try {
			const parts = cmd.split(' ');
			const bin = parts[0];
			const args = parts.slice(1).concat(['--version']);
			await execFileAsync(bin, args, { timeout: 5000 });
			cachedPipCommand = cmd;
			return cmd;
		} catch {
			continue;
		}
	}
	cachedPipCommand = null;
	return null;
}

export async function checkPipAvailability(): Promise<PipAvailability> {
	const cmd = await findPipCommand();
	return { available: cmd !== null, command: cmd };
}

export async function getInstalledVersion(packageName: string): Promise<string | null> {
	const cmd = await findPipCommand();
	if (!cmd) {
		return null;
	}

	// pip show no acepta extras como uvicorn[standard] — limpiamos
	const cleanName = packageName.replace(/\[.*?\]/g, '').trim();

	try {
		const parts = cmd.split(' ');
		const bin = parts[0];
		const baseArgs = parts.slice(1);
		const args = [...baseArgs, 'show', cleanName];

		const { stdout } = await execFileAsync(bin, args, { timeout: 10000 });

		for (const line of stdout.split('\n')) {
			if (line.toLowerCase().startsWith('version:')) {
				return line.split(':')[1].trim();
			}
		}
		return null;
	} catch {
		return null;
	}
}

export async function getAllInstalledPackages(): Promise<InstalledPackage[]> {
	const cmd = await findPipCommand();
	if (!cmd) {
		return [];
	}

	try {
		const parts = cmd.split(' ');
		const bin = parts[0];
		const baseArgs = parts.slice(1);
		const args = [...baseArgs, 'list', '--format=json'];

		const { stdout } = await execFileAsync(bin, args, { timeout: 15000 });
		const parsed = JSON.parse(stdout) as Array<{ name: string; version: string }>;
		return parsed.map(p => ({ name: p.name.toLowerCase(), version: p.version }));
	} catch {
		return [];
	}
}
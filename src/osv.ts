import { Vulnerability, OsvEcosystem } from './ecosystems/types';

export async function checkCVEs(
	packageName: string,
	version: string,
	ecosystem: OsvEcosystem
): Promise<Vulnerability[]> {
	try {
		const response = await fetch('https://api.osv.dev/v1/query', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				version: version,
				package: { name: packageName, ecosystem }
			})
		});
		const data = await response.json() as any;
		if (!data.vulns) {
			return [];
		}
		return data.vulns.slice(0, 3).map((v: any) => ({
			id: v.id,
			summary: v.summary || 'No description',
			severity: v.database_specific?.severity || 'UNKNOWN'
		}));
	} catch {
		return [];
	}
}

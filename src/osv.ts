export interface Vulnerability {
	id: string;
	summary: string;
	severity: string;
}

export async function checkCVEs(packageName: string, version: string): Promise<Vulnerability[]> {
	try {
		const response = await fetch('https://api.osv.dev/v1/query', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				version: version,
				package: { name: packageName, ecosystem: 'PyPI' }
			})
		});
		const data = await response.json() as any;
		if (!data.vulns) {
			return [];
		}
		return data.vulns.slice(0, 3).map((v: any) => ({
			id: v.id,
			summary: v.summary || 'Sin descripción',
			severity: v.database_specific?.severity || 'UNKNOWN'
		}));
	} catch {
		return [];
	}
}

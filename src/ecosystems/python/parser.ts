import * as fs from 'fs';

export interface ParsedPackage {
	name: string;
	version: string;
	exactVersion: boolean;
}

export function readFileWithEncoding(filePath: string): string {
	const buffer = fs.readFileSync(filePath);

	// UTF-16 LE: BOM FF FE
	if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
		return buffer.slice(2).toString('utf16le');
	}

	// UTF-16 BE: BOM FE FF
	if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
		const swapped = Buffer.alloc(buffer.length - 2);
		for (let i = 2; i < buffer.length - 1; i += 2) {
			swapped[i - 2] = buffer[i + 1];
			swapped[i - 1] = buffer[i];
		}
		return swapped.toString('utf16le');
	}

	// UTF-8 con BOM: EF BB BF
	if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
		return buffer.slice(3).toString('utf8');
	}

	// UTF-8 sin BOM — caso más común
	return buffer.toString('utf8');
}

export function parseRequirements(content: string): ParsedPackage[] {
	const specifierRegex = /^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?(\[.*?\])?)\s*((?:[><!~]?=|[><]|~=).+)?$/;

	return content
		.split('\n')
		.map(line => line.trim())
		.filter(line => line && !line.startsWith('#') && !line.startsWith('-'))
		.map(line => {
			const withoutComment = line.split('#')[0].trim();
			const match = withoutComment.match(specifierRegex);
			if (!match) {
				return { name: withoutComment, version: 'unknown', exactVersion: false };
			}
			const name = match[1].trim();
			const fullSpec = match[4]?.trim() ?? '';

			if (!fullSpec) {
				return { name, version: 'unknown', exactVersion: false };
			}

			const isExact = fullSpec.startsWith('==') && !fullSpec.includes(',');
			const versionNumber = fullSpec.replace(/^[><!~]=?/, '').replace(/^==/, '').trim();

			return { name, version: versionNumber, exactVersion: isExact };
		});
}

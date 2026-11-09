/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { download, sha256 } from '../lib/download.ts';
import { getElectronVersion } from '../lib/electronVersion.ts';
import { root } from './installStateHash.ts';

const electronTypesPath = path.join(root, '.build', 'typings', 'electron.d.ts');

function getExpectedChecksum(): string {
	const checksumFile = fs.readFileSync(path.join(root, 'build', 'checksums', 'electron.txt'), 'utf8');
	const checksum = /^(?<checksum>[a-f0-9]{64}) \*electron\.d\.ts$/m.exec(checksumFile)?.groups?.checksum;
	if (!checksum) {
		throw new Error('Electron checksum manifest does not contain electron.d.ts');
	}
	return checksum;
}

export async function ensureElectronTypes(): Promise<void> {
	const expectedChecksum = getExpectedChecksum();
	if (fs.existsSync(electronTypesPath) && sha256(fs.readFileSync(electronTypesPath)) === expectedChecksum) {
		return;
	}

	const { electronVersion } = getElectronVersion();
	const candidateUrls: string[] = [];
	if (process.env.ELECTRON_MIRROR) {
		const mirror = process.env.ELECTRON_MIRROR.replace(/\/+$/, '');
		candidateUrls.push(`${mirror}/v${electronVersion}/electron.d.ts`);
	}
	candidateUrls.push(
		`https://github.com/electron/electron/releases/download/v${electronVersion}/electron.d.ts`,
		`https://cdn.npmmirror.com/binaries/electron/v${electronVersion}/electron.d.ts`
	);

	let contents: Uint8Array | undefined;
	let lastError: Error | undefined;
	for (const candidateUrl of candidateUrls) {
		try {
			contents = await download(candidateUrl, { checksumSha256: expectedChecksum });
			break;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
		}
	}

	if (!contents) {
		throw lastError ?? new Error(`Failed to download electron.d.ts for v${electronVersion}`);
	}

	fs.mkdirSync(path.dirname(electronTypesPath), { recursive: true });
	fs.writeFileSync(electronTypesPath, contents);
}

if (import.meta.main) {
	ensureElectronTypes().catch(error => {
		console.error(error);
		process.exit(1);
	});
}

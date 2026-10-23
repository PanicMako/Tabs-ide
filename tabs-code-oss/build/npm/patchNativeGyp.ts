/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function patchNativeGyp(baseDir = path.join(root, 'node_modules')): void {
	if (!fs.existsSync(baseDir)) {
		return;
	}

	for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
		const full = path.join(baseDir, entry.name);
		if (entry.isDirectory()) {
			patchNativeGyp(full);
		} else if (entry.name === 'except.gypi' || entry.name === 'noexcept.gypi') {
			const content = fs.readFileSync(full, 'utf8');
			const legacyTarget = '\'MACOSX_DEPLOYMENT_TARGET\': \'10.7\'';
			const modernTarget = '\'MACOSX_DEPLOYMENT_TARGET\': \'11.0\'';
			if (content.includes(legacyTarget)) {
				fs.writeFileSync(
					full,
					content.replaceAll(legacyTarget, modernTarget)
				);
				console.log(`[patchNativeGyp] Patched MACOSX_DEPLOYMENT_TARGET to 11.0 in ${path.relative(root, full)}`);
			}
		}
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	patchNativeGyp();
}

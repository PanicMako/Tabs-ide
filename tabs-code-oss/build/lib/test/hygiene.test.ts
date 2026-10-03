/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { suite, test } from 'node:test';
import { checkNoNewJavaScriptFiles } from '../../hygiene.ts';

suite('hygiene', () => {
	test('scopes JavaScript allowlist checks to a vendored checkout', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tabs-hygiene-'));
		try {
			const nested = path.join(root, 'code');
			fs.mkdirSync(nested);
			fs.writeFileSync(path.join(root, 'outer.js'), '');
			fs.writeFileSync(path.join(nested, 'allowed.js'), '');
			fs.writeFileSync(path.join(nested, '.eslint-allowed-javascript-files'), 'allowed.js\n');
			const env: NodeJS.ProcessEnv = { ...process.env, GIT_INDEX_FILE: path.join(root, 'index') };
			delete env.GIT_DIR;
			delete env.GIT_WORK_TREE;
			execFileSync('git', ['init', '-q', root], { env });
			execFileSync('git', ['-C', root, 'add', '--', 'outer.js', 'code'], { env });
			const previousIndex = process.env.GIT_INDEX_FILE;
			process.env.GIT_INDEX_FILE = env.GIT_INDEX_FILE;
			try {
				assert.strictEqual(checkNoNewJavaScriptFiles(nested), undefined);
				fs.writeFileSync(path.join(nested, 'unexpected.js'), '');
				execFileSync('git', ['-C', root, 'add', '--', 'code/unexpected.js'], { env });
				assert.ok(checkNoNewJavaScriptFiles(nested)?.includes('unexpected.js'));
			} finally {
				if (previousIndex === undefined) {
					delete process.env.GIT_INDEX_FILE;
				} else {
					process.env.GIT_INDEX_FILE = previousIndex;
				}
			}
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('rejects requested files that enter no hygiene checker', () => {
		const repositoryRoot = path.join(import.meta.dirname, '../../..');
		const result = spawnSync(process.execPath, [
			'--experimental-strip-types',
			'build/hygiene.ts',
			'src/vs/editor/contrib/colorPicker/browser/images/opacity-background.png',
		], {
			cwd: repositoryRoot,
			encoding: 'utf8',
		});

		assert.deepStrictEqual({
			status: result.status,
			hasNoMatchError: result.stderr.includes('No hygiene-eligible files matched the requested paths'),
		}, {
			status: 1,
			hasNoMatchError: true,
		});
	});
});

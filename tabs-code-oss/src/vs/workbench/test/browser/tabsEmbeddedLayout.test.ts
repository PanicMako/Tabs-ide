/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../base/browser/window.js';
import { List } from '../../../base/browser/ui/list/listWidget.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { getTabsEmbeddedRowHeight } from '../../browser/tabsEmbeddedLayout.js';
import { BreadcrumbsControl } from '../../browser/parts/editor/breadcrumbsControl.js';
import { ExplorerDelegate } from '../../contrib/files/browser/views/explorerViewer.js';

suite('Tabs embedded list geometry', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let wasEmbedded: boolean;

	setup(() => {
		wasEmbedded = mainWindow.document.documentElement.classList.contains('tabs-embedded-workbench');
	});

	teardown(() => {
		mainWindow.document.documentElement.classList.toggle('tabs-embedded-workbench', wasEmbedded);
	});

	for (const embedded of [true, false]) {
		test(`virtual row positions, scrolling and breadcrumb layout agree (embedded: ${embedded})`, () => {
			mainWindow.document.documentElement.classList.toggle('tabs-embedded-workbench', embedded);
			const height = embedded ? 24 : 22;
			assert.strictEqual(getTabsEmbeddedRowHeight(22), embedded ? 28 : 22);
			const container = mainWindow.document.createElement('div');
			const list = store.add(new List<number>('Tabs geometry test', container, {
				getHeight: () => ExplorerDelegate.ITEM_HEIGHT,
				getTemplateId: () => 'row'
			}, [{
				templateId: 'row',
				renderTemplate: () => undefined,
				renderElement: () => { },
				disposeTemplate: () => { }
			}]));
			list.layout(height * 3, 200);
			list.splice(0, 0, Array.from({ length: 100 }, (_, index) => index));
			assert.strictEqual(list.contentHeight, height * 100);
			assert.strictEqual(list.indexAt(height - 1), 0);
			assert.strictEqual(list.indexAt(height), 1);
			assert.strictEqual(list.indexAt(height * 99), 99);
			list.reveal(99, 1);
			assert.strictEqual(list.scrollTop, height * 97);
			assert.strictEqual(BreadcrumbsControl.HEIGHT, embedded ? 32 : 22);
		});
	}
});

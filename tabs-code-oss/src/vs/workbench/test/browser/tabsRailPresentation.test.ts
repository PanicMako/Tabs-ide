/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../base/browser/window.js';
import { DomScrollableElement } from '../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../../base/common/scrollable.js';
import { mock } from '../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { IContextMenuService } from '../../../platform/contextview/browser/contextView.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { SCMActionButton } from '../../contrib/scm/browser/scmViewPane.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../platform/actions/common/actions.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { registerTabsCommitDraftAction } from '../../contrib/tabs/browser/commitDraftMenu.js';
import { parseRailPresentation } from '../../contrib/tabs/browser/railPresentation.js';
import '../../browser/media/floatingPanels.css';
import '../../contrib/tabs/browser/media/embeddedWorkbench.css';

suite('Tabs rail presentation', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('commit drafting contributes an icon to the native Git input toolbar', () => {
		store.add(registerTabsCommitDraftAction());
		const item = MenuRegistry.getMenuItems(MenuId.SCMInputBox).find(item => isIMenuItem(item) && item.command.id === 'tabs.generateCommitMessage');
		assert.ok(isIMenuItem(item));
		assert.ok(ThemeIcon.isThemeIcon(item.command.icon));
		assert.strictEqual(item.command.icon.id, 'git-commit');
		assert.strictEqual(item.when?.serialize(), 'scmProvider == \'git\'');
	});

	test('focus outlines are suppressed across containers, extension cards and synthetic list focus', () => {
		const document = mainWindow.document;
		const root = document.documentElement;
		const wasEmbedded = root.classList.contains('tabs-embedded-workbench');
		root.classList.add('tabs-embedded-workbench');
		const workbench = document.createElement('div');
		workbench.className = 'monaco-workbench vs-dark';
		workbench.innerHTML = '<div class="pane-body" tabindex="0"></div><div class="monaco-list"><div class="monaco-list-row focused selected" tabindex="0"></div><div class="extension-list-item" tabindex="0"></div></div>';
		document.body.appendChild(workbench);
		try {
			for (const element of workbench.querySelectorAll<HTMLElement>('[tabindex]')) {
				// Upstream can draw focus on an owner or on a child with a synthetic trait.
				element.style.outline = '1px solid white';
				element.focus();
				assert.strictEqual(mainWindow.getComputedStyle(element).outlineStyle, 'none');
				element.blur();
				assert.strictEqual(mainWindow.getComputedStyle(element).outlineStyle, 'none');
			}
		} finally {
			workbench.remove();
			root.classList.toggle('tabs-embedded-workbench', wasEmbedded);
		}
	});

	test('sidebar scrollbar keeps its drag area while the painted thumb is inset', () => {
		const document = mainWindow.document;
		const root = document.documentElement;
		const wasEmbedded = root.classList.contains('tabs-embedded-workbench');
		root.classList.add('tabs-embedded-workbench');
		const workbench = document.createElement('div');
		workbench.className = 'monaco-workbench vs';
		workbench.innerHTML = '<div class="part sidebar"><div class="title"><div class="title-label"><h2>Explorer</h2></div></div></div>';
		document.body.appendChild(workbench);
		const scrollable = store.add(new DomScrollableElement(document.createElement('div'), { vertical: ScrollbarVisibility.Visible, verticalScrollbarSize: 8 }));
		workbench.querySelector('.sidebar')!.appendChild(scrollable.getDomNode());
		scrollable.setScrollDimensions({ width: 200, height: 200, scrollWidth: 200, scrollHeight: 1000 });
		try {
			const slider = scrollable.getDomNode().querySelector<HTMLElement>('.scrollbar.vertical > .slider')!;
			const style = mainWindow.getComputedStyle(slider);
			assert.strictEqual(slider.getBoundingClientRect().width, 8);
			assert.strictEqual(style.backgroundClip, 'padding-box');
			assert.strictEqual(parseFloat(style.width) - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth), 6);
			assert.strictEqual(mainWindow.getComputedStyle(workbench.querySelector('h2')!, '::before').content, 'none');
		} finally {
			workbench.remove();
			root.classList.toggle('tabs-embedded-workbench', wasEmbedded);
		}
	});

	test('floating grid exposes the rail backing behind rounded sidebar corners', () => {
		const document = mainWindow.document;
		const root = document.documentElement;
		const markers = ['tabs-embedded-workbench', 'tabs-sidebar-left', 'tabs-rail-lit', 'tabs-rail-spotlight'];
		const previous = markers.map(marker => root.classList.contains(marker));
		const workbench = document.createElement('div');
		workbench.style.cssText = '--vscode-focusBorder: #4b7aff; --vscode-foreground: #eeeeee; --vscode-sideBar-background: #17171a; --vscode-titleBar-activeBackground: #09090a; --modern-ui-shell-background: #09090a';
		workbench.style.transition = 'none';
		const grid = document.createElement('div');
		grid.className = 'monaco-grid-view';
		const sidebar = document.createElement('div');
		sidebar.className = 'part sidebar left';
		grid.appendChild(sidebar);
		workbench.appendChild(grid);
		document.body.appendChild(workbench);
		try {
			root.classList.add(...markers);
			for (const theme of ['vs', 'vs-dark']) {
				root.classList.remove('tabs-rail-spotlight');
				workbench.className = `monaco-workbench floating-panels noactivitybar ${theme}`;
				// Inherited custom properties must resolve to the same strengths as the shell.
				assert.strictEqual(mainWindow.getComputedStyle(workbench).getPropertyValue('--tabs-rail-light').trim(), theme === 'vs' ? '14%' : '26%');
				root.classList.add('tabs-rail-spotlight');
				assert.strictEqual(mainWindow.getComputedStyle(workbench).getPropertyValue('--tabs-rail-light').trim(), theme === 'vs' ? '22%' : '40%');
				root.classList.remove('tabs-rail-spotlight');
				assert.ok(mainWindow.getComputedStyle(workbench).backgroundImage.includes('radial-gradient'));
				assert.strictEqual(mainWindow.getComputedStyle(grid).backgroundColor, 'rgba(0, 0, 0, 0)');
				const sidebarStyle = mainWindow.getComputedStyle(sidebar);
				assert.strictEqual(sidebarStyle.borderLeftWidth, '1px');
				assert.strictEqual(sidebarStyle.borderLeftColor, 'rgba(0, 0, 0, 0)');
				assert.strictEqual(sidebarStyle.boxShadow, 'none');
				assert.strictEqual(sidebarStyle.borderTopLeftRadius, '20px');
				workbench.classList.add('nosidebar');
				assert.strictEqual(mainWindow.getComputedStyle(grid).backgroundColor, 'rgb(9, 9, 10)');
			}
			workbench.className = 'monaco-workbench floating-panels';
			root.classList.remove('tabs-embedded-workbench');
			assert.strictEqual(mainWindow.getComputedStyle(grid).backgroundColor, 'rgb(9, 9, 10)');
		} finally {
			workbench.remove();
			markers.forEach((marker, index) => root.classList.toggle(marker, previous[index]));
		}
	});
	test('accepts geometry only within the viewport and preserves labels as text', () => {
		const state = { selectionY: 0.25, spotlight: true, label: { text: 'Source Control', y: 0.5 } };
		assert.deepStrictEqual(parseRailPresentation(state), state);
		assert.deepStrictEqual(parseRailPresentation({ selectionY: null, spotlight: false, label: null }), { selectionY: null, spotlight: false, label: null });
		for (const selectionY of [-1, NaN, Infinity, 2, '0.5']) {
			assert.strictEqual(parseRailPresentation({ ...state, selectionY }), undefined);
		}
		for (const label of [{ text: '', y: 0.5 }, { text: 'x'.repeat(101), y: 0.5 }, { text: {}, y: 0.5 }, { text: 'Source Control', y: Infinity }]) {
			assert.strictEqual(parseRailPresentation({ ...state, label }), undefined);
		}
	});

	test('native SCM action fills the available row with and without a dropdown', () => {
		const document = mainWindow.document;
		const root = document.documentElement;
		const wasEmbedded = root.classList.contains('tabs-embedded-workbench');
		root.classList.add('tabs-embedded-workbench');
		const workbench = document.createElement('div');
		workbench.className = 'monaco-workbench';
		workbench.innerHTML = '<div class="part sidebar"><div class="scm-view"><div class="monaco-list-row"><div class="monaco-tl-contents"><div class="button-container"></div></div></div></div></div>';
		document.body.appendChild(workbench);
		const row = workbench.querySelector<HTMLElement>('.monaco-tl-contents')!;
		const container = workbench.querySelector<HTMLElement>('.button-container')!;
		const inputRow = row.cloneNode(false) as HTMLElement;
		inputRow.innerHTML = '<div class="scm-input"><div class="scm-editor"><div class="scm-editor-container" style="width: 90px"></div></div></div>';
		row.parentElement!.appendChild(inputRow);
		const input = inputRow.querySelector<HTMLElement>('.scm-input')!;
		const editor = input.querySelector<HTMLElement>('.scm-editor')!;
		row.style.height = '32px';
		const action = store.add(new SCMActionButton(container, new class extends mock<IContextMenuService>() { }, new class extends mock<ICommandService>() { }, new class extends mock<INotificationService>() { }));
		try {
			for (const width of [240, 420]) {
				row.style.width = `${width}px`;
				inputRow.style.width = `${width}px`;
				assert.ok(Math.abs(input.getBoundingClientRect().width - width) < 1);
				assert.ok(Math.abs(editor.getBoundingClientRect().width - (width - 23)) < 1);
				assert.strictEqual(mainWindow.getComputedStyle(editor).paddingLeft, '0px');
				assert.strictEqual(mainWindow.getComputedStyle(editor).paddingRight, '0px');
				for (const secondaryCommands of [undefined, [[{ id: 'test.commitAll', title: 'Commit All' }]]]) {
					action.setButton({ command: { id: 'test.commit', title: 'Commit' }, enabled: true, secondaryCommands });
					const button = container.firstElementChild as HTMLElement;
					const available = container.clientWidth - 23; // Native SCM row padding: 11px left, 12px right.
					assert.ok(Math.abs(container.getBoundingClientRect().width - width) < 1);
					assert.ok(Math.abs(button.getBoundingClientRect().width - available) < 1);
					if (secondaryCommands) {
						const primary = button.querySelector<HTMLElement>('.monaco-text-button')!;
						const dropdown = button.querySelector<HTMLElement>('.monaco-dropdown-button')!;
						assert.ok(primary.getBoundingClientRect().width > available - 50);
						assert.ok(dropdown.getBoundingClientRect().right <= button.getBoundingClientRect().right + 1);
					}
				}
			}
		} finally {
			workbench.remove();
			root.classList.toggle('tabs-embedded-workbench', wasEmbedded);
		}
	});
});

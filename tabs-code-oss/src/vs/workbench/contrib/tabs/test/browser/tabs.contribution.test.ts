/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import '../../browser/media/embeddedWorkbench.css';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter } from '../../../../../base/common/event.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CommandsRegistry, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ConfigurationTarget, IConfigurationOverrides, IConfigurationUpdateOverrides, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../../common/views.js';
import { MANAGED_SETTINGS_UPDATE_VIEW_ID, ManagedSettingsUpdateRequiredContext } from '../../../../services/policies/common/managedSettingsUpdate.js';
import { ViewContainerModel } from '../../../../services/views/common/viewContainerModel.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { ChatViewContainerId, ChatViewId } from '../../../chat/browser/chat.js';
import '../../../chat/browser/chatParticipant.contribution.js';
import { getTabsViewContainerTargetLocation, TabsModalBridge } from '../../browser/tabs.contribution.js';

suite('Tabs Contribution', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps queued dialogs modal until the last closes and releases listeners', async () => {
		const services = workbenchInstantiationService(undefined, store);
		const willShow = store.add(new Emitter<void>());
		const didClose = store.add(new Emitter<void>());
		const updates: unknown[][] = [];
		services.stub(IDialogService, { onWillShowDialog: willShow.event, onDidShowDialog: didClose.event });
		services.stub(ICommandService, {
			executeCommand: async <T>(id: string, ...args: unknown[]) => {
				updates.push([id, ...args]);
				return undefined as T;
			}
		});
		document.documentElement.classList.add('tabs-embedded-workbench');
		const bridge = store.add(services.createInstance(TabsModalBridge));
		try {
			willShow.fire();
			willShow.fire();
			didClose.fire();
			assert.ok(document.documentElement.classList.contains('tabs-modal-open'));
			didClose.fire();
			assert.ok(!document.documentElement.classList.contains('tabs-modal-open'));
			assert.deepStrictEqual(updates.map(update => update[1]), [true, true, true, false]);
			bridge.dispose();
			willShow.fire();
			assert.strictEqual(updates.length, 4);
		} finally {
			bridge.dispose();
			document.documentElement.classList.remove('tabs-embedded-workbench', 'tabs-modal-open');
		}
	});

	test('applies embedded appearance in memory without writing user settings', async () => {
		const services = workbenchInstantiationService(undefined, store);
		const updates: [string, unknown, ConfigurationTarget][] = [];
		services.stub(IConfigurationService, {
			updateValue: async (key: string, value: unknown, target?: ConfigurationTarget | IConfigurationOverrides | IConfigurationUpdateOverrides) => {
				assert.strictEqual(target, ConfigurationTarget.MEMORY);
				assert.ok(typeof target === 'number');
				updates.push([key, value, target]);
			}
		});
		const command = CommandsRegistry.getCommand('_tabs.applyAppearance')!;
		const settings = { 'workbench.colorTheme': 'Default Light Modern', 'editor.fontSize': 14, 'files.autoSave': 'on' };
		document.documentElement.classList.add('tabs-embedded-workbench');
		try {
			await services.invokeFunction(accessor => command.handler(accessor, settings));
			assert.deepStrictEqual(updates, [
				['workbench.colorTheme', 'Default Light Modern', ConfigurationTarget.MEMORY],
				['editor.fontSize', 14, ConfigurationTarget.MEMORY]
			]);
		} finally {
			document.documentElement.classList.remove('tabs-embedded-workbench');
		}
		await services.invokeFunction(accessor => command.handler(accessor, settings));
		assert.strictEqual(updates.length, 2);
	});

	test('blurs workbench parts without blurring the modal and rounds embedded controls', () => {
		const workbench = document.createElement('div');
		workbench.className = 'monaco-workbench';
		workbench.innerHTML = '<div class="part"><a class="monaco-button">Install</a><div class="monaco-inputbox"></div></div><div class="monaco-dialog-modal-block dimmed"><div class="monaco-dialog-box"></div></div>';
		document.body.appendChild(workbench);
		document.documentElement.classList.add('tabs-embedded-workbench', 'tabs-modal-open');
		try {
			assert.strictEqual(mainWindow.getComputedStyle(workbench.querySelector('.monaco-dialog-modal-block')!).backdropFilter, 'blur(4px)');
			assert.strictEqual(mainWindow.getComputedStyle(workbench.querySelector('.monaco-dialog-box')!).filter, 'none');
			assert.strictEqual(mainWindow.getComputedStyle(workbench.querySelector('.monaco-button')!).borderTopLeftRadius, '9px');
			assert.strictEqual(mainWindow.getComputedStyle(workbench.querySelector('.monaco-inputbox')!).borderTopLeftRadius, '9px');
			document.documentElement.classList.remove('tabs-modal-open');
			assert.strictEqual(mainWindow.getComputedStyle(workbench.querySelector('.part')!).filter, 'none');
		} finally {
			workbench.remove();
			document.documentElement.classList.remove('tabs-embedded-workbench', 'tabs-modal-open');
		}
	});

	test('rounds built-in and portaled surfaces without styling extension documents', () => {
		const workbench = document.createElement('div');
		workbench.className = 'monaco-workbench';
		workbench.innerHTML = `
			<button>Built-in button</button><textarea></textarea><select><option>Option</option></select>
			<div class="monaco-inputbox multiline"></div><div class="monaco-findInput"></div>
			<div class="monaco-pane-view"><div class="pane"><div class="pane-header"></div></div></div>
			<div class="monaco-custom-toggle monaco-checkbox"></div>
			<div class="settings-editor"><div class="setting-item-contents"></div></div>
			<div class="scm-editor-container"></div><div class="chat-input-container"></div>
			<div class="find-widget"></div><div class="suggest-widget"></div><div class="rename-box"></div>
			<div class="quick-input-widget"></div><div class="notifications-center"></div>
			<div class="monaco-action-bar"><div class="action-item action-dropdown-item">
				<a class="action-label"></a><div class="monaco-dropdown"><a class="action-label"></a></div>
			</div></div>`;
		const portal = document.createElement('div');
		portal.className = 'context-view';
		portal.innerHTML = '<div class="monaco-menu-container"><div class="monaco-menu"><a class="action-menu-item"></a></div></div><div class="monaco-select-box-dropdown-container"></div>';
		const extension = document.createElement('iframe');
		document.body.append(workbench, portal, extension);
		const extensionButton = extension.contentDocument!.createElement('button');
		extensionButton.style.borderRadius = '0px';
		extension.contentDocument!.body.append(extensionButton);
		const originalRadius = mainWindow.getComputedStyle(workbench.querySelector('button')!).borderRadius;
		document.documentElement.classList.add('tabs-embedded-workbench');
		try {
			for (const selector of ['button', 'textarea', 'select', '.monaco-inputbox', '.monaco-findInput', '.scm-editor-container']) {
				assert.strictEqual(mainWindow.getComputedStyle(workbench.querySelector(selector)!).borderRadius, '9px', selector);
			}
			for (const selector of ['.find-widget', '.suggest-widget', '.rename-box', '.quick-input-widget', '.notifications-center']) {
				assert.strictEqual(mainWindow.getComputedStyle(workbench.querySelector(selector)!).borderRadius, '16px', selector);
			}
			for (const selector of ['.monaco-menu-container', '.monaco-menu', '.monaco-select-box-dropdown-container']) {
				assert.strictEqual(mainWindow.getComputedStyle(portal.querySelector(selector)!).borderRadius, '16px', selector);
			}
			for (const [selector, radius] of [
				['.pane-header', '8px'], ['.monaco-checkbox', '5px'],
				['.setting-item-contents', '12px'], ['.chat-input-container', '12px'],
				['.action-dropdown-item > .action-label', '9px 0px 0px 9px'],
				['.monaco-dropdown > .action-label', '0px 9px 9px 0px']
			]) {
				assert.strictEqual(mainWindow.getComputedStyle(workbench.querySelector(selector)!).borderRadius, radius, selector);
			}
			assert.strictEqual(mainWindow.getComputedStyle(portal.querySelector('.action-menu-item')!).borderRadius, '8px');
			assert.strictEqual(extension.contentWindow!.getComputedStyle(extensionButton).borderRadius, '0px');
			document.documentElement.classList.remove('tabs-embedded-workbench');
			assert.strictEqual(mainWindow.getComputedStyle(workbench.querySelector('button')!).borderRadius, originalRadius);
		} finally {
			workbench.remove();
			portal.remove();
			extension.remove();
			document.documentElement.classList.remove('tabs-embedded-workbench');
		}
	});

	test('connects the selected assistant tab to the sidebar surface with a lighter tab strip', () => {
		const workbench = document.createElement('div');
		workbench.className = 'monaco-workbench modern-ui-tabs';
		workbench.style.setProperty('--vscode-sideBar-background', '#eee8d5');
		workbench.style.setProperty('--vscode-editor-background', '#fdf6e3');
		workbench.style.setProperty('--vscode-sideBar-foreground', '#657b83');
		workbench.innerHTML = `<div class="part auxiliarybar pane-composite-part"><div class="title">
			<div class="composite-bar-container"><div class="composite-bar"><div class="monaco-action-bar"><ul>
				<li class="action-item checked" style="position:relative;height:35px;border-block:4px solid transparent"><a class="action-label">Chat</a><div class="active-item-indicator"></div></li>
				<li class="action-item"><a class="action-label">Claude Code</a><div class="active-item-indicator"></div></li>
			</ul></div></div></div></div></div>`;
		const actions = document.createElement('div');
		actions.className = 'global-actions';
		actions.innerHTML = '<div class="monaco-action-bar"><ul class="actions-container"><li class="action-item"><a class="action-label">Maximize</a></li></ul></div>';
		workbench.querySelector('.title')!.append(actions);
		document.body.append(workbench);
		document.documentElement.classList.add('tabs-embedded-workbench');
		try {
			const active = mainWindow.getComputedStyle(workbench.querySelector('.checked > .active-item-indicator')!);
			assert.strictEqual(active.backgroundColor, 'rgb(238, 232, 213)');
			assert.strictEqual(active.borderTopLeftRadius, '10px');
			assert.strictEqual(active.borderBottomLeftRadius, '0px');
			assert.ok(parseFloat(active.height) > 20);
			assert.strictEqual(active.bottom, '0px');
			assert.strictEqual(active.overflow, 'visible');
			const shoulder = mainWindow.getComputedStyle(workbench.querySelector('.checked > .active-item-indicator')!, '::after');
			assert.strictEqual(shoulder.borderBottomLeftRadius, '8px');
			assert.ok(shoulder.boxShadow.includes('rgb(238, 232, 213)'));
			assert.strictEqual(mainWindow.getComputedStyle(actions.querySelector('.actions-container')!).alignItems, 'center');
			assert.strictEqual(mainWindow.getComputedStyle(actions).paddingInlineEnd, '4px');
			assert.strictEqual(mainWindow.getComputedStyle(workbench.querySelector('.action-item.checked')!).borderBottomWidth, '0px');
			assert.strictEqual(mainWindow.getComputedStyle(workbench.querySelector('.title')!).backgroundColor, 'rgb(253, 246, 227)');
			assert.strictEqual(mainWindow.getComputedStyle(workbench.querySelector('.checked > .action-label')!).color, 'rgb(101, 123, 131)');
			assert.strictEqual(mainWindow.getComputedStyle(workbench.querySelector('.action-item:not(.checked) > .active-item-indicator')!).backgroundColor, 'rgba(0, 0, 0, 0)');
		} finally {
			workbench.remove();
			document.documentElement.classList.remove('tabs-embedded-workbench');
		}
	});

	test('rounds assistant body corners and spaces only the built-in sidebar chat', () => {
		const workbench = document.body.appendChild(document.createElement('div'));
		workbench.className = 'monaco-workbench';
		workbench.innerHTML = `<div class="part auxiliarybar"><div class="content">
			<div class="interactive-session"><div class="interactive-input-part">
				<div class="chat-input-container"><div class="chat-input-toolbars"></div></div>
			</div></div>
			<div class="chat-welcome-view"><div class="chat-welcome-view-message"></div></div>
		</div></div><div class="webview-overlay-content webview-overlay-auxiliarybar-top-left webview-overlay-auxiliarybar-top-right"></div>`;
		document.documentElement.classList.add('tabs-embedded-workbench');
		try {
			const body = mainWindow.getComputedStyle(workbench.querySelector('.content')!);
			assert.strictEqual(body.borderRadius, '12px 12px 0px 0px');
			assert.strictEqual(body.overflow, 'hidden');
			const title = document.createElement('div');
			title.className = 'title';
			title.innerHTML = '<div class="composite-bar"><div class="action-item checked"></div><div class="action-item"></div></div>';
			const part = workbench.querySelector('.part.auxiliarybar')!;
			part.prepend(title);
			assert.strictEqual(mainWindow.getComputedStyle(part.querySelector('.content')!).borderTopLeftRadius, '0px');
			assert.strictEqual(mainWindow.getComputedStyle(part.querySelector('.content')!).borderTopRightRadius, '12px');
			title.querySelector('.checked')!.classList.remove('checked');
			title.querySelector('.action-item:last-child')!.classList.add('checked');
			assert.strictEqual(mainWindow.getComputedStyle(part.querySelector('.content')!).borderTopLeftRadius, '12px');
			const overlay = mainWindow.getComputedStyle(workbench.querySelector('.webview-overlay-content')!);
			assert.strictEqual(overlay.borderTopLeftRadius, '12px');
			assert.strictEqual(overlay.borderTopRightRadius, '12px');
			const input = workbench.querySelector('.chat-input-container')!;
			assert.strictEqual(mainWindow.getComputedStyle(input).paddingTop, '8px');
			assert.strictEqual(mainWindow.getComputedStyle(input).paddingBottom, '10px');
			workbench.querySelector('.interactive-input-part')!.classList.add('compact');
			assert.notStrictEqual(mainWindow.getComputedStyle(input).paddingTop, '8px');
		} finally {
			workbench.remove();
			document.documentElement.classList.remove('tabs-embedded-workbench');
		}
	});

	test('replaces Chat with the enforced-update view and restores it without duplicate panes', () => {
		const services = workbenchInstantiationService(undefined, store);
		const context = store.add(services.createInstance(ContextKeyService));
		services.stub(IContextKeyService, context);
		const container = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).get(ChatViewContainerId);
		assert.ok(container);
		const descriptors = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).getViews(container);
		const model = store.add(services.createInstance(ViewContainerModel, container));
		model.add(descriptors.map(viewDescriptor => ({ viewDescriptor })));
		const updateRequired = ManagedSettingsUpdateRequiredContext.bindTo(context);
		const aiDisabled = context.createKey<boolean>('config.chat.disableAIFeatures', false);

		assert.deepStrictEqual(model.visibleViewDescriptors.map(view => view.id), [ChatViewId]);
		aiDisabled.set(true);
		assert.deepStrictEqual(model.visibleViewDescriptors.map(view => view.id), [ChatViewId]);
		updateRequired.set(true);
		assert.deepStrictEqual(model.visibleViewDescriptors.map(view => view.id), [MANAGED_SETTINGS_UPDATE_VIEW_ID]);
		aiDisabled.set(false);
		assert.deepStrictEqual(model.visibleViewDescriptors.map(view => view.id), [MANAGED_SETTINGS_UPDATE_VIEW_ID]);
		updateRequired.set(false);
		assert.deepStrictEqual(model.visibleViewDescriptors.map(view => view.id), [ChatViewId]);
	});

	test('keeps the Claude fallback and secondary containers in their native locations', () => {
		assert.strictEqual(
			getTabsViewContainerTargetLocation('workbench.view.extension.claude-sidebar'),
			ViewContainerLocation.Sidebar,
		);
		assert.strictEqual(
			getTabsViewContainerTargetLocation('workbench.view.extension.claude-sidebar-secondary'),
			ViewContainerLocation.AuxiliaryBar,
		);
	});

	test('keeps the Claude sessions list in the primary sidebar', () => {
		assert.strictEqual(
			getTabsViewContainerTargetLocation('workbench.view.extension.claude-sessions-sidebar'),
			ViewContainerLocation.Sidebar,
		);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/tabs.css';
import './media/embeddedWorkbench.css';
import { mainWindow } from '../../../../base/browser/window.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';

let modalDepth = 0;

export class TabsModalBridge extends Disposable {

	constructor(
		@IDialogService dialogs: IDialogService,
		@ICommandService commands: ICommandService,
		@ILogService logService: ILogService
	) {
		super();
		if (!mainWindow.document.documentElement.classList.contains('tabs-embedded-workbench')) {
			return;
		}
		const publish = () => {
			const open = modalDepth > 0;
			mainWindow.document.documentElement.classList.toggle('tabs-modal-open', open);
			void commands.executeCommand('tabs.setModalOpen', open).catch(error => logService.warn('Tabs dialog bridge', error));
		};
		this._register(dialogs.onWillShowDialog(() => { modalDepth++; publish(); }));
		this._register(dialogs.onDidShowDialog(() => { modalDepth = Math.max(0, modalDepth - 1); publish(); }));
		this._register({
			dispose: () => {
				modalDepth = 0;
				mainWindow.document.documentElement.classList.remove('tabs-modal-open');
			}
		});
	}
}

registerWorkbenchContribution2('tabs.modalBridge', TabsModalBridge, WorkbenchPhase.BlockRestore);
CommandsRegistry.registerCommand('_tabs.getModalOpen', () => modalDepth > 0);

const extensionViewContainerId = (id: string) => `workbench.view.extension.${id}`;

const assistantViewContainerIds = new Set([
	'claude-sidebar-secondary',
	'codexSecondaryViewContainer',
	'geminiChat'
].map(extensionViewContainerId));
assistantViewContainerIds.add('workbench.panel.chat');

const sidebarViewContainerIds = new Set([
	'claude-sidebar',
	'claude-sessions-sidebar',
	'codexViewContainer',
	'coderabbit-vscode-sidebar-view',
	'copilot-chat',
	'context-inspector'
].map(extensionViewContainerId));

const hiddenViewContainerIds = new Set(['copilot-chat', 'context-inspector'].map(extensionViewContainerId));

export function getTabsViewContainerTargetLocation(id: string): ViewContainerLocation | undefined {
	if (assistantViewContainerIds.has(id)) {
		// Product placement must be stable throughout extension activation.
		return ViewContainerLocation.AuxiliaryBar;
	}
	return sidebarViewContainerIds.has(id) ? ViewContainerLocation.Sidebar : undefined;
}

CommandsRegistry.registerCommand('_tabs.getViewContainers', accessor => {
	const viewDescriptorService = accessor.get(IViewDescriptorService);
	for (const container of viewDescriptorService.viewContainers) {
		const targetLocation = getTabsViewContainerTargetLocation(container.id);
		if (targetLocation !== undefined && viewDescriptorService.getViewContainerLocation(container) !== targetLocation) {
			viewDescriptorService.moveViewContainerToLocation(container, targetLocation, undefined, '_tabs.getViewContainers');
		}
	}
	const railContainers = [ViewContainerLocation.Sidebar, ViewContainerLocation.AuxiliaryBar]
		.flatMap(location => viewDescriptorService.getViewContainersByLocation(location).map(container => ({ container, location })))
		.filter(({ container }) => !hiddenViewContainerIds.has(container.id))
		.filter(({ container }) => viewDescriptorService.getViewContainerModel(container).activeViewDescriptors.length > 0);

	return railContainers.map(({ container, location }) => {
		const model = viewDescriptorService.getViewContainerModel(container);
		let icon: { type: string; value?: string } | undefined;
		if (ThemeIcon.isThemeIcon(model.icon)) {
			icon = { type: 'themeIcon', value: model.icon.id };
		} else if (URI.isUri(model.icon)) {
			icon = { type: 'uri', value: model.icon.fsPath };
		}

		return {
			id: container.id,
			title: model.title,
			commandId: container.openCommandActionDescriptor?.id ?? container.id,
			location: location === ViewContainerLocation.AuxiliaryBar ? 'auxiliaryBar' : 'sidebar',
			icon,
			order: container.order
		};
	});
});

CommandsRegistry.registerCommand('_tabs.getActiveViewContainer', accessor => {
	const viewsService = accessor.get(IViewsService);
	return viewsService.getVisibleViewContainer(ViewContainerLocation.Sidebar)?.id ?? null;
});

// Tabs owns appearance persistence. Apply it to this embedded session without
// writing the user's settings file, which may be open with unsaved edits.
CommandsRegistry.registerCommand('_tabs.applyAppearance', async (accessor, settings: Record<string, unknown>) => {
	if (!mainWindow.document.documentElement.classList.contains('tabs-embedded-workbench')) {
		return;
	}
	const configurationService = accessor.get(IConfigurationService);
	for (const key of [
		'workbench.colorTheme',
		'workbench.colorCustomizations',
		'editor.tokenColorCustomizations',
		'editor.semanticTokenColorCustomizations',
		'editor.fontFamily',
		'editor.fontSize'
	]) {
		if (Object.hasOwn(settings, key)) {
			await configurationService.updateValue(key, settings[key], ConfigurationTarget.MEMORY);
		}
	}
});

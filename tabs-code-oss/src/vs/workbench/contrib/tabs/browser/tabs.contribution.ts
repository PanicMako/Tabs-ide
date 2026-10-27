/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/tabs.css';
import { registerTabsCommitDraftAction } from './commitDraftMenu.js';
import './media/embeddedWorkbench.css';
import { IHoverWidget } from '../../../../base/browser/ui/hover/hover.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IRailPresentation, parseRailPresentation } from './railPresentation.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { IWorkbenchLayoutService, Position } from '../../../services/layout/browser/layoutService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';

let modalDepth = 0;

export class TabsModalBridge extends Disposable {

	constructor(
		@IDialogService dialogs: IDialogService,
		@ICommandService commands: ICommandService,
		@ILogService logService: ILogService,
		@IViewsService viewsService: IViewsService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService
	) {
		super();
		if (!mainWindow.document.documentElement.classList.contains('tabs-embedded-workbench')) {
			return;
		}
		this._register(registerTabsCommitDraftAction());
		const updateRailEdge = () => mainWindow.document.documentElement.classList.toggle('tabs-sidebar-left', layoutService.getSideBarPosition() === Position.LEFT);
		updateRailEdge();
		this._register(layoutService.onDidLayoutMainContainer(updateRailEdge));
		this._register(viewsService.onDidChangeViewVisibility(() => mainWindow.document.documentElement.classList.remove('tabs-rail-spotlight')));
		const publish = () => {
			const open = modalDepth > 0;
			mainWindow.document.documentElement.classList.toggle('tabs-modal-open', open);
			if (open) {
				mainWindow.document.documentElement.classList.remove('tabs-rail-spotlight');
			}
			void commands.executeCommand('tabs.setModalOpen', open).catch(error => logService.warn('Tabs dialog bridge', error));
		};
		this._register(dialogs.onWillShowDialog(() => { modalDepth++; publish(); }));
		this._register(dialogs.onDidShowDialog(() => { modalDepth = Math.max(0, modalDepth - 1); publish(); }));
		this._register({
			dispose: () => {
				modalDepth = 0;
				mainWindow.document.documentElement.classList.remove('tabs-modal-open', 'tabs-rail-spotlight', 'tabs-sidebar-left');
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

// Transient presentation only; these commands do not change settings or editor state.
for (const [id, active] of [['_tabs.railSpotlightOn', true], ['_tabs.railSpotlightOff', false]] as const) {
	CommandsRegistry.registerCommand(id, () => {
		const root = mainWindow.document.documentElement;
		if (root.classList.contains('tabs-embedded-workbench')) {
			root.classList.toggle('tabs-rail-spotlight', active && !root.classList.contains('tabs-modal-open'));
		}
	});
}

/** Draw rail decorations in the same native surface as the sidebar they overlap. */
export class TabsRailPresentation extends Disposable {
	private state: IRailPresentation = { selectionY: null, spotlight: false, label: null };
	private readonly hover = this._register(new MutableDisposable<IHoverWidget>());
	private labelKey: string | undefined;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IHoverService private readonly hoverService: IHoverService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IViewsService viewsService: IViewsService,
		@IDialogService dialogs: IDialogService
	) {
		super();
		if (!mainWindow.document.documentElement.classList.contains('tabs-embedded-workbench')) {
			return;
		}
		this._register(CommandsRegistry.registerCommand('_tabs.setRailPresentation', (_accessor, value: unknown) => {
			const presentation = parseRailPresentation(value);
			if (presentation) {
				this.state = presentation;
				this.render();
			}
		}));
		const clearTransient = () => {
			this.state = { ...this.state, spotlight: false, label: null };
			this.render();
		};
		this._register(layoutService.onDidLayoutMainContainer(() => this.render()));
		this._register(viewsService.onDidChangeViewVisibility(clearTransient));
		this._register(dialogs.onWillShowDialog(clearTransient));
		this._register({
			dispose: () => {
				const root = mainWindow.document.documentElement;
				root.classList.remove('tabs-rail-lit', 'tabs-rail-spotlight');
				root.style.removeProperty('--tabs-rail-y');
			}
		});
	}

	private render(): void {
		const root = mainWindow.document.documentElement;
		const height = this.layoutService.mainContainer.clientHeight;
		const modal = root.classList.contains('tabs-modal-open');
		root.classList.toggle('tabs-rail-lit', this.state.selectionY !== null);
		root.classList.toggle('tabs-rail-spotlight', this.state.spotlight && !modal);
		if (this.state.selectionY !== null) {
			root.style.setProperty('--tabs-rail-y', `${this.state.selectionY * height - 4}px`);
		}
		const label = modal || this.accessibilityService.isScreenReaderOptimized() ? null : this.state.label;
		const y = label ? Math.max(8, Math.min(height - 42, label.y * height - 17)) : 0;
		const key = label ? `${label.text}:${Math.round(y)}` : undefined;
		if (key === this.labelKey && (!label || (this.hover.value && !this.hover.value.isDisposed))) {
			return;
		}
		this.labelKey = key;
		this.hover.clear();
		if (label) {
			this.hover.value = this.hoverService.showInstantHover({
				content: label.text,
				target: { targetElements: [this.layoutService.mainContainer], x: 10, y },
				position: { hoverPosition: HoverPosition.RIGHT, forcePosition: true },
				appearance: { showPointer: false, compact: true, showHoverHint: false },
				persistence: { sticky: true, hideOnKeyDown: true },
				additionalClasses: ['tabs-rail-label']
			});
		}
	}
}

registerWorkbenchContribution2('tabs.railPresentation', TabsRailPresentation, WorkbenchPhase.BlockRestore);

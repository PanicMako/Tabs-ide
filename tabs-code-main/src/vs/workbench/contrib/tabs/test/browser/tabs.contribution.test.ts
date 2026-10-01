/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../../common/views.js';
import { MANAGED_SETTINGS_UPDATE_VIEW_ID, ManagedSettingsUpdateRequiredContext } from '../../../../services/policies/common/managedSettingsUpdate.js';
import { ViewContainerModel } from '../../../../services/views/common/viewContainerModel.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { ChatViewContainerId, ChatViewId } from '../../../chat/browser/chat.js';
import '../../../chat/browser/chatParticipant.contribution.js';
import { getTabsViewContainerTargetLocation } from '../../browser/tabs.contribution.js';

suite('Tabs Contribution', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

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

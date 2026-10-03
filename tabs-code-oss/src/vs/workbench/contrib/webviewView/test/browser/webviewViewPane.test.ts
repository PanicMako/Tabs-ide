/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IViewBadge, IViewDescriptorService, ViewContainerLocation } from '../../../../common/views.js';
import { IActivityService } from '../../../../services/activity/common/activity.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { TestViewsService, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IOverlayWebview, IWebviewService } from '../../../webview/browser/webview.js';
import { WebviewViewPane } from '../../browser/webviewViewPane.js';
import { IWebviewViewService, WebviewView, WebviewViewService } from '../../browser/webviewViewService.js';

class TestViewDescriptorService extends mock<IViewDescriptorService>() {
	override readonly onDidChangeLocation = Event.None;

	override getViewLocationById(): ViewContainerLocation {
		return ViewContainerLocation.Sidebar;
	}
}

class TestWebviewViewPane extends WebviewViewPane {
	protected override renderHeader(): void { }

	setBadge(badge: IViewBadge | undefined): void {
		this.updateBadge(badge);
	}
}

suite('WebviewViewPane', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('disposing a pane cancels pending revival and permits a replacement pane', async () => {
		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(IViewDescriptorService, new TestViewDescriptorService());
		instantiationService.stub(IViewsService, new TestViewsService());
		instantiationService.stub(IWebviewService, new class extends mock<IWebviewService>() {
			override createWebviewOverlay(): IOverlayWebview {
				return new class extends mock<IOverlayWebview>() {
					override readonly container = document.createElement('div');
					override readonly onDidUpdateState = Event.None;
					override claim(): void { }
					override release(): void { }
					override setAnchorElement(): void { }
					override dispose(): void { }
				}();
			}
		}());
		const pending: Promise<void>[] = [];
		const service = store.add(new class extends WebviewViewService {
			override resolve(viewType: string, view: WebviewView, cancellation: CancellationToken): Promise<void> {
				const result = super.resolve(viewType, view, cancellation);
				pending.push(result);
				return result;
			}
		}());
		instantiationService.stub(IWebviewViewService, service);
		const createPane = () => {
			const pane = store.add(instantiationService.createInstance(TestWebviewViewPane, {
				id: 'pendingWebviewView', title: 'Pending Webview View',
			}));
			pane.render();
			pane.setVisible(true);
			pane.setExpanded(true);
			return pane;
		};

		const first = createPane();
		assert.strictEqual(pending.length, 1);
		first.dispose();
		await pending[0];

		const replacement = createPane();
		assert.strictEqual(pending.length, 2);
		replacement.dispose();
		await pending[1];
	});

	test('clears view activity when badge is removed', () => {
		const activityEvents: string[] = [];
		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(IViewDescriptorService, new TestViewDescriptorService());
		instantiationService.stub(IActivityService, new class extends mock<IActivityService>() {
			override showViewActivity(viewId: string) {
				activityEvents.push(`show:${viewId}`);
				return toDisposable(() => activityEvents.push(`dispose:${viewId}`));
			}
		});
		instantiationService.stub(IViewsService, new TestViewsService());
		instantiationService.stub(IWebviewService, new class extends mock<IWebviewService>() { });
		instantiationService.stub(IWebviewViewService, new class extends mock<IWebviewViewService>() {
			override readonly onNewResolverRegistered = Event.None;
		});

		const pane = store.add(instantiationService.createInstance(TestWebviewViewPane, {
			id: 'testWebviewView',
			title: 'Test Webview View',
		}));

		pane.setBadge({ value: 1, tooltip: 'Test badge' });
		pane.setBadge(undefined);

		assert.deepStrictEqual(activityEvents, [
			'show:testWebviewView',
			'dispose:testWebviewView',
		]);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../base/browser/window.js';

/** Keep native virtualized row measurements aligned with Tabs' embedded presentation. */
export function getTabsEmbeddedRowHeight(defaultHeight: number, embeddedHeight = 28): number {
	return mainWindow.document.documentElement.classList.contains('tabs-embedded-workbench') ? embeddedHeight : defaultHeight;
}

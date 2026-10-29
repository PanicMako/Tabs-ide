/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { localize } from '../../../../nls.js';

/** Embedded workbench contribution; keeps proposed extension menu APIs out of the bundled extension. */
export function registerTabsCommitDraftAction() {
	return MenuRegistry.appendMenuItem(MenuId.SCMInputBox, {
		command: { id: 'tabs.generateCommitMessage', title: localize('tabs.generateCommitMessage', "Generate Commit Message"), icon: Codicon.gitCommit },
		when: ContextKeyExpr.equals('scmProvider', 'git'),
		group: 'navigation',
		order: -100
	});
}

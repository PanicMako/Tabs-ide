/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Mirrors the narrow CodeRailPresentation bridge contract in tabs-app.
export interface IRailPresentation {
	selectionY: number | null;
	spotlight: boolean;
	label: { text: string; y: number } | null;
}

export function parseRailPresentation(value: unknown): IRailPresentation | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const input = value as Record<string, unknown>;
	const position = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
	if ((input.selectionY !== null && !position(input.selectionY)) || typeof input.spotlight !== 'boolean') {
		return undefined;
	}
	let label: IRailPresentation['label'] = null;
	if (input.label !== null) {
		if (!input.label || typeof input.label !== 'object') {
			return undefined;
		}
		const candidate = input.label as Record<string, unknown>;
		if (typeof candidate.text !== 'string' || !candidate.text.trim() || candidate.text.length > 100 || !position(candidate.y)) {
			return undefined;
		}
		label = { text: candidate.text, y: candidate.y };
	}
	return { selectionY: input.selectionY as number | null, spotlight: input.spotlight, label };
}

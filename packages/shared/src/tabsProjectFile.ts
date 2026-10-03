import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { TabsProjectFile, TABS_PROJECT_FILE_SCHEMA_URL } from "@tabs/contracts";

import { fromLenientJson } from "./schemaJson.ts";

/**
 * Codec between raw `tabs.json` / `t3.json` file contents (lenient JSONC string)
 * and the decoded {@link TabsProjectFile}.
 */
export const TabsProjectFileFromJson = fromLenientJson(TabsProjectFile);

const decodeTabsProjectFile = Schema.decodeExit(TabsProjectFileFromJson);

/**
 * Decode raw `tabs.json` / `t3.json` contents, treating invalid or malformed files as
 * absent. Clients use this to read optional defaults (scripts, thread env
 * mode) without surfacing decode errors to the user.
 */
export function parseTabsProjectFile(contents: string): TabsProjectFile | null {
  const decoded = decodeTabsProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/** Backward compatibility alias for T3 */
export const T3ProjectFileFromJson = TabsProjectFileFromJson;
export const parseT3ProjectFile = parseTabsProjectFile;

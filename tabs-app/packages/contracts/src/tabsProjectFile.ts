import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { ThreadEnvMode } from "./settings.ts";
import { ProjectScriptIcon } from "./orchestration.ts";

/** File name of the checked-in Tabs project file, resolved at the workspace root. */
export const TABS_PROJECT_FILE_NAME = "tabs.json";

/** Legacy/compatibility file name supported for checked-in project files. */
export const T3_PROJECT_FILE_NAME = "t3.json";

/** Public URL of the published JSON Schema for {@link TabsProjectFile}. */
export const TABS_PROJECT_FILE_SCHEMA_URL = "https://tabs.tools/schema/tabs.json";
export const T3_PROJECT_FILE_SCHEMA_URL = "https://t3.codes/schema/t3.json";

const TABS_PROJECT_FILE_PATH_MAX_LENGTH = 512;
const TABS_PROJECT_FILE_MAX_SCRIPTS = 50;

const trimmedNonEmpty = (annotations: { readonly description: string }, maxLength?: number) => {
  const annotated = Schema.String.annotate(annotations);
  const encoded =
    maxLength === undefined
      ? annotated.check(Schema.isNonEmpty())
      : annotated.check(Schema.isNonEmpty(), Schema.isMaxLength(maxLength));
  return encoded.pipe(Schema.decodeTo(encoded, SchemaTransformation.trim()));
};

export const TabsProjectFileScript = Schema.Struct({
  name: trimmedNonEmpty({
    description: "Display name for the script, shown in the Tabs scripts menu.",
  }),
  command: trimmedNonEmpty({
    description: "Shell command executed in a Tabs terminal at the project root.",
  }),
  icon: Schema.optionalKey(
    ProjectScriptIcon.annotate({
      description: 'Icon shown next to the script in the scripts menu. Defaults to "play".',
    }),
  ),
  runOnWorktreeCreate: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, the script runs automatically after a worktree is created for a new thread.",
    }),
  ),
  previewUrl: Schema.optionalKey(
    trimmedNonEmpty({
      description:
        "URL opened in the in-app browser preview when this script runs. Only honored on the desktop build.",
    }),
  ),
  autoOpenPreview: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, automatically open the preview panel at `previewUrl` the moment the script starts.",
    }),
  ),
}).annotate({
  description: "A project script that team members can import into Tabs.",
});
export type TabsProjectFileScript = typeof TabsProjectFileScript.Type;

export const TabsProjectFile = Schema.Struct({
  $schema: Schema.optionalKey(
    Schema.String.annotate({
      description: `URL of the JSON Schema for this file, typically "${TABS_PROJECT_FILE_SCHEMA_URL}".`,
    }),
  ),
  iconPath: Schema.optionalKey(
    trimmedNonEmpty(
      {
        description: 'Workspace-relative path to the project icon (e.g. "assets/logo.svg").',
      },
      TABS_PROJECT_FILE_PATH_MAX_LENGTH,
    ),
  ),
  defaultThreadEnvMode: Schema.optionalKey(
    ThreadEnvMode.annotate({
      description:
        'Where new threads start for this repository: "worktree" for a fresh git worktree, "local" for the current checkout.',
    }),
  ),
  scripts: Schema.optionalKey(
    Schema.Array(TabsProjectFileScript)
      .annotate({
        description: "Project scripts shared with everyone who opens this repository in Tabs.",
      })
      .check(Schema.isMaxLength(TABS_PROJECT_FILE_MAX_SCRIPTS)),
  ),
}).annotate({
  title: "Tabs project file",
  description:
    "Checked-in project configuration for Tabs (tabs.json or t3.json at the repository root).",
});
export type TabsProjectFile = typeof TabsProjectFile.Type;

// Backwards compatibility aliases for T3
export const T3ProjectFileScript = TabsProjectFileScript;
export type T3ProjectFileScript = TabsProjectFileScript;
export const T3ProjectFile = TabsProjectFile;
export type T3ProjectFile = TabsProjectFile;

/**
 * ProjectFileLoader - Effect service that loads the checked-in `tabs.json`
 * (or fallback `t3.json`) project file from a workspace root.
 *
 * Loading is best-effort: missing files resolve to `Option.none`, and
 * unreadable or invalid files are logged and treated as absent so callers
 * fall back to defaults.
 *
 * @module ProjectFileLoader
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  TABS_PROJECT_FILE_NAME,
  T3_PROJECT_FILE_NAME,
  type TabsProjectFile,
} from "@tabs/contracts";
import { TabsProjectFileFromJson } from "@tabs/shared/tabsProjectFile";

const decodeTabsProjectFileJson = Schema.decodeEffect(TabsProjectFileFromJson);

export class ProjectFileLoadError extends Schema.TaggedErrorClass<ProjectFileLoadError>()(
  "ProjectFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} project file at ${this.filePath}.`;
  }
}

/** Service tag for tabs.json / t3.json project file loading. */
export class ProjectFileLoader extends Context.Service<
  ProjectFileLoader,
  {
    /**
     * Load and decode `tabs.json` (or fallback `t3.json`) at the workspace root.
     *
     * Never fails: missing, unreadable, or invalid files resolve to
     * `Option.none` (invalid files are logged as warnings).
     */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<TabsProjectFile>>;
  }
>()("tabs/project/ProjectFileLoader") {}

const logProjectFileLoadError = (error: ProjectFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const tryReadFile = (filePath: string, workspaceRoot: string) =>
    fileSystem.readFileString(filePath).pipe(
      Effect.map(Option.some),
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(Option.none<string>())
            : logProjectFileLoadError(
                new ProjectFileLoadError({
                  operation: "read",
                  workspaceRoot,
                  filePath,
                  cause: error,
                }),
              ).pipe(Effect.as(Option.none<string>())),
      }),
    );

  const load: ProjectFileLoader["Service"]["load"] = Effect.fn("ProjectFileLoader.load")(
    function* (workspaceRoot) {
      const tabsFilePath = path.join(workspaceRoot, TABS_PROJECT_FILE_NAME);
      let raw = yield* tryReadFile(tabsFilePath, workspaceRoot);
      let activePath = tabsFilePath;

      if (Option.isNone(raw)) {
        const t3FilePath = path.join(workspaceRoot, T3_PROJECT_FILE_NAME);
        raw = yield* tryReadFile(t3FilePath, workspaceRoot);
        activePath = t3FilePath;
      }

      if (Option.isNone(raw)) {
        return Option.none<TabsProjectFile>();
      }

      return yield* decodeTabsProjectFileJson(raw.value).pipe(
        Effect.map(Option.some),
        Effect.catchTags({
          SchemaError: (error) =>
            logProjectFileLoadError(
              new ProjectFileLoadError({
                operation: "decode",
                workspaceRoot,
                filePath: activePath,
                cause: error,
              }),
            ).pipe(Effect.as(Option.none<TabsProjectFile>())),
        }),
      );
    },
  );

  return ProjectFileLoader.of({ load });
});

export const layer = Layer.effect(ProjectFileLoader, make);

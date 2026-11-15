import { OrchestratorMcpFailure, UserThemeColors } from "@tabs/contracts";
import { USER_THEME_GUIDE, applyUserThemeEdit, type UserThemeEdit } from "@tabs/shared/themeCss";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { readCaller, readFullAccessCaller, unavailable } from "../../threadAccess.ts";
import { ThemeToolkit } from "./tools.ts";

const decodeColors = Schema.decodeUnknownExit(Schema.Struct(UserThemeColors.fields));

/** Checks agent-supplied colors against the real role and hex rules. */
const checkColors = (name: string, colors: Record<string, string | null> | undefined) =>
  colors === undefined || decodeColors(colors, { onExcessProperty: "error" })._tag === "Success"
    ? Effect.void
    : Effect.fail(
        new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `\`${name}\` needs known color roles with #rgb, #rrggbb or #rrggbbaa values.`,
        }),
      );

export const layer = ThemeToolkit.toLayer({
  t3_theme_read: () =>
    Effect.gen(function* () {
      yield* readCaller();
      const settings = yield* Settings.ServerSettingsService;
      const current = yield* settings.getSettings.pipe(Effect.mapError(unavailable));
      return { theme: current.userTheme, guide: USER_THEME_GUIDE };
    }),
  t3_theme_set: (edit) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
      const set = Effect.gen(function* () {
        yield* checkColors("colors", edit.colors);
        yield* checkColors("light", edit.light);
        yield* checkColors("dark", edit.dark);
        yield* readFullAccessCaller(
          "Theme changes require a live full-access/default calling thread or a full-access client.",
        );
        const settings = yield* Settings.ServerSettingsService;
        const current = yield* settings.getSettings.pipe(Effect.mapError(unavailable));
        const now = new Date(yield* Clock.currentTimeMillis).toISOString();
        const result = applyUserThemeEdit(current.userTheme, edit as UserThemeEdit, now);
        if (!result.ok) {
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: result.error,
          });
        }
        const updated = yield* settings
          .updateSettings({ userTheme: result.theme })
          .pipe(Effect.mapError(unavailable));
        return { theme: updated.userTheme };
      });
      // A thread caller serializes with its own turn; a client has no thread to lock.
      return yield* scope.thread === undefined
        ? set
        : executor.withLock(scope.thread.threadId, set);
    }),
});

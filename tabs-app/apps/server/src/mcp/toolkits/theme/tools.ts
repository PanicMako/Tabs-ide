import { OrchestratorMcpFailure, USER_THEME_COLOR_ROLES } from "@tabs/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

// Loose on purpose: the full UserTheme schema would be repeated in every tool definition and
// cost every agent thousands of bytes of context. The handler validates roles and hex values.
const ToolColors = Schema.Record(Schema.String, Schema.NullOr(Schema.String));
const ToolTheme = Schema.Struct({
  colors: ToolColors,
  light: ToolColors,
  dark: ToolColors,
  css: Schema.String,
  updatedAt: Schema.String,
});

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    Settings.ServerSettingsService,
    ThreadCommandExecutor.ThreadCommandExecutor,
  ],
};

const ThemeReadTool = Tool.make("t3_theme_read", {
  ...shared,
  description:
    "Read the user's current Tabs theme (palette overrides and CSS) and the guide to restyle the app: color roles and CSS selectors. Call before `t3_theme_set`.",
  success: Schema.Struct({
    theme: ToolTheme,
    guide: Schema.String,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ThemeSetTool = Tool.make("t3_theme_set", {
  ...shared,
  description:
    "Restyle Tabs itself, only when the user asks. `colors`, `light` and `dark` merge #hex colors into the palette by role (null removes a role; roles are listed by t3_theme_read); `css` replaces the custom CSS ('' clears it); `reset: true` clears everything first. It applies live and the user can review or reset it in Settings > Appearance. Requires a live full-access/default calling thread.",
  parameters: Schema.Struct({
    reset: Schema.optionalKey(Schema.Boolean),
    colors: Schema.optionalKey(ToolColors),
    light: Schema.optionalKey(ToolColors),
    dark: Schema.optionalKey(ToolColors),
    css: Schema.optionalKey(Schema.String),
  }),
  success: Schema.Struct({ theme: ToolTheme }),
}).annotate(Tool.Destructive, true);

/** Roles named in tool descriptions so agents need no schema to know them. */
export const THEME_ROLES: ReadonlyArray<string> = USER_THEME_COLOR_ROLES;
export const ThemeToolkit = Toolkit.make(ThemeReadTool, ThemeSetTool);

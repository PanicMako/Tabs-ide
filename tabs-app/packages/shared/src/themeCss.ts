import {
  EMPTY_USER_THEME,
  USER_THEME_COLOR_ROLES,
  USER_THEME_CSS_MAX_LENGTH,
  type UserTheme,
  type UserThemeColors,
} from "@tabs/contracts";

/**
 * Theme CSS comes from agents and from the user's own paste, and it is applied to
 * the app that shows their code, so it must not load files (a `url()` on an attribute
 * selector can send what is on screen to another host), reorder the cascade, or escape
 * the layer it is wrapped in.
 */

export const USER_THEME_LAYER = "user-theme";

const FETCHES_BY_STRING = /image-set\(|\bsrc\(|expression\(|-moz-binding|javascript:/i;
// Only CSS whitespace may precede data: or #. \s also matches U+00A0, which makes the address relative.
const URL_NOT_LOCAL = /url\((?![ \t\n\f\r]*["']?(?:data:|#))/i;
const FORBIDDEN_AT_RULE = /@(?:import|charset|namespace|font-face|layer|-moz-document)\b/i;

export type SanitizedThemeCss =
  | { readonly ok: true; readonly css: string }
  | { readonly ok: false; readonly error: string };

const refuse = (error: string): SanitizedThemeCss => ({ ok: false, error });

/**
 * Checks `css` and returns it with comments removed and `!important` stripped.
 *
 * `!important` goes because the CSS is applied in a cascade layer, where an important
 * declaration would beat an unlayered important one: the wallpaper reading plates and
 * print styles keep their `!important` colors only if theme CSS cannot outrank them.
 * Backslashes are refused outright so an escape cannot spell `url` or `import`.
 */
export function sanitizeUserThemeCss(input: string): SanitizedThemeCss {
  if (input.length > USER_THEME_CSS_MAX_LENGTH) {
    return refuse(`CSS is longer than ${USER_THEME_CSS_MAX_LENGTH} characters.`);
  }
  if (input.includes("\\")) return refuse("CSS escapes (backslashes) are not allowed.");

  // Walk once, dropping comments and checking that strings close and braces balance, so
  // the text cannot close the wrapping layer early or leave a string or comment open.
  let out = "";
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < input.length; index++) {
    const char = input.charAt(index);
    if (quote !== null) {
      if (char === "\n") return refuse("A string is not closed before the end of its line.");
      if (char === quote) quote = null;
      out += char;
      continue;
    }
    if (char === "/" && input.charAt(index + 1) === "*") {
      const end = input.indexOf("*/", index + 2);
      if (end === -1) return refuse("A comment is not closed.");
      out += " ";
      index = end + 1;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth < 0) return refuse("There is a closing brace without an opening one.");
    }
    out += char;
  }
  if (quote !== null) return refuse("A string is not closed.");
  if (depth !== 0) return refuse("A brace is not closed.");

  if (FORBIDDEN_AT_RULE.test(out)) {
    return refuse("@import, @charset, @namespace, @font-face and @layer are not allowed.");
  }
  if (FETCHES_BY_STRING.test(out) || URL_NOT_LOCAL.test(out)) {
    return refuse("CSS cannot load files: url() accepts only data: or #id.");
  }
  const css = out.replace(/!\s*important/gi, "").trim();
  return { ok: true, css };
}

const declarations = (colors: UserThemeColors): string =>
  USER_THEME_COLOR_ROLES.flatMap((role) => {
    const value = colors[role];
    return typeof value === "string" ? [`--${role}:${value} !important;`] : [];
  }).join("");

/**
 * The stylesheet text for a user theme, or "" when it sets nothing. Palette overrides are
 * `!important` custom properties because the app writes the same properties inline on
 * `<html>`. `css` is sanitized again here, so a hand-edited settings file cannot bypass it.
 */
export function compileUserThemeCss(theme: UserTheme): string {
  const base = declarations(theme.colors);
  const light = declarations(theme.light);
  const dark = declarations(theme.dark);
  const custom = sanitizeUserThemeCss(theme.css);
  const parts = [
    base ? `:root{${base}}` : "",
    light ? `:root:not(.dark){${light}}` : "",
    dark ? `:root.dark{${dark}}` : "",
    custom.ok && custom.css ? `@layer ${USER_THEME_LAYER}{${custom.css}}` : "",
  ];
  return parts.filter(Boolean).join("\n");
}

export const USER_THEME_HOOKS = [
  { selector: '[data-slot="sidebar"]', styles: "app sidebar" },
  { selector: "[data-chat-header]", styles: "chat header" },
  { selector: "[data-timeline-row-kind]", styles: "chat row" },
  { selector: '[data-message-role="user"]', styles: "user message row" },
  { selector: '[data-message-role="assistant"]', styles: "assistant message row" },
  { selector: ".chat-markdown", styles: "assistant text" },
  { selector: "[data-chat-composer-form]", styles: "composer" },
] as const;

/** What an agent needs to restyle the app. `t3_theme_read` returns it. */
export const USER_THEME_GUIDE = [
  "Tabs themes restyle the desktop and web app. The user can review and reset them in Settings > Appearance > Agent theme.",
  "",
  "Colors: `colors` sets a palette role (hex only) in light and dark. `light` and `dark` override it for one appearance. Prefer colors over CSS.",
  `Roles: ${USER_THEME_COLOR_ROLES.join(", ")}.`,
  "",
  `CSS: \`css\` is applied inside a cascade layer above the app's utilities, so plain rules work without !important (it is stripped).`,
  "Use `.dark` or `:root:not(.dark)` to target one appearance.",
  `It cannot load files: no @import, @font-face or @layer, no image-set(), no backslash escapes, and url() only with data: or #id. It holds ${USER_THEME_CSS_MAX_LENGTH} characters.`,
  "Wallpaper reading plates and print styles keep their own backgrounds and text colors so text stays legible; theme CSS cannot override them.",
  "",
  "Stable selectors (other class names change between releases):",
  ...USER_THEME_HOOKS.map((hook) => `- ${hook.selector}: ${hook.styles}`),
  "",
  "You cannot see the result. Make small changes, then ask the user how it looks.",
  "To undo, call t3_theme_set with `reset: true`.",
].join("\n");

/** A partial change to a user theme. A null color removes that role; `css` replaces the CSS. */
export interface UserThemeEdit {
  readonly reset?: boolean | undefined;
  readonly colors?: UserThemeColors | undefined;
  readonly light?: UserThemeColors | undefined;
  readonly dark?: UserThemeColors | undefined;
  readonly css?: string | undefined;
}

const mergeColors = (current: UserThemeColors, edit: UserThemeColors | undefined) => {
  const next: Record<string, string | null> = { ...current };
  for (const [role, value] of Object.entries(edit ?? {})) {
    if (value === null) delete next[role];
    else next[role] = value.toLowerCase();
  }
  return next as UserThemeColors;
};

export type UserThemeEditResult =
  | { readonly ok: true; readonly theme: UserTheme }
  | { readonly ok: false; readonly error: string };

/** Applies an edit to `current`. Refuses CSS that fails `sanitizeUserThemeCss`. */
export function applyUserThemeEdit(
  current: UserTheme,
  edit: UserThemeEdit,
  now: string,
): UserThemeEditResult {
  const base = edit.reset === true ? EMPTY_USER_THEME : current;
  let css = base.css;
  if (edit.css !== undefined) {
    const checked = sanitizeUserThemeCss(edit.css);
    if (!checked.ok) return { ok: false, error: checked.error };
    css = checked.css;
  }
  return {
    ok: true,
    theme: {
      colors: mergeColors(base.colors, edit.colors),
      light: mergeColors(base.light, edit.light),
      dark: mergeColors(base.dark, edit.dark),
      css,
      updatedAt: now,
    },
  };
}

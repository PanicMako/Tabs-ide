import { EMPTY_USER_THEME } from "@tabs/contracts";
import { describe, expect, it } from "vitest";
import {
  applyUserThemeEdit,
  compileUserThemeCss,
  sanitizeUserThemeCss,
  USER_THEME_LAYER,
} from "./themeCss.ts";

const refused = (css: string) => expect(sanitizeUserThemeCss(css).ok).toBe(false);

describe("sanitizeUserThemeCss", () => {
  it("accepts plain rules and strips comments and !important", () => {
    const result = sanitizeUserThemeCss(
      '/* hi */ .chat-markdown { line-height: 1.7 !important; background: url("data:image/png;base64,AAA"); }',
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.css).not.toContain("important");
      expect(result.css).not.toContain("hi");
      expect(result.css).toContain("line-height: 1.7");
    }
  });

  it("allows media queries, #id urls and keyframes", () => {
    expect(sanitizeUserThemeCss("@media (min-width:1px){a{fill:url(#g)}}").ok).toBe(true);
    expect(sanitizeUserThemeCss("@keyframes x{from{opacity:0}to{opacity:1}}").ok).toBe(true);
  });

  it.each([
    "@import url(x.css);",
    "@IMPORT 'x.css';",
    "@font-face{font-family:a;src:url(data:font/woff2;base64,AA)}",
    "@layer base{a{color:red}}",
    "@charset 'x';",
    "a{background:url(https://evil.example/x)}",
    "a{background:url( 'https://evil.example/x')}",
    "a{background:url( data:x)}",
    "a{background:image-set('x' 1x)}",
    "a{background:-webkit-image-set('x' 1x)}",
    "a{content:src('x')}",
    "a{width:expression(1)}",
    "a{-moz-binding:url(x)}",
    "a{background:\\75rl(https://evil.example)}",
  ])("refuses %s", (css) => refused(css));

  it("refuses text that could escape the wrapping layer", () => {
    refused("a{color:red}} body{display:none}");
    refused("a{color:red");
    refused("/* unclosed a{}");
    refused('a{content:"open}');
    refused("a{content:'x\n'}");
  });

  it("does not treat braces inside strings as structure", () => {
    expect(sanitizeUserThemeCss('a::before{content:"}"}').ok).toBe(true);
  });

  it("refuses CSS over the length limit", () => {
    refused("a{}".repeat(7000));
  });
});

describe("compileUserThemeCss", () => {
  it("is empty for an empty theme", () => {
    expect(compileUserThemeCss(EMPTY_USER_THEME)).toBe("");
  });

  it("emits important palette variables and layers the CSS", () => {
    const css = compileUserThemeCss({
      ...EMPTY_USER_THEME,
      colors: { background: "#101010", primary: null },
      dark: { foreground: "#fafafa" },
      light: { foreground: "#111111" },
      css: ".chat-markdown{color:red !important}",
    });
    expect(css).toContain(":root{--background:#101010 !important;}");
    expect(css).toContain(":root.dark{--foreground:#fafafa !important;}");
    expect(css).toContain(":root:not(.dark){--foreground:#111111 !important;}");
    expect(css).toContain(`@layer ${USER_THEME_LAYER}{.chat-markdown{color:red }}`);
    expect(css).not.toContain("--primary");
  });

  it("drops unsafe CSS a hand-edited settings file smuggled in", () => {
    const css = compileUserThemeCss({ ...EMPTY_USER_THEME, css: "@import 'x.css';" });
    expect(css).toBe("");
  });
});

describe("applyUserThemeEdit", () => {
  const now = "2026-01-01T00:00:00.000Z";
  const base = { ...EMPTY_USER_THEME, colors: { background: "#111111", border: "#222222" } };

  it("merges colors, removes nulls and lowercases", () => {
    const result = applyUserThemeEdit(
      base,
      { colors: { background: "#ABCDEF", border: null }, dark: { primary: "#0e2af3" } },
      now,
    );
    expect(result).toEqual({
      ok: true,
      theme: {
        colors: { background: "#abcdef" },
        light: {},
        dark: { primary: "#0e2af3" },
        css: "",
        updatedAt: now,
      },
    });
  });

  it("resets before applying", () => {
    const result = applyUserThemeEdit(base, { reset: true, css: "a{color:red}" }, now);
    expect(result).toMatchObject({ ok: true, theme: { colors: {}, css: "a{color:red}" } });
  });

  it("refuses unsafe CSS and leaves the caller to keep the old theme", () => {
    expect(applyUserThemeEdit(base, { css: "@import 'x';" }, now)).toMatchObject({ ok: false });
  });
});

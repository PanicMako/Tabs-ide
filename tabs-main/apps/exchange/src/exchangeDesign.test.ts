import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Exchange visual constraints", () => {
  it("bundles the editorial font pairing without a decorative homepage illustration", () => {
    const layout = readFileSync(
      new URL("../frontend/src/layouts/Exchange.astro", import.meta.url),
      "utf8",
    );
    const home = readFileSync(
      new URL("../frontend/src/pages/index.astro", import.meta.url),
      "utf8",
    );
    expect(layout).toContain('import "@fontsource-variable/dm-sans"');
    expect(layout).toContain('import "@fontsource/instrument-serif/400-italic.css"');
    expect(home).not.toContain("workspace-art");
    expect(home).not.toContain('role="img"');
    expect(home).toContain('aria-label="Search the extension marketplace"');
    expect(home).toContain('action="/extensions"');
  });
  it("styles native publishing controls and identifies the current account section", () => {
    const css = readFileSync(
      new URL("../frontend/src/styles/exchange.css", import.meta.url),
      "utf8",
    );
    const layout = readFileSync(
      new URL("../frontend/src/layouts/Exchange.astro", import.meta.url),
      "utf8",
    );
    expect(css).toContain("button:not(.button)");
    expect(css).toContain("input::file-selector-button");
    expect(css).toContain("#review-content > section");
    expect(layout).toContain('aria-current={active === "account" ? "page" : undefined}');
  });
  it("uses the distributed CLI executable in token instructions", () => {
    const cli = JSON.parse(
      readFileSync(
        new URL("../../../packages/extension-cli/package.json", import.meta.url),
        "utf8",
      ),
    ) as { bin: Record<string, string> };
    const source = readFileSync(
      new URL("../frontend/src/scripts/tokens.ts", import.meta.url),
      "utf8",
    );
    expect(Object.keys(cli.bin)).toContain("tabsext");
    expect(source).toContain("tabsext search --registry");
    expect(source).toContain("tabsext publish my-tool.tabsext --registry");
    expect(source).not.toContain("tabs-extension search");
    expect(source).not.toContain("tabs-extension publish");
  });
  it("keeps token controls labeled and the one-time secret initially hidden", () => {
    const source = readFileSync(
      new URL("../frontend/src/pages/account/tokens.astro", import.meta.url),
      "utf8",
    );
    for (const id of ["token-label", "token-scope", "token-namespace", "token-secret"])
      expect(source).toContain(`for="${id}"`);
    expect(source).toContain('aria-labelledby="token-create-title"');
    expect(source).toContain('aria-describedby="token-namespace-help"');
    expect(source).toContain('id="token-secret-section" hidden');
    expect(source).toContain('id="token-create-button" type="submit" disabled');
    expect(source).toContain('id="token-status" role="status" aria-live="polite"');
  });
  it("preserves one prerequisite-gated publishing form and keyboard file selection", () => {
    const source = readFileSync(
      new URL("../frontend/src/pages/publish.astro", import.meta.url),
      "utf8",
    );
    expect([...source.matchAll(/<form\b/g)]).toHaveLength(1);
    expect([...source.matchAll(/<\/form>/g)]).toHaveLength(1);
    expect(source).toContain('<fieldset id="publish-fields" disabled>');
    expect(source).toContain('type="file" accept=".tabsext"');
    expect(source).toContain('aria-describedby="publish-file-help"');
    expect(source).toContain('aria-labelledby="publication-guide-title"');
    expect(source).toContain("Approval alone does not publish a package.");
  });
  it("uses one corner token and no gradient surfaces", () => {
    const css = readFileSync(
      new URL("../frontend/src/styles/exchange.css", import.meta.url),
      "utf8",
    );
    const home = readFileSync(
      new URL("../frontend/src/pages/index.astro", import.meta.url),
      "utf8",
    );
    expect(css).toContain("--radius: 28px;");
    expect(css).toContain("--control-radius: 999px;");
    for (const source of [css, home]) {
      expect(source).not.toMatch(/(?:linear|radial|conic)-gradient\s*\(/i);
      const corners = [...source.matchAll(/border-radius:\s*([^;]+);/g)];
      expect(corners.length).toBeGreaterThan(0);
      for (const corner of corners)
        expect(["var(--radius)", "var(--control-radius)"]).toContain(corner[1]);
    }
  });
  it("keeps the deferred game out of both website layouts", () => {
    for (const path of [
      "../frontend/src/layouts/Exchange.astro",
      "../../marketing/src/components/FooterSignature.astro",
    ]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source).not.toMatch(/import (?:WorkspaceRunner|ToolPuzzle) /);
      expect(source).not.toMatch(/<(?:WorkspaceRunner|ToolPuzzle)\b/);
    }
  });
});

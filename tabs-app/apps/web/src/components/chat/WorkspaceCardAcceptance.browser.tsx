import "../../index.css";
import { ThreadId } from "@tabs/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ChatHeader } from "./ChatHeader";

vi.mock("~/connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({
    git: {
      listBranches: async () => ({ branches: [] }),
      watchedBranchStatuses: async () => ({ branches: [] }),
    },
  }),
}));

vi.mock("../ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("../GitActionsControl", () => ({ default: () => <button>Commit &amp; push</button> }));
vi.mock("./OpenInPicker", () => ({ OpenInPicker: () => <button>Open in editor</button> }));
vi.mock("~/state/vcs", () => ({
  useVcs: () => ({
    status: { branch: "feature/design", workingTree: { insertions: 12, deletions: 3 } },
    error: null,
  }),
}));

const scripts = Array.from({ length: 15 }, (_, index) => ({
  id: `script-${index + 1}`,
  name: `Workspace action ${String(index + 1).padStart(2, "0")}`,
  command: `bun run action:${index + 1}`,
  icon: "play" as const,
  runOnWorktreeCreate: false,
}));

function AcceptanceHarness({
  paneWidth,
  paneHeight,
  isSplitActive,
}: {
  paneWidth: number;
  paneHeight: number;
  isSplitActive: boolean;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <div
        data-chat-pane
        style={{ position: "relative", width: paneWidth, height: paneHeight, overflow: "hidden" }}
      >
        <header style={{ position: "relative" }}>
          <ChatHeader
            activeThreadId={ThreadId.makeUnsafe("workspace-card-acceptance")}
            activeThreadTitle="Workspace card acceptance"
            activeProjectName="Tabs"
            isGitRepo
            isSplitActive={isSplitActive}
            openInCwd="/repo/tabs"
            keybindings={[]}
            availableEditors={[]}
            terminalAvailable
            terminalOpen={false}
            terminalToggleShortcutLabel={null}
            diffToggleShortcutLabel={null}
            gitCwd="/repo/tabs"
            diffOpen={false}
            onToggleTerminal={() => {}}
            onToggleDiff={() => {}}
            scripts={scripts}
            onRunScript={() => {}}
          />
        </header>
      </div>
    </QueryClientProvider>
  );
}

it("keeps the workspace card legible and keyboard reachable across pane, theme, and density states", async () => {
  const devtools = cdp() as unknown as {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  };
  const originalViewport = { width: window.innerWidth, height: window.innerHeight };
  const originalClassName = document.documentElement.className;
  const originalTheme = document.documentElement.getAttribute("data-theme");
  const rootStyle = document.documentElement.style;
  const themeTokens = ["--background", "--card", "--foreground", "--border"] as const;
  const originalTokens = new Map(
    themeTokens.map((token) => [token, rootStyle.getPropertyValue(token)]),
  );
  const themeColors = new Map<string, string>();
  const scenarios = [
    {
      name: "wide-dark",
      viewport: [1440, 920] as const,
      pane: [1260, 880] as const,
      pageScaleFactor: 1,
      split: false,
      theme: "dark" as const,
      density: "full",
      reducedMotion: false,
    },
    {
      name: "split-light",
      viewport: [1280, 760] as const,
      pane: [560, 720] as const,
      pageScaleFactor: 1.25,
      split: true,
      theme: "light" as const,
      density: "compact",
      reducedMotion: false,
    },
    {
      name: "narrow-light",
      viewport: [430, 520] as const,
      pane: [398, 500] as const,
      pageScaleFactor: 1.5,
      split: true,
      theme: "light" as const,
      density: "essential",
      reducedMotion: false,
    },
    {
      name: "reduced-motion-dark",
      viewport: [1280, 800] as const,
      pane: [1120, 760] as const,
      pageScaleFactor: 1.25,
      split: true,
      theme: "dark" as const,
      density: "compact",
      reducedMotion: true,
    },
  ];

  try {
    for (const scenario of scenarios) {
      await page.viewport(scenario.viewport[0], scenario.viewport[1]);
      await devtools.send("Emulation.setPageScaleFactor", {
        pageScaleFactor: scenario.pageScaleFactor,
      });
      await devtools.send("Emulation.setEmulatedMedia", {
        features: [
          {
            name: "prefers-reduced-motion",
            value: scenario.reducedMotion ? "reduce" : "no-preference",
          },
        ],
      });
      expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(
        scenario.reducedMotion === true,
      );
      const pageMetrics = (await devtools.send("Page.getLayoutMetrics")) as {
        visualViewport: { scale: number };
      };
      expect(pageMetrics.visualViewport.scale).toBeCloseTo(scenario.pageScaleFactor, 1);
      document.documentElement.className =
        scenario.theme === "dark"
          ? `${originalClassName} dark`.trim()
          : originalClassName.replace(/\bdark\b/g, "").trim();
      document.documentElement.setAttribute(
        "data-theme",
        scenario.theme === "dark" ? "tabs-dark" : "tabs-monotone-light",
      );
      const tokens =
        scenario.theme === "dark"
          ? {
              "--background": "#141414",
              "--card": "#181818",
              "--foreground": "#f5f5f5",
              "--border": "rgba(255, 255, 255, 0.06)",
            }
          : {
              "--background": "#eeeeee",
              "--card": "#fafafa",
              "--foreground": "#242424",
              "--border": "rgba(0, 0, 0, 0.12)",
            };
      for (const [token, value] of Object.entries(tokens)) rootStyle.setProperty(token, value);
      const view = await render(
        <AcceptanceHarness
          paneWidth={scenario.pane[0]}
          paneHeight={scenario.pane[1]}
          isSplitActive={scenario.split}
        />,
      );
      try {
        const toggle = page.getByRole("button", { name: "Toggle workspace actions" });
        if (toggle.element().getAttribute("aria-expanded") !== "true") await toggle.click();
        const card = document.querySelector<HTMLElement>('[aria-label="Workspace actions"]')!;
        await expect.poll(() => card.dataset.density).toBe(scenario.density);
        await expect.element(page.getByRole("region", { name: "Workspace actions" })).toBeVisible();
        expect(card.className).toContain("motion-reduce:animate-none");
        if (scenario.reducedMotion) expect(getComputedStyle(card).animationName).toBe("none");
        expect(
          [...document.styleSheets].some((sheet) => {
            try {
              return [...sheet.cssRules].some(
                (rule) =>
                  rule.cssText.includes("prefers-reduced-motion") &&
                  rule.cssText.includes("workspace-card"),
              );
            } catch {
              return false;
            }
          }),
        ).toBe(true);
        expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);

        const pane = document.querySelector<HTMLElement>("[data-chat-pane]")!;
        const cardRect = card.getBoundingClientRect();
        const paneRect = pane.getBoundingClientRect();
        expect(cardRect.right).toBeLessThanOrEqual(paneRect.right + 1);
        expect(
          cardRect.bottom,
          JSON.stringify({
            scenario: scenario.name,
            cardRect,
            paneRect,
            viewport: [window.innerWidth, window.innerHeight],
          }),
        ).toBeLessThanOrEqual(paneRect.bottom + 1);
        const cardStyle = getComputedStyle(card);
        expect(cardStyle.backgroundImage).toContain("linear-gradient");
        themeColors.set(scenario.theme, cardStyle.getPropertyValue("--background").trim());
        expect(themeColors.get(scenario.theme)).not.toBe("");

        await page.screenshot({
          element: card,
          path: `../../../../../.logs/t3-parity-release-audit-2026-10-29/visual/workspace-card-${scenario.name}.png`,
        });

        if (scenario.name === "narrow-light") {
          const lastScript = page.getByRole("button", {
            name: "Run Workspace action 15",
            exact: true,
          });
          let reachedLastScript = false;
          for (let tab = 0; tab < 48; tab++) {
            await userEvent.tab();
            if (document.activeElement === lastScript.element()) {
              reachedLastScript = true;
              break;
            }
          }
          expect(reachedLastScript).toBe(true);
          const scriptList = document.querySelector<HTMLElement>('[aria-label="Project scripts"]')!;
          const scriptRect = scriptList.getBoundingClientRect();
          const focusedRect = lastScript.element().getBoundingClientRect();
          expect(focusedRect.top).toBeGreaterThanOrEqual(scriptRect.top - 1);
          expect(focusedRect.bottom).toBeLessThanOrEqual(scriptRect.bottom + 1);
          expect(getComputedStyle(lastScript.element()).outlineStyle).not.toBe("none");
          await userEvent.keyboard("{Escape}");
          await expect
            .element(page.getByRole("region", { name: "Workspace actions" }))
            .not.toBeInTheDocument();
          expect(document.activeElement).toBe(toggle.element());
        }
      } finally {
        await view.unmount();
      }
    }
    expect(themeColors.get("dark")).not.toBe(themeColors.get("light"));
  } finally {
    await devtools.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await devtools.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
    });
    document.documentElement.className = originalClassName;
    if (originalTheme === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", originalTheme);
    for (const [token, value] of originalTokens) {
      if (value) rootStyle.setProperty(token, value);
      else rootStyle.removeProperty(token);
    }
    await page.viewport(originalViewport.width, originalViewport.height);
  }
});

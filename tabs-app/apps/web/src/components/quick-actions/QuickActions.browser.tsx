import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../index.css";
import { LauncherSurface } from "./QuickActions";
import { LAUNCHER_DESIGNS, QUICK_ACTIONS, orderedActions } from "./actions";

for (const design of LAUNCHER_DESIGNS) {
  it(`${design.name} runs the shared action and exposes an accessible search`, async () => {
    const execute = vi.fn(async () => {});
    await render(
      <LauncherSurface
        design={design.id}
        actions={QUICK_ACTIONS}
        execute={execute}
        disabled={() => undefined}
        preview
      />,
    );
    await page.getByRole("button", { name: /New workspace tab/ }).click();
    expect(execute).toHaveBeenCalledWith("new-tab", "");
    await page.getByRole("button", { name: /Search the web/ }).click();
    await page.getByRole("textbox").fill("some documentation query");
    await page.getByRole("button", { name: /Search the web/ }).click();
    expect(execute).toHaveBeenLastCalledWith("search", "some documentation query");
  });
}
it("shows action errors and respects unavailable workspace actions", async () => {
  await render(
    <LauncherSurface
      design="compass"
      actions={QUICK_ACTIONS}
      execute={async () => {
        throw new Error("Workspace disconnected");
      }}
      disabled={(id) => (id === "new-agent" ? "Open a project first" : undefined)}
      preview
    />,
  );
  await expect.element(page.getByRole("button", { name: /New conversation/ })).toBeDisabled();
  await page.getByRole("button", { name: /New workspace tab/ }).click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("Workspace disconnected");
});
it("keeps secondary actions in one More group without page navigation or duplicates", async () => {
  const execute = vi.fn(async () => {});
  await render(
    <LauncherSurface
      design="compass"
      actions={QUICK_ACTIONS}
      execute={execute}
      disabled={() => undefined}
      preview
    />,
  );
  await page.getByRole("button", { name: "More actions" }).click();
  await expect.element(page.getByRole("button", { name: /Usage & limits/ })).toBeVisible();
  expect(document.querySelectorAll('[aria-label="Source control"]')).toHaveLength(1);
  expect(document.querySelectorAll(".qa-radial-surface button")).toHaveLength(
    QUICK_ACTIONS.length + 1,
  );
  await page.getByRole("button", { name: /Usage & limits/ }).click();
  expect(execute).toHaveBeenCalledWith("usage", "");
});
it("rotates keyboard focus and opens More sub-options", async () => {
  const execute = vi.fn(async () => {});
  await render(
    <LauncherSurface
      design="compass"
      actions={QUICK_ACTIONS}
      execute={execute}
      disabled={() => undefined}
      preview
    />,
  );
  await page.getByRole("button", { name: /New workspace tab/ }).click();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByRole("button", { name: /New conversation/ })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(execute).toHaveBeenCalledWith("new-agent", "");
  await page.getByRole("button", { name: "More actions" }).click();
  await userEvent.keyboard("{ArrowDown}");
  await expect
    .element(page.getByRole("button", { name: "Return to code", exact: true }))
    .toHaveFocus();
});
it("uses one theme accent on a themed plate instead of per-action colours", async () => {
  await render(
    <LauncherSurface
      design="sectors"
      actions={QUICK_ACTIONS}
      execute={async () => {}}
      disabled={() => undefined}
      preview
    />,
  );
  const surface = document.querySelector<HTMLElement>(".qa-radial-surface")!;
  const angle = surface.style.getPropertyValue("--qa-angle");
  await page.getByRole("button", { name: /Temporary browser/ }).hover();
  // The selection indicator moved; the accent is the theme's, not the action's.
  expect(surface.style.getPropertyValue("--qa-angle")).not.toBe(angle);
  expect(surface.style.getPropertyValue("--qa-action-color")).toBe("");
  expect(getComputedStyle(surface).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  const plate = getComputedStyle(document.querySelector(".qa-radial-disc")!);
  expect(plate.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
});

it("reveals browser sub-actions and runs their configured URL without a center caret", async () => {
  const execute = vi.fn(async () => {});
  await render(
    <LauncherSurface
      design="compass"
      actions={QUICK_ACTIONS}
      execute={execute}
      disabled={() => undefined}
      preview
    />,
  );
  expect(document.querySelector(".qa-radial-hub input")).toBeNull();
  expect(document.querySelector(".qa-radial-close")).toBeNull();
  await page.getByRole("button", { name: "Temporary browser", exact: true }).hover();
  await page.getByRole("button", { name: "Google", exact: true }).click();
  expect(execute).toHaveBeenCalledWith("scratch-browser", "https://www.google.com");
});
it("uses custom sub-actions in saved order", async () => {
  const execute = vi.fn(async () => {});
  await render(
    <LauncherSurface
      design="compass"
      actions={QUICK_ACTIONS}
      execute={execute}
      disabled={() => undefined}
      subActions={[
        {
          id: "docs",
          parentId: "scratch-browser",
          actionId: "scratch-browser",
          label: "Team docs",
          query: "https://example.com/docs",
        },
      ]}
      preview
    />,
  );
  await page.getByRole("button", { name: "Temporary browser", exact: true }).hover();
  await page.getByRole("button", { name: "Team docs", exact: true }).click();
  expect(execute).toHaveBeenCalledWith("scratch-browser", "https://example.com/docs");
});

it("keeps More options in a compact fan beside their parent", async () => {
  await render(
    <LauncherSurface
      design="compass"
      actions={QUICK_ACTIONS}
      execute={async () => {}}
      disabled={() => undefined}
      preview
    />,
  );
  await page.getByRole("button", { name: "More actions" }).click();
  const parent = document.querySelector<HTMLElement>('[aria-label="More actions"]')!;
  const px = Number.parseFloat(parent.style.left) - 280,
    py = Number.parseFloat(parent.style.top) - 280;
  const panel = document.querySelector<HTMLElement>(".qa-sub-panel")!;
  const cx = Number.parseFloat(panel.style.left) - 280;
  // Beside the plate, on the same side as its parent.
  expect(Math.abs(cx)).toBeCloseTo(178, 0);
  expect(Math.sign(cx)).toBe(px < -8 ? -1 : 1);
  void py;
});
it("searches using a chosen engine while keeping browser shortcuts separate", async () => {
  const execute = vi.fn(async () => {});
  await render(
    <LauncherSurface
      design="compass"
      actions={QUICK_ACTIONS}
      execute={execute}
      disabled={() => undefined}
      preview
    />,
  );
  await page.getByRole("button", { name: "Search the web", exact: true }).hover();
  await page.getByRole("button", { name: "DuckDuckGo", exact: true }).click();
  await page.getByRole("textbox").fill("tabs editor");
  await userEvent.keyboard("{Enter}");
  expect(execute).toHaveBeenCalledWith("search", "https://duckduckgo.com/?q=tabs%20editor");
});

it("provides adequate spacing between subactions preventing overlap", async () => {
  await render(
    <LauncherSurface
      design="compass"
      actions={QUICK_ACTIONS}
      execute={async () => {}}
      disabled={() => undefined}
      preview
    />,
  );
  await page.getByRole("button", { name: /New workspace tab/ }).hover();
  const browserBtn = document.querySelector<HTMLButtonElement>(
    '.qa-more-action[data-sub-index="0"]',
  )!;
  const terminalBtn = document.querySelector<HTMLButtonElement>(
    '.qa-more-action[data-sub-index="1"]',
  )!;
  expect(browserBtn).not.toBeNull();
  expect(terminalBtn).not.toBeNull();
  const b1 = browserBtn.getBoundingClientRect();
  const b2 = terminalBtn.getBoundingClientRect();
  // Stacked one under the other, with clear space between them.
  expect(b1.bottom).toBeLessThan(b2.top);
});

it("renders AssistantBubbleIcon for agent and BrowserPlanetIcon for browser", async () => {
  await render(
    <LauncherSurface
      design="compass"
      actions={QUICK_ACTIONS}
      execute={async () => {}}
      disabled={() => undefined}
      preview
    />,
  );
  const agentBtn = document.querySelector<HTMLButtonElement>('[aria-label*="New conversation"]')!;
  const browserBtn = document.querySelector<HTMLButtonElement>(
    '[aria-label*="Temporary browser"]',
  )!;
  expect(agentBtn.querySelector(".tool-assistant-gaze")).not.toBeNull();
  expect(browserBtn.querySelector(".tool-planet-ring")).not.toBeNull();
});

it("opens the search panel allowing direct URL entry and Go submission", async () => {
  const execute = vi.fn(async () => {});
  await render(
    <LauncherSurface
      design="compass"
      actions={QUICK_ACTIONS}
      execute={execute}
      disabled={() => undefined}
      preview
    />,
  );
  await page.getByRole("button", { name: "Search the web", exact: true }).click();
  const searchPanel = document.querySelector(".qa-search-panel");
  expect(searchPanel).not.toBeNull();
  expect(document.querySelector(".qa-radial-disc")).toBeNull();
  await page.getByRole("textbox").fill("github.com");
  await page.getByRole("button", { name: "Submit search" }).click();
  expect(execute).toHaveBeenCalledWith("search", "github.com");
});

it("keeps every sub-action label on one line, growing outward from the ring", async () => {
  for (const design of ["sectors", "compass"] as const) {
    const view = await render(
      <LauncherSurface
        design={design}
        actions={QUICK_ACTIONS}
        execute={vi.fn(async () => {})}
        disabled={() => undefined}
        preview
      />,
    );
    await page.getByRole("button", { name: "More actions" }).click();
    const pills = [...document.querySelectorAll<HTMLElement>(".qa-more-action")];
    expect(pills.length).toBeGreaterThan(0);
    const center = document.querySelector(".qa-radial-canvas")!.getBoundingClientRect();
    const cx = center.left + center.width / 2;
    const cy = center.top + center.height / 2;
    for (const pill of pills) {
      expect(getComputedStyle(pill).whiteSpace).toBe("nowrap");
      const rect = pill.getBoundingClientRect();
      // One line tall, and no part of the pill is inside the action ring.
      expect(rect.height).toBeLessThan(40);
      const nearest = Math.hypot(
        Math.max(rect.left - cx, 0, cx - rect.right),
        Math.max(rect.top - cy, 0, cy - rect.bottom),
      );
      expect(nearest).toBeGreaterThan(140 * (center.width / 560));
    }
    await page.screenshot({
      element: document.querySelector<HTMLElement>(".qa-radial-surface")!,
      path: `__screenshots__/quick-actions/${design}-more.png`,
    });
    await view.unmount();
  }
});

it("puts only the mascot at the centre and looks towards the selection", async () => {
  await render(
    <LauncherSurface
      design="compass"
      actions={QUICK_ACTIONS}
      execute={async () => {}}
      disabled={() => undefined}
      preview
    />,
  );
  const hub = document.querySelector<HTMLElement>(".qa-radial-hub")!;
  expect(hub.querySelector(".tabs-mascot")).not.toBeNull();
  expect(hub.querySelector(".qa-hub-label")).toBeNull();
  const eyes = hub.querySelector<SVGGElement>(".tabs-mascot-eyes")!;
  const before = eyes.style.transform;
  await page.getByRole("button", { name: "Temporary terminal", exact: true }).hover();
  expect(eyes.style.transform).not.toBe(before);
});

it("keeps the search engines underneath the query and looks like glass", async () => {
  await page.viewport(1000, 720);
  const view = await render(
    <div
      style={{
        width: 1000,
        height: 720,
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(120deg, #1d4ed8, #db2777 55%, #f59e0b)",
      }}
    >
      <div style={{ padding: "0 78px" }}>
        <LauncherSurface
          design="compass"
          actions={QUICK_ACTIONS}
          execute={async () => {}}
          disabled={() => undefined}
          preview
        />
      </div>
    </div>,
  );
  await page.getByRole("button", { name: "Temporary browser", exact: true }).hover();
  await new Promise((resolve) => setTimeout(resolve, 400));
  await page.screenshot({
    element: view.container,
    path: "__screenshots__/quick-actions/glass-orbit.png",
  });
  await page.getByRole("button", { name: "Search the web", exact: true }).click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const input = document.querySelector(".qa-search-input-row")!.getBoundingClientRect();
  const engines = document.querySelector(".qa-search-engines")!.getBoundingClientRect();
  expect(engines.top).toBeGreaterThanOrEqual(input.bottom);
  expect(getComputedStyle(document.querySelector(".qa-search-panel")!).backdropFilter).toContain(
    "blur",
  );
  await page.screenshot({
    element: view.container,
    path: "__screenshots__/quick-actions/glass-search.png",
  });
  await view.unmount();
});

it("runs a custom action with its own saved input", async () => {
  const execute = vi.fn(async () => {});
  await render(
    <LauncherSurface
      design="compass"
      actions={orderedActions(
        ["custom:tests", "custom:gh"],
        [],
        [
          {
            id: "custom:tests",
            label: "Run tests",
            icon: "flask",
            actionId: "scratch-terminal",
            query: "bun run test",
          },
          {
            id: "custom:gh",
            label: "Search GitHub",
            icon: "search",
            actionId: "search",
            query: "https://github.com/search?q={query}",
          },
        ],
      )}
      execute={execute}
      disabled={() => undefined}
      preview
    />,
  );
  await page.getByRole("button", { name: "Run tests", exact: true }).click();
  expect(execute).toHaveBeenLastCalledWith("scratch-terminal", "bun run test");
  await page.getByRole("button", { name: "Search GitHub", exact: true }).click();
  await page.getByRole("textbox").fill("tabs");
  await userEvent.keyboard("{Enter}");
  expect(execute).toHaveBeenLastCalledWith("search", "https://github.com/search?q=tabs");
});

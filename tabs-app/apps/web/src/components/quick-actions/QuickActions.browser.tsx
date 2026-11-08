import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../index.css";
import { LauncherSurface } from "./QuickActions";
import { LAUNCHER_DESIGNS, QUICK_ACTIONS } from "./actions";

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
      design="dial"
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
    .element(page.getByRole("button", { name: "Pop out chat", exact: true }))
    .toHaveFocus();
});
it("uses the action color and keeps the radial surface transparent", async () => {
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
  const before = surface.style.getPropertyValue("--qa-action-color");
  await page.getByRole("button", { name: /Temporary browser/ }).hover();
  expect(surface.style.getPropertyValue("--qa-action-color")).not.toBe(before);
  expect(getComputedStyle(surface).backgroundColor).toBe("rgba(0, 0, 0, 0)");
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
      design="dial"
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
  for (const child of document.querySelectorAll<HTMLElement>(".qa-more-action")) {
    const cx = Number.parseFloat(child.style.left) - 280,
      cy = Number.parseFloat(child.style.top) - 280;
    expect(Math.hypot(cx, cy)).toBeCloseTo(206, 0);
    expect(px * cx + py * cy).toBeGreaterThan(0);
  }
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
  // Ensure the buttons do not overlap horizontally
  expect(b1.right).toBeLessThan(b2.left);
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
  await page.getByRole("textbox").fill("github.com");
  await page.getByRole("button", { name: "Submit search" }).click();
  expect(execute).toHaveBeenCalledWith("search", "github.com");
});

it("wraps sector labels inside the narrow side wedges", async () => {
  await render(
    <LauncherSurface
      design="sectors"
      actions={QUICK_ACTIONS}
      execute={vi.fn(async () => {})}
      disabled={() => undefined}
      preview
    />,
  );
  await page.getByRole("button", { name: "More actions" }).click();
  const source = document.querySelector<HTMLElement>(
    '.qa-more-action[aria-label="Source control"]',
  );
  const label = source?.querySelector("span");
  expect(source).toBeTruthy();
  expect(label?.textContent).toBe("Source control");
  expect(getComputedStyle(source!).whiteSpace).toBe("normal");
  expect(source!.scrollWidth).toBeLessThanOrEqual(source!.clientWidth);
  expect(label!.scrollHeight).toBeLessThanOrEqual(label!.clientHeight);
  expect(label!.clientHeight).toBeLessThanOrEqual(
    Math.ceil(2 * parseFloat(getComputedStyle(label!).lineHeight)),
  );
});

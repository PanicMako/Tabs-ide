import "../../../index.css";
import "./designs/designs.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { CompanionDiffPanel } from "./CompanionDiffPanel";
const api = vi.hoisted(() => ({
  diff: vi.fn(async () => ({
    patch:
      "diff --git a/src/demo.ts b/src/demo.ts\nindex 1111111..2222222 100644\n--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1 +1,2 @@\n-old\n+new\n+extra\n",
  })),
}));
vi.mock("~/hooks/useActiveProjectTarget", () => ({
  useActiveProjectTarget: () => ({
    projectId: "project",
    projectName: "Project",
    cwd: "/workspace",
    environmentId: "environment",
  }),
}));
vi.mock("~/lib/gitReactQuery", () => ({
  gitDiffQueryOptions: () => ({ queryKey: ["compact-diff-test"], queryFn: api.diff }),
}));
vi.mock("~/components/DiffPanel", () => ({ default: () => <p>Completed turn changes</p> }));
it("lists changed files beside their diffs and keeps layout, wrap, refresh and turns", async () => {
  api.diff.mockClear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <div
        data-companion-design="grouped"
        className="companion-frame"
        style={{ width: 720, height: 600 }}
      >
        <CompanionDiffPanel />
      </div>
    </QueryClientProvider>,
  );
  try {
    const row = page.getByRole("button", { name: /demo\.ts/ });
    await expect.element(row).toBeVisible();
    await expect.element(row).toHaveTextContent("+2");
    await expect.element(row).toHaveTextContent("−1");
    await expect
      .poll(() =>
        document.querySelector("diffs-container")?.shadowRoot?.textContent?.includes("extra"),
      )
      .toBe(true);
    // Jumping to a file scrolls only the diff column, never the panel around it.
    await row.click();
    expect(document.querySelector<HTMLElement>(".companion-frame")!.scrollTop).toBe(0);
    await page.getByRole("button", { name: "Side by side" }).click();
    await expect
      .element(page.getByRole("button", { name: "Side by side" }))
      .toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Wrap long lines" }).click();
    await expect
      .element(page.getByRole("button", { name: "Wrap long lines" }))
      .toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Refresh changes" }).click();
    await expect.poll(() => api.diff.mock.calls.length).toBe(2);
    await page.getByRole("tab", { name: "By agent turn" }).click();
    await expect.element(page.getByText("Completed turn changes")).toBeVisible();
    expect(page.getByRole("button", { name: "Refresh changes" }).query()).toBeNull();
    await page.getByRole("tab", { name: "Working tree" }).click();
    await expect.element(page.getByRole("button", { name: /demo\.ts/ })).toBeVisible();
  } finally {
    await view.unmount();
    client.clear();
  }
});

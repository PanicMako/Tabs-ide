import "../../../index.css";
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
it("keeps diff controls compact while retaining refresh, layout and turn selection", async () => {
  api.diff.mockClear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <CompanionDiffPanel />
    </QueryClientProvider>,
  );
  try {
    await expect.element(page.getByRole("heading", { name: "src/demo.ts" })).toBeVisible();
    await expect
      .poll(() =>
        document.querySelector("diffs-container")?.shadowRoot?.textContent?.includes("extra"),
      )
      .toBe(true);
    expect(document.querySelector(".companion-heading")).toBeNull();
    expect(document.querySelectorAll(".companion-toolbar")).toHaveLength(1);
    expect(
      document.querySelector(".companion-diff-toolbar")!.getBoundingClientRect().height,
    ).toBeLessThanOrEqual(46);
    await expect.element(page.getByLabelText("1 removed lines")).toHaveTextContent("−1");
    await expect.element(page.getByLabelText("2 added lines")).toHaveTextContent("+2");
    await page.getByRole("button", { name: "Switch to split diff" }).click();
    await expect
      .element(page.getByRole("button", { name: "Switch to unified diff" }))
      .toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Refresh changes" }).click();
    await expect.poll(() => api.diff.mock.calls.length).toBe(2);
    await page.getByRole("button", { name: "Agent turns", exact: true }).click();
    await expect.element(page.getByText("Completed turn changes")).toBeVisible();
    expect(page.getByRole("button", { name: "Refresh changes" }).query()).toBeNull();
    await page.getByRole("button", { name: "Working tree", exact: true }).click();
    await expect.element(page.getByRole("heading", { name: "src/demo.ts" })).toBeVisible();
  } finally {
    await view.unmount();
    client.clear();
  }
});

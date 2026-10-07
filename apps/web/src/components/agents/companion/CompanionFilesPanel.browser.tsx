import "../../../index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { CompanionFilesPanel } from "./CompanionFilesPanel";

const api = vi.hoisted(() => ({
  searchEntries: vi.fn(),
  readFile: vi.fn(),
  setActiveTool: vi.fn(),
  setCodeFocusedPath: vi.fn(),
}));
vi.mock("~/hooks/useActiveProjectTarget", () => ({
  useActiveProjectTarget: () => ({
    projectId: "project",
    projectName: "Project",
    cwd: "/workspace",
    environmentId: "environment",
  }),
}));
vi.mock("~/connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({ projects: api }),
}));
vi.mock("~/workspaceShellStore", () => ({
  useWorkspaceShellStore: { getState: () => api },
}));

it("searches beyond the initial results and reads a file within Agents", async () => {
  api.searchEntries.mockReset().mockImplementation(async ({ query }) => ({
    entries: query === "deep" ? [{ path: "src/deep.ts", kind: "file" }] : [],
    truncated: query !== "deep",
  }));
  api.readFile.mockReset().mockResolvedValue({
    relativePath: "src/deep.ts",
    contents: "export const answer = 42;",
    byteLength: 25,
    truncated: false,
  });
  api.setActiveTool.mockClear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <CompanionFilesPanel />
    </QueryClientProvider>,
  );
  try {
    await page.getByRole("textbox", { name: "Search project files" }).fill("deep");
    await page.getByRole("button", { name: /deep\.ts/ }).click();
    await expect
      .element(page.getByLabelText("Contents of src/deep.ts"))
      .toHaveTextContent("export const answer = 42;");
    expect(api.searchEntries).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/workspace", query: "deep", kind: "file" }),
    );
    expect(api.readFile).toHaveBeenCalledWith({ cwd: "/workspace", relativePath: "src/deep.ts" });
    expect(api.setActiveTool).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Back to files" }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Search project files" }))
      .toHaveValue("deep");
  } finally {
    await view.unmount();
    client.clear();
  }
});

it("shows a failed file read and lets the user retry it", async () => {
  api.searchEntries
    .mockReset()
    .mockResolvedValue({ entries: [{ path: "README.md", kind: "file" }], truncated: false });
  api.readFile.mockReset().mockRejectedValueOnce(new Error("File unavailable")).mockResolvedValue({
    relativePath: "README.md",
    contents: "Recovered contents",
    byteLength: 18,
    truncated: false,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <CompanionFilesPanel />
    </QueryClientProvider>,
  );
  try {
    await page.getByRole("button", { name: "README.md", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("File unavailable");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect
      .element(page.getByLabelText("Contents of README.md"))
      .toHaveTextContent("Recovered contents");
  } finally {
    await view.unmount();
    client.clear();
  }
});

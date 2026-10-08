import "../../../index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { CompanionFilesPanel } from "./CompanionFilesPanel";

const api = vi.hoisted(() => ({
  listEntries: vi.fn(async (_input?: { cwd?: string; directoryPath?: string }) => ({
    entries: [{ path: "README.md", kind: "file" }],
    truncated: false,
  })),
  searchEntries: vi.fn(),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(),
  createUrl: vi.fn(),
  confirm: vi.fn(async () => false),
  setActiveTool: vi.fn(),
  setCodeFocusedPath: vi.fn(),
}));
vi.mock("~/lib/customConfirm", () => ({ showCustomConfirm: api.confirm }));
vi.mock("~/hooks/useActiveProjectTarget", () => ({
  useActiveProjectTarget: () => ({
    projectId: "project",
    projectName: "Project",
    cwd: "/workspace",
    environmentId: "environment",
  }),
}));
vi.mock("~/connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({ projects: api, assets: { createUrl: api.createUrl } }),
}));
vi.mock("~/workspaceShellStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/workspaceShellStore")>()),
  useWorkspaceShellStore: {
    getState: () => api,
    getInitialState: (await importOriginal<typeof import("~/workspaceShellStore")>())
      .useWorkspaceShellStore.getInitialState,
    subscribe: () => () => {},
  },
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
    await page.getByRole("button", { name: /^deep\.ts/ }).click();
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
    await page.getByRole("treeitem", { name: "README.md", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("File unavailable");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect
      .element(page.getByText("Recovered contents", { exact: true }))
      .toHaveTextContent("Recovered contents");
  } finally {
    await view.unmount();
    client.clear();
  }
});

it("expands real directories and saves edited source after checking the disk version", async () => {
  api.listEntries.mockReset().mockImplementation(async (input) => ({
    entries:
      input?.directoryPath === ""
        ? [{ path: "src", kind: "directory" }]
        : [{ path: "src/main.ts", kind: "file" }],
    truncated: false,
  }));
  api.readFile.mockReset().mockResolvedValue({
    relativePath: "src/main.ts",
    contents: "const value = 1;",
    byteLength: 16,
    truncated: false,
  });
  api.writeFile.mockClear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <CompanionFilesPanel />
    </QueryClientProvider>,
  );
  try {
    const directory = page.getByRole("treeitem", { name: "src", exact: true });
    await directory.click();
    await expect.element(directory).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("treeitem", { name: "main.ts", exact: true }).click();
    await page.getByRole("button", { name: "Edit file", exact: true }).click();
    await page.getByRole("textbox", { name: "Edit src/main.ts" }).fill("const value = 2;");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => api.writeFile.mock.calls.length).toBe(1);
    expect(api.writeFile).toHaveBeenCalledWith({
      cwd: "/workspace",
      relativePath: "src/main.ts",
      contents: "const value = 2;",
    });
    await expect
      .element(page.getByLabelText("Contents of src/main.ts"))
      .toHaveTextContent("const value = 2;");
    expect(api.readFile).toHaveBeenCalledTimes(2);
  } finally {
    await view.unmount();
    client.clear();
  }
});

it("opens a signed media preview without decoding the file as text", async () => {
  api.listEntries.mockResolvedValue({
    entries: [{ path: "photo.png", kind: "file" }],
    truncated: false,
  });
  api.readFile.mockClear();
  api.createUrl.mockResolvedValue({
    relativeUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/zM0AAAAASUVORK5CYII=",
    expiresAt: Date.now() + 60000,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <CompanionFilesPanel />
    </QueryClientProvider>,
  );
  try {
    await page.getByRole("treeitem", { name: "photo.png", exact: true }).click();
    await expect.element(page.getByRole("img", { name: "photo.png" })).toBeVisible();
    expect(api.createUrl).toHaveBeenCalledWith({
      resource: { _tag: "draft-workspace-file", cwd: "/workspace", path: "photo.png" },
    });
    expect(api.readFile).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    client.clear();
  }
});

it("protects edits when a background refresh changes the cached file", async () => {
  api.listEntries.mockResolvedValue({
    entries: [{ path: "README.md", kind: "file" }],
    truncated: false,
  });
  const original = {
    relativePath: "README.md",
    contents: "Original",
    byteLength: 8,
    truncated: false,
  };
  const changed = { ...original, contents: "Someone else's change" };
  api.readFile.mockReset().mockResolvedValueOnce(original).mockResolvedValue(changed);
  api.writeFile.mockClear();
  api.confirm.mockClear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <CompanionFilesPanel />
    </QueryClientProvider>,
  );
  try {
    await page.getByRole("treeitem", { name: "README.md", exact: true }).click();
    await page.getByRole("button", { name: "Edit file", exact: true }).click();
    await page.getByRole("textbox", { name: "Edit README.md", exact: true }).fill("My edit");
    const query = client
      .getQueryCache()
      .getAll()
      .find((query) => query.queryKey.includes("README.md"));
    if (!query) throw new Error("Read query missing");
    client.setQueryData(query.queryKey, changed);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => api.confirm.mock.calls.length).toBe(1);
    expect(api.writeFile).not.toHaveBeenCalled();
    await expect
      .element(page.getByRole("textbox", { name: "Edit README.md", exact: true }))
      .toHaveValue("My edit");
  } finally {
    await view.unmount();
    client.clear();
  }
});

it("keeps browsing compact and supports dragging and copying both files and folders", async () => {
  api.listEntries.mockImplementation(async ({ directoryPath } = {}) => ({
    entries: directoryPath
      ? [{ path: "src/My File.ts", kind: "file" }]
      : [{ path: "src", kind: "directory" }],
    truncated: false,
  }));
  api.readFile.mockResolvedValue({
    relativePath: "src/My File.ts",
    contents: "hello",
    byteLength: 5,
    truncated: false,
  });
  const clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const events: unknown[] = [];
  const listener = (event: Event) => events.push((event as CustomEvent).detail);
  window.addEventListener("tabs:add-workspace-file-context", listener);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <CompanionFilesPanel />
    </QueryClientProvider>,
  );
  try {
    expect(document.querySelector(".companion-heading")).toBeNull();
    expect(document.querySelectorAll(".companion-toolbar")).toHaveLength(1);
    expect(
      document.querySelector(".companion-file-search")!.getBoundingClientRect().height,
    ).toBeLessThanOrEqual(46);
    const folder = page.getByRole("treeitem", { name: "src", exact: true });
    await expect.element(folder).toBeVisible();
    const transfer = new DataTransfer();
    folder
      .element()
      .dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    expect(JSON.parse(transfer.getData("application/x-tabs-workspace-path"))).toEqual(
      expect.objectContaining({ path: "src", kind: "directory", cwd: "/workspace" }),
    );
    await page
      .getByRole("button", { name: "Copy path for src", exact: true })
      .click({ force: true });
    expect(clipboard).toHaveBeenLastCalledWith("/workspace/src");
    await folder.click();
    const file = page.getByRole("treeitem", { name: "My File.ts", exact: true });
    await file.dblClick();
    await expect.poll(() => clipboard.mock.calls.at(-1)?.[0]).toBe("/workspace/src/My File.ts");
    await page
      .getByRole("button", { name: "Add src/My File.ts to chat", exact: true })
      .click({ force: true });
    expect(events).toEqual([expect.objectContaining({ path: "src/My File.ts", kind: "file" })]);
    const fileTransfer = new DataTransfer();
    file
      .element()
      .dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: fileTransfer }));
    expect(fileTransfer.getData("text/plain")).toBe("/workspace/src/My File.ts");
  } finally {
    await view.unmount();
    client.clear();
    clipboard.mockRestore();
    window.removeEventListener("tabs:add-workspace-file-context", listener);
  }
});

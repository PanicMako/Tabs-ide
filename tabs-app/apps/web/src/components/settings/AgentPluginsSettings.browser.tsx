import "../../index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { AgentPluginsSettings } from "./AgentPluginsSettings";
import { restoreThemeSnapshot, snapshotThemeState } from "../../hooks/useTheme";
const state = vi.hoisted(() => ({
  update: vi.fn(async (_patch: unknown) => {}),
  read: vi.fn(),
  profiles: [
    {
      instanceId: "account-one",
      name: "OpenRouter Work",
      home: "/state/one",
      profileDirectory: "/state/one/profiles/acp",
      executable: "dsh",
    },
  ],
}));
vi.mock("../../state/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/settings")>()),
  useServerConfig: () => ({ deepSeekProfiles: state.profiles }),
  refreshServerConfig: async () => null,
}));
vi.mock("../../hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useSettings")>()),
  useSettings: () => ({ deepSeekPluginPatches: {} }),
  useUpdateSettings: () => ({ updateSettings: state.update }),
}));
vi.mock("../../nativeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../nativeApi")>()),
  ensureNativeApi: () => ({ projects: { readFile: state.read } }),
}));
const originalDark = document.documentElement.classList.contains("dark");
const originalTheme = snapshotThemeState();
afterEach(() => {
  restoreThemeSnapshot(originalTheme);
  document.documentElement.classList.toggle("dark", originalDark);
});
async function mount(packages: Record<string, string> = {}) {
  state.read.mockReset().mockResolvedValue({
    contents: JSON.stringify({
      dependencies: packages,
      dsh: { profile: { bundles: Object.keys(packages) } },
    }),
  });
  state.update.mockClear();
  const client = new QueryClient();
  const run = vi.fn();
  const view = await render(
    <QueryClientProvider client={client}>
      <div style={{ width: "min(1050px, 100%)", padding: 24 }}>
        <AgentPluginsSettings onRunCommand={run} />
      </div>
    </QueryClientProvider>,
  );
  return {
    view,
    run,
    cleanup: async () => {
      await view.unmount();
      client.clear();
    },
  };
}

it("puts the plugin list and one add action first, with help and configuration out of the main flow", async () => {
  const fixture = await mount();
  try {
    await expect
      .element(page.getByRole("heading", { name: "DeepSeek agent plugins", exact: true }))
      .toBeVisible();
    await expect.element(page.getByRole("heading", { name: "No plugins added yet" })).toBeVisible();
    expect(fixture.view.container.querySelector(".agent-plugin-flow")).toBeNull();
    expect(page.getByRole("button", { name: "Add plugin", exact: true }).elements()).toHaveLength(
      1,
    );
    expect(
      fixture.view.container.querySelector<HTMLDetailsElement>("details.agent-plugins-advanced")
        ?.open,
    ).toBe(false);
    await page.getByRole("button", { name: "About plugins" }).click();
    await expect
      .element(page.getByRole("dialog", { name: "About DeepSeek plugins" }))
      .toBeVisible();
    await page.getByRole("button", { name: "Got it" }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    for (const width of [1440, 768, 390]) {
      await page.viewport(width, 1000);
      restoreThemeSnapshot({
        ...originalTheme,
        theme: width === 390 ? "tabs-monotone-light" : "true-black",
      });
      window.scrollTo(0, 0);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await page.screenshot({
        element: fixture.view.container,
        path: `__screenshots__/agent-plugins/redesign-${width}.png`,
      });
    }
  } finally {
    await fixture.cleanup();
  }
});

it("shows the installation target before opening the account-scoped installer", async () => {
  const fixture = await mount({ "@example/search": "1.2.3" });
  try {
    await expect.element(page.getByText("@example/search", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add plugin", exact: true }).click();
    await expect.element(page.getByRole("dialog", { name: "Add a DeepSeek plugin" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Open installer", exact: true }))
      .toBeDisabled();
    await page.getByLabelText("Plugin source", { exact: true }).fill("@example/search@1.2.3");
    for (const width of [1280, 390]) {
      await page.viewport(width, 900);
      const dialog = page.getByRole("dialog", { name: "Add a DeepSeek plugin" }).element();
      expect(dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
      expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      await page.screenshot({
        element: dialog,
        path: `__screenshots__/agent-plugins/add-dialog-${width}.png`,
      });
    }
    await page.getByRole("button", { name: "Open installer", exact: true }).click();
    await expect.poll(() => fixture.run.mock.calls.length).toBe(1);
    expect(fixture.run.mock.calls[0]?.[0]).toContain("DSH_HOME='/state/one'");
    expect(fixture.run.mock.calls[0]?.[0]).toContain(
      "plugin --profile acp add -- '@example/search@1.2.3'",
    );
    expect(fixture.run.mock.calls[0]?.[1]).toBe("OpenRouter Work");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(page.getByRole("status")).toHaveTextContent("Finish in the terminal");
    await page.getByText("Advanced plugin configuration", { exact: true }).click();
    await page
      .getByRole("textbox", { name: "Plugin configuration JSON" })
      .fill('[{"id":"search","config":{"limit":8}}]');
    await page.getByRole("button", { name: "Save configuration" }).click();
    expect(state.update.mock.calls[0]?.[0]).toEqual({
      deepSeekPluginPatches: {
        "account-one": JSON.stringify([{ id: "search", config: { limit: 8 } }], null, 2),
      },
    });
  } finally {
    await fixture.cleanup();
  }
});

it("distinguishes unavailable inventory from an empty list and allows recovery", async () => {
  const fixture = await mount();
  try {
    state.read.mockRejectedValue(new Error("Account folder missing"));
    await expect.element(page.getByRole("heading", { name: "No plugins added yet" })).toBeVisible();
    await page.getByRole("button", { name: "Refresh plugins" }).click();
    await expect
      .element(page.getByRole("heading", { name: "Plugin list unavailable" }))
      .toBeVisible();
    await page.getByRole("button", { name: "Open plugin terminal" }).click();
    expect(fixture.run.mock.calls[0]?.[0]).toContain("plugin --profile acp list --depth 0");
    state.read.mockResolvedValue({
      contents: JSON.stringify({ dependencies: { "@example/recovered": "2.0.0" } }),
    });
    await page.getByRole("button", { name: "Refresh plugins" }).click();
    await expect.element(page.getByText("@example/recovered", { exact: true })).toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});

it("filters a larger collection and keeps the removal action tied to its package", async () => {
  const fixture = await mount(
    Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [`@example/plugin-${index}`, "1.0.0"]),
    ),
  );
  try {
    await page.getByRole("textbox", { name: "Search installed plugins" }).fill("plugin-3");
    await expect.element(page.getByText("@example/plugin-3", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("@example/plugin-4", { exact: true }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Remove @example/plugin-3", exact: true }).click();
    expect(fixture.run.mock.calls[0]?.[0]).toContain("remove -- '@example/plugin-3'");
  } finally {
    await fixture.cleanup();
  }
});

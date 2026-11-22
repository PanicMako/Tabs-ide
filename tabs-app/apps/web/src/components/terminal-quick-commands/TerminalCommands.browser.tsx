import "../../index.css";
import type { TerminalQuickCommand } from "@tabs/contracts";
import { useSyncExternalStore } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { AppAtomRegistryProvider } from "../../state/atomRegistry";
import { shootAll } from "../session-search/uxShots";

let current: TerminalQuickCommand[] = [];
const listeners = new Set<() => void>();
const setCommands = (next: readonly TerminalQuickCommand[]) => {
  current = [...next];
  for (const listener of listeners) listener();
};
vi.mock("../../hooks/useTerminalQuickCommands", () => ({
  useTerminalQuickCommands: () => {
    const commands = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => current,
    );
    return {
      commands,
      visible: commands,
      activeProjectId: null,
      save: async (next: readonly TerminalQuickCommand[]) => setCommands(next),
    };
  },
}));
vi.mock("../../lib/settingsLayerStore", () => ({ openSettingsLayer: vi.fn() }));
const runTerminalQuickCommand = vi.fn(async () => {});
vi.mock("../../terminalQuickCommandRunner", () => ({
  runTerminalQuickCommand: (...args: unknown[]) => runTerminalQuickCommand(...(args as [])),
}));

import TerminalCommandsSettings from "../settings/TerminalCommandsSettings";
import { TerminalQuickCommandsMenu } from "./TerminalQuickCommandsMenu";

const cmd = (id: string, command: string, label = ""): TerminalQuickCommand => ({
  id,
  label,
  command,
  appendEnter: true,
  scope: { type: "global" },
  cwd: "",
});

beforeEach(() => {
  current = [];
  runTerminalQuickCommand.mockClear();
});

const mountSettings = () =>
  render(
    <AppAtomRegistryProvider>
      <div className="mx-auto max-w-3xl p-8 text-foreground">
        <TerminalCommandsSettings />
      </div>
    </AppAtomRegistryProvider>,
  );

it("teaches with templates, adds inline, edits and deletes", async () => {
  const view = await mountSettings();
  await expect.element(page.getByText("One click to run what you always type")).toBeVisible();
  await shootAll("empty", "terminal-commands");
  await page.getByRole("button", { name: "Add npm run dev" }).click();
  expect(current.map((entry) => entry.command)).toEqual(["npm run dev"]);
  await page.getByRole("textbox", { name: "New command" }).fill("bun run test");
  await userEvent.keyboard("{Enter}");
  expect(current.map((entry) => entry.command)).toEqual(["npm run dev", "bun run test"]);
  await expect.element(page.getByRole("textbox", { name: "New command" })).toHaveValue("");

  await page.getByRole("button", { name: "Edit bun run test" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Run tests");
  await page.getByRole("button", { name: "Save" }).click();
  expect(current[1]?.label).toBe("Run tests");

  await page.getByRole("button", { name: "Delete Run tests" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await vi.waitFor(() => expect(current).toHaveLength(1));
  await view.unmount();
});

it("reorders by dragging the handle and shows the list", async () => {
  setCommands([
    cmd("a", "npm run dev", "Start dev server"),
    cmd("b", "npm test", "Run tests"),
    cmd("c", "git status"),
  ]);
  const view = await mountSettings();
  await expect.element(page.getByText("Start dev server")).toBeVisible();
  await shootAll("list", "terminal-commands");
  const handle = page.getByRole("button", { name: "Reorder Start dev server" });
  (handle.element() as HTMLElement).focus();
  await userEvent.keyboard(" ");
  await userEvent.keyboard("{ArrowDown}");
  await userEvent.keyboard(" ");
  await vi.waitFor(() => expect(current.map((entry) => entry.id)).toEqual(["b", "a", "c"]));
  await view.unmount();
});

it("runs a command from the toolbar menu and teaches when empty", async () => {
  const target = { threadId: "t", terminalId: "x" } as never;
  setCommands([]);
  let view = await render(
    <div className="p-12">
      <TerminalQuickCommandsMenu target={target} className="size-8" />
    </div>,
  );
  await page.getByTestId("terminal-quick-commands-trigger").click();
  await expect.element(page.getByText("No saved commands yet")).toBeVisible();
  await shootAll("menu-empty", "terminal-commands");
  await userEvent.keyboard("{Escape}");
  await view.unmount();

  setCommands([cmd("a", "npm run dev", "Start dev server")]);
  view = await render(
    <div className="p-12">
      <TerminalQuickCommandsMenu target={target} className="size-8" />
    </div>,
  );
  await page.getByTestId("terminal-quick-commands-trigger").click();
  await page.getByRole("menuitem", { name: /Start dev server/ }).click();
  await vi.waitFor(() => expect(runTerminalQuickCommand).toHaveBeenCalledTimes(1));
  await view.unmount();
});

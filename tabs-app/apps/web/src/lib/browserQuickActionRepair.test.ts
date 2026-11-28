import { ProjectId, type BrowserQuickAction } from "@tabs/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createDefaultWorkspaceShellPersistedState,
  readPersistedProjectWorkspaceSettings,
  useWorkspaceShellStore,
} from "../workspaceShellStore";
import { saveVerifiedBrowserQuickActionRepair } from "./browserQuickActionRepair";

const projectId = ProjectId.make("repair-project");
const previous: BrowserQuickAction = {
  id: "38d627ea-e2f6-4783-b8ca-b2a83f515994",
  label: "Save report",
  origin: "https://example.test",
  steps: [{ action: "click", selector: "#old" }],
  outcome: { selector: "#download", description: "Download ready", filenamePattern: "report.csv" },
};
const replacement: BrowserQuickAction = {
  ...previous,
  steps: [{ action: "click", selector: "#new" }],
};
const otherAction = { ...previous, id: "22ac10e4-6633-4c9a-9fb3-95d1dea01e0d" };
const repair = { previous, replacement };

const storage = new Map<string, string>();
const write = (key: string, value: string) => {
  storage.set(key, value);
};
const setItem = vi.fn(write);

beforeEach(() => {
  storage.clear();
  setItem.mockReset().mockImplementation(write);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem,
  });
  useWorkspaceShellStore.setState(createDefaultWorkspaceShellPersistedState());
  useWorkspaceShellStore.getState().upsertProjectSettings(projectId, {
    browserQuickActions: [previous, otherAction],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  new DOMException("Quota exceeded", "QuotaExceededError"),
  new Error("Storage write failed"),
])("keeps the saved actions and allows retry after a synchronous write error (%s)", (error) => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const initialSettings = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId];
  setItem.mockImplementation(() => {
    throw error;
  });

  expect(saveVerifiedBrowserQuickActionRepair(projectId, repair)).toBe(false);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("Could not save"), error);
  expect(useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId]).toEqual(
    initialSettings,
  );
  expect(readPersistedProjectWorkspaceSettings(projectId)).toEqual(initialSettings);

  setItem.mockImplementation(write);
  expect(saveVerifiedBrowserQuickActionRepair(projectId, repair)).toBe(true);
  expect(
    useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId]?.browserQuickActions,
  ).toEqual([replacement, otherAction]);
  expect(readPersistedProjectWorkspaceSettings(projectId)?.browserQuickActions).toEqual([
    replacement,
    otherAction,
  ]);
});

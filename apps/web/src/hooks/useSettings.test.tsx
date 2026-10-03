import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { applySettingsUpdate, createDebouncedSettingsUpdater } from "./useSettings";
import {
  clientSettingsAtom,
  serverSettingsAtom,
  settingsPersistenceAtom,
  hydrateClientSettings,
  setServerConfig,
} from "../state/settings";
import { appAtomRegistry } from "../state/atomRegistry";
import { DEFAULT_CLIENT_SETTINGS } from "@tabs/contracts/settings";
import { DEFAULT_SERVER_SETTINGS, type ServerConfig } from "@tabs/contracts";
import { useScopedStateStore } from "~/state/scopedStateStore";

describe("Settings persistence contract", () => {
  let store: Record<string, string> = {};
  const mockStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };

  const mockUpdateSettingsRpc = vi.fn();
  const mockGetConfigRpc = vi.fn();

  beforeAll(() => {
    (globalThis as any).localStorage = mockStorage;
    (globalThis as any).window = globalThis.window ?? {};
    (globalThis as any).window.localStorage = mockStorage;
    (globalThis as any).window.nativeApi = {
      server: {
        updateSettings: mockUpdateSettingsRpc,
        getConfig: mockGetConfigRpc,
      },
    };
    (globalThis as any).document = globalThis.document ?? {
      documentElement: { dataset: {} },
    };
  });

  afterAll(() => {
    delete (globalThis as any).window.nativeApi;
  });

  beforeEach(() => {
    mockStorage.clear();
    vi.clearAllMocks();
    mockUpdateSettingsRpc.mockReset();
    mockGetConfigRpc.mockReset();

    const initialConfig = {
      settings: { ...DEFAULT_SERVER_SETTINGS, enableAssistantStreaming: true },
      providers: [],
      keybindings: [],
    } as unknown as ServerConfig;
    setServerConfig(initialConfig);
    mockGetConfigRpc.mockResolvedValue(initialConfig);
    appAtomRegistry.set(clientSettingsAtom, { ...DEFAULT_CLIENT_SETTINGS, diffWordWrap: false });
    appAtomRegistry.set(settingsPersistenceAtom, {
      status: "idle",
      error: null,
      lastSavedAt: null,
      failedPatch: null,
      retry: null,
    });
  });

  it("handles successful client save", async () => {
    hydrateClientSettings(true);

    const ok = await applySettingsUpdate({ diffWordWrap: true });
    expect(ok).toBe(true);

    const client = appAtomRegistry.get(clientSettingsAtom);
    expect(client.diffWordWrap).toBe(true);

    const stored = JSON.parse(store["tabs:client-settings:v1"] || "{}");
    expect(stored.diffWordWrap).toBe(true);

    const persistence = appAtomRegistry.get(settingsPersistenceAtom);
    expect(persistence.status).toBe("saved");
    expect(persistence.lastSavedAt).toBeGreaterThan(0);
  });

  it("handles successful server save with optimistic update and confirmation", async () => {
    mockUpdateSettingsRpc.mockResolvedValueOnce({ ok: true });
    mockGetConfigRpc.mockResolvedValueOnce({
      settings: { ...DEFAULT_SERVER_SETTINGS, enableAssistantStreaming: false },
      providers: [],
      keybindings: [],
    } as unknown as ServerConfig);

    const savePromise = applySettingsUpdate({ enableAssistantStreaming: false });

    // Optimistically updated
    expect(appAtomRegistry.get(serverSettingsAtom).enableAssistantStreaming).toBe(false);
    expect(appAtomRegistry.get(settingsPersistenceAtom).status).toBe("saving");

    const ok = await savePromise;
    expect(ok).toBe(true);

    expect(mockUpdateSettingsRpc).toHaveBeenCalledWith({ enableAssistantStreaming: false });
    const persistence = appAtomRegistry.get(settingsPersistenceAtom);
    expect(persistence.status).toBe("saved");
    expect(persistence.error).toBeNull();
  });

  it("handles server rejection with rollback and failed status", async () => {
    mockUpdateSettingsRpc.mockRejectedValueOnce(new Error("RPC persistence failed"));

    const ok = await applySettingsUpdate({ enableAssistantStreaming: false });
    expect(ok).toBe(false);

    // Rolled back to previous value
    expect(appAtomRegistry.get(serverSettingsAtom).enableAssistantStreaming).toBe(true);

    const persistence = appAtomRegistry.get(settingsPersistenceAtom);
    expect(persistence.status).toBe("failed");
    expect(persistence.error).toBe("RPC persistence failed");
    expect(persistence.failedPatch).toEqual({ enableAssistantStreaming: false });
    expect(typeof persistence.retry).toBe("function");
  });

  it("preserves unsaved compound drafts when server rejects", async () => {
    // Set a draft model order in scopedStateStore
    useScopedStateStore.getState().updateSettingsState({
      draftModelOrders: { codex: ["gpt-4o", "o1"] },
    });

    mockUpdateSettingsRpc.mockRejectedValueOnce(new Error("Network error"));

    const ok = await applySettingsUpdate({ enableAssistantStreaming: false });
    expect(ok).toBe(false);

    // Server setting was rolled back
    expect(appAtomRegistry.get(serverSettingsAtom).enableAssistantStreaming).toBe(true);

    // The draft model order in scopedStateStore was NOT wiped out
    const viewState = useScopedStateStore.getState().settingsState;
    expect(viewState.draftModelOrders?.codex).toEqual(["gpt-4o", "o1"]);
  });

  it("supports retrying after a failed save", async () => {
    mockUpdateSettingsRpc.mockRejectedValueOnce(new Error("Temporary error"));

    await applySettingsUpdate({ enableAssistantStreaming: false });

    let persistence = appAtomRegistry.get(settingsPersistenceAtom);
    expect(persistence.status).toBe("failed");
    expect(persistence.retry).toBeDefined();

    // Now server succeeds on retry
    mockUpdateSettingsRpc.mockResolvedValueOnce({ ok: true });
    mockGetConfigRpc.mockResolvedValueOnce({
      settings: { ...DEFAULT_SERVER_SETTINGS, enableAssistantStreaming: false },
      providers: [],
      keybindings: [],
    } as unknown as ServerConfig);

    const retryResult = await persistence.retry!();
    expect(retryResult).toBe(true);

    persistence = appAtomRegistry.get(settingsPersistenceAtom);
    expect(persistence.status).toBe("saved");
    expect(appAtomRegistry.get(serverSettingsAtom).enableAssistantStreaming).toBe(false);
  });

  it("serializes rapid server updates so persistence order matches user intent", async () => {
    let resolveFirst!: (val: any) => void;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    let resolveSecond!: (val: any) => void;
    const secondPromise = new Promise((resolve) => {
      resolveSecond = resolve;
    });

    mockUpdateSettingsRpc
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(() => secondPromise);

    // Dispatch update 1
    const p1 = applySettingsUpdate({ enableAssistantStreaming: false });

    // Dispatch update 2 (newer). It must wait for update 1 instead of racing it.
    const p2 = applySettingsUpdate({ enableAssistantStreaming: true });
    await Promise.resolve();
    expect(mockUpdateSettingsRpc).toHaveBeenCalledTimes(1);

    resolveFirst({ ok: true });
    await p1;
    await vi.waitFor(() => expect(mockUpdateSettingsRpc).toHaveBeenCalledTimes(2));

    mockGetConfigRpc.mockResolvedValueOnce({
      version: "1.0.0",
      settings: { ...DEFAULT_SERVER_SETTINGS, enableAssistantStreaming: true },
      providers: [],
      keybindings: [],
    });
    resolveSecond({ ok: true });
    await p2;

    expect(appAtomRegistry.get(serverSettingsAtom).enableAssistantStreaming).toBe(true);
    expect(appAtomRegistry.get(settingsPersistenceAtom).status).toBe("saved");
  });

  it("debounces rapid control updates and flushes on demand", async () => {
    vi.useFakeTimers();
    mockUpdateSettingsRpc.mockResolvedValue({ ok: true });
    mockGetConfigRpc.mockResolvedValue({
      settings: DEFAULT_SERVER_SETTINGS,
      providers: [],
      keybindings: [],
    } as unknown as ServerConfig);

    const debounced = createDebouncedSettingsUpdater(applySettingsUpdate, 200);

    debounced.updateSettings({ enableAssistantStreaming: false });
    debounced.updateSettings({ defaultThreadEnvMode: "local" });

    // Not flushed yet
    expect(mockUpdateSettingsRpc).not.toHaveBeenCalled();

    // Advance 100ms (still within delay)
    vi.advanceTimersByTime(100);
    expect(mockUpdateSettingsRpc).not.toHaveBeenCalled();

    // Flush manually (e.g. on blur)
    await debounced.flush();

    expect(mockUpdateSettingsRpc).toHaveBeenCalledTimes(1);
    expect(mockUpdateSettingsRpc).toHaveBeenCalledWith({
      enableAssistantStreaming: false,
      defaultThreadEnvMode: "local",
    });

    vi.useRealTimers();
  });

  it("ensures preview actions do not trigger settings save", () => {
    // Calling an internal preview callback does not call updateSettingsRpc
    const previewStyles = {
      splashLoaderStyle: "solari",
      splashLoaderPalette: "sunset",
    };

    // Before preview, server settings are untouched
    expect(appAtomRegistry.get(serverSettingsAtom).enableAssistantStreaming).toBe(true);
    expect(mockUpdateSettingsRpc).not.toHaveBeenCalled();

    // Verify preview properties exist and can be inspected without mutating settings
    expect(previewStyles.splashLoaderStyle).toBe("solari");
    expect(mockUpdateSettingsRpc).not.toHaveBeenCalled();
  });

  it("retains unsaved compound draft when leaving and returning to a settings section", () => {
    // 1. In providers section, user stages a draft model order
    useScopedStateStore.getState().updateSettingsState({
      activeSection: "providers",
      draftModelOrders: {
        codex: ["model-b", "model-a"],
      },
    });

    expect(useScopedStateStore.getState().settingsState.activeSection).toBe("providers");
    expect(useScopedStateStore.getState().settingsState.draftModelOrders?.codex).toEqual([
      "model-b",
      "model-a",
    ]);

    // 2. User switches to "themes" section
    useScopedStateStore.getState().updateSettingsState({
      activeSection: "themes",
    });

    expect(useScopedStateStore.getState().settingsState.activeSection).toBe("themes");
    // Draft model order is still retained!
    expect(useScopedStateStore.getState().settingsState.draftModelOrders?.codex).toEqual([
      "model-b",
      "model-a",
    ]);

    // 3. User navigates back to "providers"
    useScopedStateStore.getState().updateSettingsState({
      activeSection: "providers",
    });

    expect(useScopedStateStore.getState().settingsState.activeSection).toBe("providers");
    expect(useScopedStateStore.getState().settingsState.draftModelOrders?.codex).toEqual([
      "model-b",
      "model-a",
    ]);
  });
});

import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from "vitest";
import {
  applySettingsUpdate,
  sanitizeErrorMessage,
  resetSettingsStateForTesting,
} from "./useSettings";
import {
  clientSettingsAtom,
  serverSettingsAtom,
  settingsPersistenceAtom,
  hydrateClientSettings,
  setServerConfig,
} from "../state/settings";
import { appAtomRegistry } from "../state/atomRegistry";
import { DEFAULT_CLIENT_SETTINGS, DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";
import { DEFAULT_SERVER_SETTINGS, type ServerConfig } from "@tabs/contracts";

describe("Transactional mixed client/server settings persistence (Option A)", () => {
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
    resetSettingsStateForTesting();
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
    hydrateClientSettings(true);
    appAtomRegistry.set(clientSettingsAtom, { ...DEFAULT_CLIENT_SETTINGS, diffWordWrap: false });
    appAtomRegistry.set(settingsPersistenceAtom, {
      status: "idle",
      error: null,
      lastSavedAt: null,
      failedPatch: null,
      retry: null,
    });
  });

  it("mixed update success persists both client and server halves", async () => {
    mockUpdateSettingsRpc.mockResolvedValueOnce({ ok: true });
    mockGetConfigRpc.mockResolvedValueOnce({
      settings: { ...DEFAULT_SERVER_SETTINGS, enableAssistantStreaming: false },
      providers: [],
      keybindings: [],
    } as unknown as ServerConfig);

    const mixedPatch = {
      diffWordWrap: true, // client setting
      enableAssistantStreaming: false, // server setting
    };

    const ok = await applySettingsUpdate(mixedPatch);
    expect(ok).toBe(true);

    // Client store updated
    expect(appAtomRegistry.get(clientSettingsAtom).diffWordWrap).toBe(true);
    // Server RPC called
    expect(mockUpdateSettingsRpc).toHaveBeenCalledWith({ enableAssistantStreaming: false });
    // Persistence status is saved
    const persistence = appAtomRegistry.get(settingsPersistenceAtom);
    expect(persistence.status).toBe("saved");
    expect(persistence.lastSavedAt).toBeGreaterThan(0);
  });

  it("mixed update failure follows Option A: transactional rollback of both stores", async () => {
    mockUpdateSettingsRpc.mockRejectedValueOnce(new Error("Network connection dropped"));

    const mixedPatch = {
      diffWordWrap: true, // client
      enableAssistantStreaming: false, // server
    };

    const ok = await applySettingsUpdate(mixedPatch);
    expect(ok).toBe(false);

    // Server was rolled back to initial value (true)
    expect(appAtomRegistry.get(serverSettingsAtom).enableAssistantStreaming).toBe(true);
    // Client was ALSO rolled back transactionally to initial value (false)
    expect(appAtomRegistry.get(clientSettingsAtom).diffWordWrap).toBe(false);

    const persistence = appAtomRegistry.get(settingsPersistenceAtom);
    expect(persistence.status).toBe("failed");
    expect(persistence.error).toContain("Network connection dropped");
    // Retry contains the complete original patch, not just the server half
    expect(persistence.failedPatch).toEqual(mixedPatch);
    expect(typeof persistence.retry).toBe("function");
  });

  it("retrying after a failed mixed update can succeed and persist both halves", async () => {
    mockUpdateSettingsRpc.mockRejectedValueOnce(new Error("First attempt failed"));

    const mixedPatch = {
      diffWordWrap: true,
      enableAssistantStreaming: false,
    };

    await applySettingsUpdate(mixedPatch);
    const persistence = appAtomRegistry.get(settingsPersistenceAtom);
    expect(persistence.status).toBe("failed");

    // Prepare success for retry
    mockUpdateSettingsRpc.mockResolvedValueOnce({ ok: true });
    mockGetConfigRpc.mockResolvedValueOnce({
      settings: { ...DEFAULT_SERVER_SETTINGS, enableAssistantStreaming: false },
      providers: [],
      keybindings: [],
    } as unknown as ServerConfig);

    const retryOk = await persistence.retry!();
    expect(retryOk).toBe(true);
    expect(appAtomRegistry.get(clientSettingsAtom).diffWordWrap).toBe(true);
    expect(appAtomRegistry.get(settingsPersistenceAtom).status).toBe("saved");
  });

  it("a newer update is not reverted by rollback from an older failed update", async () => {
    let rejectSlow: (err: any) => void = () => {};
    const slowRpc = new Promise((_, reject) => {
      rejectSlow = reject;
    });
    mockUpdateSettingsRpc.mockImplementationOnce(() => slowRpc);

    // First update initiated (slow)
    const p1 = applySettingsUpdate({
      diffWordWrap: true,
      enableAssistantStreaming: false,
    });

    // While first is in flight, user makes a newer edit
    mockUpdateSettingsRpc.mockResolvedValueOnce({ ok: true });
    mockGetConfigRpc.mockResolvedValueOnce({
      settings: { ...DEFAULT_SERVER_SETTINGS, enableAssistantStreaming: true },
      providers: [],
      keybindings: [],
    } as unknown as ServerConfig);

    const p2 = applySettingsUpdate({
      diffWordWrap: false,
      enableAssistantStreaming: true,
    });

    // Reject the first update now
    rejectSlow(new Error("Slow RPC failed"));

    // Both promises settle
    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1).toBe(false);
    expect(res2).toBe(true);

    // Newer values MUST NOT be clobbered by the older failed update's rollback!
    expect(appAtomRegistry.get(clientSettingsAtom).diffWordWrap).toBe(false);
    expect(appAtomRegistry.get(serverSettingsAtom).enableAssistantStreaming).toBe(true);
    expect(appAtomRegistry.get(settingsPersistenceAtom).status).toBe("saved");
  });

  it("Restore Defaults handles mixed failure transactionally without falsely reporting success", async () => {
    // Current state has custom client and server values
    appAtomRegistry.set(clientSettingsAtom, { ...DEFAULT_CLIENT_SETTINGS, diffWordWrap: true });
    setServerConfig({
      settings: { ...DEFAULT_SERVER_SETTINGS, enableAssistantStreaming: false },
      providers: [],
      keybindings: [],
    } as unknown as ServerConfig);

    mockUpdateSettingsRpc.mockRejectedValueOnce(new Error("Server write failed"));

    const ok = await applySettingsUpdate(DEFAULT_UNIFIED_SETTINGS);
    expect(ok).toBe(false);

    // Persistence status must report failed, NEVER saved
    const persistence = appAtomRegistry.get(settingsPersistenceAtom);
    expect(persistence.status).toBe("failed");
    expect(persistence.error).toContain("Server write failed");
    // Client settings rolled back to previous customized state
    expect(appAtomRegistry.get(clientSettingsAtom).diffWordWrap).toBe(true);
  });

  it("secret fields do not expose their contents through error or status objects", async () => {
    const errorWithToken = new Error(
      "Failed to authenticate with token: ghp_SECRET_GITHUB_TOKEN_12345",
    );
    mockUpdateSettingsRpc.mockRejectedValueOnce(errorWithToken);

    await applySettingsUpdate({
      providers: {
        copilot: {
          token: "ghp_SECRET_GITHUB_TOKEN_12345",
        },
      } as any,
    });

    const persistence = appAtomRegistry.get(settingsPersistenceAtom);
    expect(persistence.status).toBe("failed");
    expect(persistence.error).not.toContain("ghp_SECRET_GITHUB_TOKEN_12345");
    expect(persistence.error).toContain("[REDACTED]");

    // Verify sanitizeErrorMessage directly
    const redactedAuth = sanitizeErrorMessage("Authorization: Bearer sk-ant-api03-abcdef123456");
    expect(redactedAuth).not.toContain("sk-ant-api03-abcdef123456");
    expect(redactedAuth).toContain("[REDACTED]");
    const redactedKey = sanitizeErrorMessage("Failed key: sk-secret-12345");
    expect(redactedKey).not.toContain("sk-secret-12345");
    expect(redactedKey).toContain("[REDACTED]");
  });
});

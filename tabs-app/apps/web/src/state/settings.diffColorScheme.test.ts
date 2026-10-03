import { describe, expect, it, beforeEach, beforeAll, afterAll } from "vitest";
import { clientSettingsAtom, hydrateClientSettings, updateClientSettings } from "./settings";
import { appAtomRegistry } from "./atomRegistry";
import { DEFAULT_CLIENT_SETTINGS } from "@tabs/contracts/settings";
import { getStoredDiffColorScheme } from "../hooks/useTheme";

describe("diffColorScheme settings and DOM dataset sync", () => {
  let store: Record<string, string> = {};
  const mockDataset: Record<string, string> = {};

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

  beforeAll(() => {
    // Setup global mocks for Node test environment
    (globalThis as any).localStorage = mockStorage;
    (globalThis as any).window = { localStorage: mockStorage };
    (globalThis as any).document = {
      documentElement: {
        dataset: mockDataset,
      },
    };
  });

  afterAll(() => {
    delete (globalThis as any).localStorage;
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  beforeEach(() => {
    mockStorage.clear();
    for (const key of Object.keys(mockDataset)) {
      delete mockDataset[key];
    }
    appAtomRegistry.set(clientSettingsAtom, DEFAULT_CLIENT_SETTINGS);
  });

  it("defaults to red-green on initial hydration", () => {
    hydrateClientSettings(true);
    const settings = appAtomRegistry.get(clientSettingsAtom);
    expect(settings.diffColorScheme).toBe("red-green");
    expect((globalThis as any).document.documentElement.dataset.diffColorScheme).toBe("red-green");
    expect(getStoredDiffColorScheme()).toBe("red-green");
  });

  it("updates dataset and localStorage when switched to blue-orange", () => {
    hydrateClientSettings(true);
    updateClientSettings((curr) => ({ ...curr, diffColorScheme: "blue-orange" }));

    const settings = appAtomRegistry.get(clientSettingsAtom);
    expect(settings.diffColorScheme).toBe("blue-orange");
    expect((globalThis as any).document.documentElement.dataset.diffColorScheme).toBe(
      "blue-orange",
    );
    expect(getStoredDiffColorScheme()).toBe("blue-orange");

    // Verify localStorage persistence
    const raw = mockStorage.getItem("tabs:client-settings:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.diffColorScheme).toBe("blue-orange");
  });

  it("restores blue-orange on subsequent hydration from localStorage", () => {
    mockStorage.setItem(
      "tabs:client-settings:v1",
      JSON.stringify({ ...DEFAULT_CLIENT_SETTINGS, diffColorScheme: "blue-orange" }),
    );

    hydrateClientSettings(true);
    expect((globalThis as any).document.documentElement.dataset.diffColorScheme).toBe(
      "blue-orange",
    );
    expect(getStoredDiffColorScheme()).toBe("blue-orange");
  });
});

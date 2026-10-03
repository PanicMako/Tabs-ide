/**
 * Unified settings hook.
 *
 * Abstracts the split between server-authoritative settings (persisted in
 * `settings.json` on the server, fetched via `server.getConfig`) and
 * client-only settings (persisted in localStorage).
 *
 * Consumers use `useSettings(selector)` to read, and `useUpdateSettings()` to
 * write. The hook transparently routes reads/writes to the correct backing
 * store.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ServerSettings,
  ServerSettingsPatch,
  ModelSelection,
  ThreadEnvMode,
} from "@tabs/contracts";
import { DEFAULT_SERVER_SETTINGS } from "@tabs/contracts";
import {
  type ClientSettings,
  DEFAULT_DESKTOP_ICON_THEME,
  DEFAULT_UNIFIED_SETTINGS,
  DesktopIconTheme,
  SidebarProjectSortOrder,
  SidebarThreadSortOrder,
  TimestampFormat,
  UnifiedSettings,
} from "@tabs/contracts/settings";
import { ensureNativeApi } from "~/nativeApi";
import { makeAppModelSelection, normalizeCustomModelSlugs } from "~/modelSelection";
import { Predicate, Schema, Struct } from "effect";
import { DeepMutable } from "effect/Types";
import { deepMerge } from "@tabs/shared/Struct";
import {
  clientSettingsAtom,
  patchServerSettings,
  refreshServerConfig,
  rollbackClientSettings,
  rollbackServerSettings,
  serverConfigAtom,
  setSettingsPersistence,
  updateClientSettings,
  updateSettingsPersistence,
  useClientSettings,
  useServerSettings,
  useSettingsPersistence,
  type SettingsPersistenceState,
  type SettingsSaveStatus,
} from "../state/settings";
import { appAtomRegistry } from "../state/atomRegistry";

const CLIENT_SETTINGS_STORAGE_KEY = "tabs:client-settings:v1";
const OLD_SETTINGS_KEY = "tabs:app-settings:v1";

// ── Key sets for routing patches ─────────────────────────────────────

const SERVER_SETTINGS_KEYS = new Set<string>(Struct.keys(ServerSettings.fields));

function mergeServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const {
    usageLimitSources: usageLimitSourcesPatch,
    usagePriceOverrides: usagePriceOverridesPatch,
    ...restPatch
  } = patch;
  let next = deepMerge(current, restPatch as any);

  if (usageLimitSourcesPatch) {
    const updatedSources = { ...next.usageLimitSources };
    for (const [id, value] of Object.entries(usageLimitSourcesPatch)) {
      if (value === null) {
        delete (updatedSources as any)[id];
      } else if (value !== undefined) {
        (updatedSources as any)[id] = value;
      }
    }
    next = {
      ...next,
      usageLimitSources: updatedSources as any,
    };
  }

  if (usagePriceOverridesPatch) {
    const updatedOverrides = { ...next.usagePriceOverrides };
    for (const [id, value] of Object.entries(usagePriceOverridesPatch)) {
      if (value === null) {
        delete (updatedOverrides as any)[id];
      } else if (value !== undefined) {
        (updatedOverrides as any)[id] = value;
      }
    }
    next = {
      ...next,
      usagePriceOverrides: updatedOverrides as any,
    };
  }

  const selectionPatch = patch.textGenerationModelSelection;
  if (!selectionPatch) {
    return next;
  }

  const hasProvider = "instanceId" in selectionPatch && selectionPatch.instanceId !== undefined;
  const hasModel = "model" in selectionPatch && selectionPatch.model !== undefined;
  const hasOptions = "options" in selectionPatch;

  if (hasProvider || hasModel) {
    return {
      ...next,
      textGenerationModelSelection: makeAppModelSelection(
        selectionPatch.instanceId ?? current.textGenerationModelSelection.instanceId,
        selectionPatch.model ?? current.textGenerationModelSelection.model,
        hasOptions
          ? (selectionPatch.options ?? null)
          : current.textGenerationModelSelection.options,
      ) as unknown as ServerSettings["textGenerationModelSelection"],
    };
  }

  if (hasOptions) {
    return {
      ...next,
      textGenerationModelSelection: {
        ...current.textGenerationModelSelection,
        ...(selectionPatch.options
          ? {
              options: deepMerge(
                current.textGenerationModelSelection.options ?? {},
                selectionPatch.options,
              ),
            }
          : {}),
      } as ServerSettings["textGenerationModelSelection"],
    };
  }

  return next;
}

function splitPatch(patch: Partial<UnifiedSettings>): {
  serverPatch: ServerSettingsPatch;
  clientPatch: Partial<ClientSettings>;
} {
  const serverPatch: Record<string, unknown> = {};
  const clientPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SERVER_SETTINGS_KEYS.has(key)) {
      serverPatch[key] = value;
    } else {
      clientPatch[key] = value;
    }
  }
  return {
    serverPatch: serverPatch as ServerSettingsPatch,
    clientPatch: clientPatch as Partial<ClientSettings>,
  };
}

// ── Hooks ────────────────────────────────────────────────────────────

/**
 * Read merged settings. Selector narrows the subscription so components
 * only re-render when the slice they care about changes.
 */

export function useSettings<T = UnifiedSettings>(selector?: (s: UnifiedSettings) => T): T {
  const serverSettings = useServerSettings();
  const clientSettings = useClientSettings();

  const merged = useMemo<UnifiedSettings>(
    () => ({
      ...clientSettings,
      ...serverSettings,
    }),
    [serverSettings, clientSettings],
  );

  return useMemo(
    () => (selector ? selector(merged) : (merged as unknown as T)),
    [merged, selector],
  );
}

let latestServerUpdateSequence = 0;
let savedTimeoutId: ReturnType<typeof setTimeout> | null = null;
let serverUpdateQueue: Promise<void> = Promise.resolve();

export function resetSettingsStateForTesting(): void {
  latestServerUpdateSequence = 0;
  serverUpdateQueue = Promise.resolve();
  shutdownListenersInstalled = false;
  activeDebouncedUpdaters.clear();
  if (savedTimeoutId) {
    clearTimeout(savedTimeoutId);
    savedTimeoutId = null;
  }
}

/**
 * Redacts tokens, passwords, and sensitive keys from error messages
 * to prevent leaking secrets in status UI, telemetry, or logs.
 */
export function sanitizeErrorMessage(msg: string): string {
  if (!msg) return msg;
  return msg
    .replace(
      /(?:token|api[_-]?key|secret|password|bearer|authorization)[:=\s]+[^\s,;]+/gi,
      (match) => {
        const parts = match.split(/[:=\s]+/);
        return `${parts[0]}=[REDACTED]`;
      },
    )
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]");
}

/**
 * Applies a settings patch directly to the appropriate backing store (server via RPC,
 * client via localStorage) with optimistic update, transactional rollback on rejection
 * (Option A: rolling back both stores if either fails), and out-of-order sequence protection.
 */
export function applySettingsUpdate(patch: Record<string, any>): Promise<boolean> {
  const { serverPatch, clientPatch } = splitPatch(patch);
  const hasServerPatch = Object.keys(serverPatch).length > 0;
  const hasClientPatch = Object.keys(clientPatch).length > 0;

  // Snapshot previous states for transactional rollback (Option A)
  const previousClientSettings = appAtomRegistry.get(clientSettingsAtom);
  const currentConfig = appAtomRegistry.get(serverConfigAtom);
  const previousServerSettings = currentConfig?.settings ?? DEFAULT_SERVER_SETTINGS;

  if (hasClientPatch) {
    try {
      updateClientSettings((current) => ({ ...current, ...clientPatch }));
      if (!hasServerPatch) {
        setSettingsPersistence({
          status: "saved",
          error: null,
          lastSavedAt: Date.now(),
          failedPatch: null,
          retry: null,
        });
        if (savedTimeoutId) clearTimeout(savedTimeoutId);
        savedTimeoutId = setTimeout(() => {
          updateSettingsPersistence((prev) =>
            prev.status === "saved" ? { ...prev, status: "idle" } : prev,
          );
        }, 3000);
      }
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : "Failed to save client settings";
      const errorMsg = sanitizeErrorMessage(rawMsg);
      setSettingsPersistence({
        status: "failed",
        error: errorMsg,
        lastSavedAt: null,
        failedPatch: patch,
        retry: () => applySettingsUpdate(patch),
      });
      return Promise.resolve(false);
    }
  }

  if (hasServerPatch) {
    const currentSeq = ++latestServerUpdateSequence;

    patchServerSettings(serverPatch, (current) => mergeServerSettingsPatch(current, serverPatch));

    setSettingsPersistence({
      status: "saving",
      error: null,
      lastSavedAt: null,
      failedPatch: null,
      retry: null,
    });

    const serverUpdate = serverUpdateQueue.then(() =>
      ensureNativeApi().server.updateSettings(serverPatch),
    );
    serverUpdateQueue = serverUpdate.then(
      () => undefined,
      () => undefined,
    );

    return serverUpdate
      .then(async () => {
        if (currentSeq === latestServerUpdateSequence) {
          await refreshServerConfig();
          setSettingsPersistence({
            status: "saved",
            error: null,
            lastSavedAt: Date.now(),
            failedPatch: null,
            retry: null,
          });
          if (savedTimeoutId) clearTimeout(savedTimeoutId);
          savedTimeoutId = setTimeout(() => {
            if (latestServerUpdateSequence === currentSeq) {
              updateSettingsPersistence((prev) =>
                prev.status === "saved" ? { ...prev, status: "idle" } : prev,
              );
            }
          }, 3000);
        }
        return true;
      })
      .catch(async (err) => {
        if (currentSeq === latestServerUpdateSequence) {
          // Transactional rollback of both server and client (Option A)
          const refreshedConfig = await refreshServerConfig();
          if (!refreshedConfig) {
            rollbackServerSettings(previousServerSettings);
          }
          if (hasClientPatch) {
            rollbackClientSettings(previousClientSettings);
          }
          const rawMsg =
            err instanceof Error ? err.message : String(err ?? "Failed to save settings");
          const errorMsg = sanitizeErrorMessage(rawMsg);
          setSettingsPersistence({
            status: "failed",
            error: errorMsg,
            lastSavedAt: null,
            failedPatch: patch,
            retry: () => applySettingsUpdate(patch),
          });
        }
        return false;
      });
  }

  return Promise.resolve(true);
}

/**
 * Returns an updater that routes each key to the correct backing store.
 *
 * Server keys are optimistically patched in the local state, then
 * persisted via RPC. If the RPC fails, the change is rolled back and the failure
 * is surfaced with a retry callback. Client keys go directly to localStorage.
 */
export function useUpdateSettings() {
  const updateSettings = useCallback(
    (patch: Record<string, any>): Promise<boolean> => applySettingsUpdate(patch),
    [],
  );

  const resetSettings = useCallback(() => {
    return applySettingsUpdate(DEFAULT_UNIFIED_SETTINGS);
  }, []);

  return {
    updateSettings,
    resetSettings,
  };
}

// ── Centralized Debounced Settings Coordination ────────────────────────

export interface DebouncedSettingsUpdater {
  updateSettings: (patch: Record<string, any>) => void;
  flush: () => Promise<boolean>;
  cancel: () => void;
  getPendingPatch: () => Record<string, any>;
  hasPending: () => boolean;
}

const activeDebouncedUpdaters = new Set<DebouncedSettingsUpdater>();

let shutdownListenersInstalled = false;
export function ensureShutdownListeners(): void {
  if (shutdownListenersInstalled) return;
  if (typeof window === "undefined") return;
  shutdownListenersInstalled = true;

  if (typeof window.addEventListener === "function") {
    window.addEventListener("beforeunload", () => {
      void flushAllDebouncedSettings();
    });
  }

  const bridge = (window as any).desktopBridge;
  if (bridge?.onAppClosing) {
    bridge.onAppClosing(() => {
      void flushAllDebouncedSettings().finally(() => {
        bridge.notifySettingsFlushDone?.();
      });
    });
  }
}

export function registerDebouncedUpdater(updater: DebouncedSettingsUpdater): () => void {
  activeDebouncedUpdaters.add(updater);
  ensureShutdownListeners();
  return () => {
    activeDebouncedUpdaters.delete(updater);
  };
}

export async function flushAllDebouncedSettings(): Promise<boolean> {
  if (activeDebouncedUpdaters.size === 0) return true;
  const updaters = Array.from(activeDebouncedUpdaters);
  const results = await Promise.all(updaters.map((u) => u.flush()));
  return results.every(Boolean);
}

/**
 * Controller for debouncing rapid settings updates (e.g. text fields or sliders)
 * and flushing pending changes on demand. Uses deepMerge to avoid clobbering
 * nested structures like `providers`.
 */
export function createDebouncedSettingsUpdater(
  updater: (patch: Record<string, any>) => Promise<boolean> = applySettingsUpdate,
  delay = 300,
): DebouncedSettingsUpdater {
  let pendingPatch: Record<string, any> = {};
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): Promise<boolean> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const patch = { ...pendingPatch };
    if (Object.keys(patch).length > 0) {
      pendingPatch = {};
      return updater(patch);
    }
    return Promise.resolve(true);
  };

  const queueUpdate = (patch: Record<string, any>) => {
    pendingPatch = deepMerge(pendingPatch, patch as any);
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
  };

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pendingPatch = {};
  };

  return {
    updateSettings: queueUpdate,
    flush,
    cancel,
    getPendingPatch: () => ({ ...pendingPatch }),
    hasPending: () => Object.keys(pendingPatch).length > 0,
  };
}

/**
 * Hook for debouncing rapid settings updates (e.g. text fields or sliders)
 * and automatically flushing pending changes on unmount, window unload, or app quit.
 */
export function useDebouncedSettingsUpdate(
  delay = 300,
  updater: (patch: Record<string, any>) => Promise<boolean> = applySettingsUpdate,
) {
  const updaterRef = useRef<DebouncedSettingsUpdater | null>(null);
  if (!updaterRef.current) {
    updaterRef.current = createDebouncedSettingsUpdater(updater, delay);
  }

  useEffect(() => {
    const instance = updaterRef.current!;
    const unregister = registerDebouncedUpdater(instance);
    return () => {
      unregister();
      void instance.flush();
    };
  }, []);

  return updaterRef.current;
}

/**
 * Hook for a single debounced setting field (text input or slider)
 * providing instant responsive visual state with debounced persistence,
 * immediate flush on blur, Enter, unmount, and app shutdown.
 */
export function useDebouncedSettingField<T extends string | number>({
  value,
  onPersist,
  delay = 350,
}: {
  value: T;
  onPersist: (val: T) => void | Promise<boolean>;
  delay?: number;
}) {
  const [localValue, setLocalValue] = useState<T>(value);
  const isDirtyRef = useRef(false);
  const latestLocalRef = useRef<T>(value);
  latestLocalRef.current = localValue;
  const onPersistRef = useRef(onPersist);
  onPersistRef.current = onPersist;

  useEffect(() => {
    if (!isDirtyRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback((): Promise<boolean> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (isDirtyRef.current) {
      isDirtyRef.current = false;
      const res = onPersistRef.current(latestLocalRef.current);
      if (res instanceof Promise) {
        return res;
      }
      return Promise.resolve(true);
    }
    return Promise.resolve(true);
  }, []);

  const handleChange = useCallback(
    (nextVal: T) => {
      latestLocalRef.current = nextVal;
      setLocalValue(nextVal);
      isDirtyRef.current = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, delay);
    },
    [delay, flush],
  );

  const handleBlur = useCallback(() => {
    void flush();
  }, [flush]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        void flush();
      }
    },
    [flush],
  );

  useEffect(() => {
    const updaterInstance: DebouncedSettingsUpdater = {
      updateSettings: () => {},
      flush,
      cancel: () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        isDirtyRef.current = false;
      },
      getPendingPatch: () => (isDirtyRef.current ? { value: latestLocalRef.current } : {}),
      hasPending: () => isDirtyRef.current,
    };
    const unregister = registerDebouncedUpdater(updaterInstance);
    return () => {
      unregister();
      void flush();
    };
  }, [flush]);

  return {
    value: localValue,
    setValue: handleChange,
    onChange: handleChange,
    onBlur: handleBlur,
    onKeyDown: handleKeyDown,
    flush,
    isDirty: isDirtyRef.current,
  };
}

export { useSettingsPersistence, type SettingsPersistenceState, type SettingsSaveStatus };

// ── One-time migration from localStorage ─────────────────────────────

export function buildLegacyServerSettingsMigrationPatch(
  legacySettings: Record<string, unknown>,
): ServerSettingsPatch {
  const patch: DeepMutable<ServerSettingsPatch> = {};

  if (Predicate.isBoolean(legacySettings.enableAssistantStreaming)) {
    patch.enableAssistantStreaming = legacySettings.enableAssistantStreaming;
  }

  if (Schema.is(ThreadEnvMode)(legacySettings.defaultThreadEnvMode)) {
    patch.defaultThreadEnvMode = legacySettings.defaultThreadEnvMode;
  }

  if (Schema.is(ModelSelection)(legacySettings.textGenerationModelSelection)) {
    patch.textGenerationModelSelection =
      legacySettings.textGenerationModelSelection as unknown as NonNullable<
        (typeof patch)["textGenerationModelSelection"]
      >;
  }

  if (typeof legacySettings.codexBinaryPath === "string") {
    patch.providers ??= {};
    patch.providers.codex ??= {};
    patch.providers.codex.binaryPath = legacySettings.codexBinaryPath;
  }

  if (typeof legacySettings.codexHomePath === "string") {
    patch.providers ??= {};
    patch.providers.codex ??= {};
    patch.providers.codex.homePath = legacySettings.codexHomePath;
  }

  if (Array.isArray(legacySettings.customCodexModels)) {
    patch.providers ??= {};
    patch.providers.codex ??= {};
    patch.providers.codex.customModels = normalizeCustomModelSlugs(
      legacySettings.customCodexModels,
      new Set<string>(),
      "codex",
    );
  }

  if (Predicate.isString(legacySettings.claudeBinaryPath)) {
    patch.providers ??= {};
    patch.providers.claudeAgent ??= {};
    patch.providers.claudeAgent.binaryPath = legacySettings.claudeBinaryPath;
  }

  if (Array.isArray(legacySettings.customClaudeModels)) {
    patch.providers ??= {};
    patch.providers.claudeAgent ??= {};
    patch.providers.claudeAgent.customModels = normalizeCustomModelSlugs(
      legacySettings.customClaudeModels,
      new Set<string>(),
      "claudeAgent",
    );
  }

  if (Array.isArray(legacySettings.favorites)) {
    patch.favorites = legacySettings.favorites as NonNullable<(typeof patch)["favorites"]>;
  }

  return patch;
}

export function buildLegacyClientSettingsMigrationPatch(
  legacySettings: Record<string, unknown>,
): Partial<DeepMutable<ClientSettings>> {
  const patch: Partial<DeepMutable<ClientSettings>> = {};

  if (Predicate.isBoolean(legacySettings.confirmThreadDelete)) {
    patch.confirmThreadDelete = legacySettings.confirmThreadDelete;
  }

  if (Schema.is(DesktopIconTheme)(legacySettings.desktopIconTheme)) {
    patch.desktopIconTheme = legacySettings.desktopIconTheme;
  } else if (Predicate.isString(legacySettings.desktopIconTheme)) {
    patch.desktopIconTheme = DEFAULT_DESKTOP_ICON_THEME;
  }

  if (Predicate.isBoolean(legacySettings.diffWordWrap)) {
    patch.diffWordWrap = legacySettings.diffWordWrap;
  }

  if (Schema.is(SidebarProjectSortOrder)(legacySettings.sidebarProjectSortOrder)) {
    patch.sidebarProjectSortOrder = legacySettings.sidebarProjectSortOrder;
  }

  if (Schema.is(SidebarThreadSortOrder)(legacySettings.sidebarThreadSortOrder)) {
    patch.sidebarThreadSortOrder = legacySettings.sidebarThreadSortOrder;
  }

  if (Schema.is(TimestampFormat)(legacySettings.timestampFormat)) {
    patch.timestampFormat = legacySettings.timestampFormat;
  }

  return patch;
}

/**
 * Call once on app startup.
 * If the legacy localStorage key exists, migrate its values to the new server
 * and client storage formats, then remove the legacy key so this only runs once.
 */
export function migrateLocalSettingsToServer(): void {
  if (typeof window === "undefined") return;

  const raw = localStorage.getItem(OLD_SETTINGS_KEY);
  if (!raw) return;

  try {
    const old = JSON.parse(raw);
    if (!Predicate.isObject(old)) return;

    // Migrate server-relevant keys via RPC
    const serverPatch = buildLegacyServerSettingsMigrationPatch(old);
    if (Object.keys(serverPatch).length > 0) {
      const api = ensureNativeApi();
      void api.server.updateSettings(serverPatch);
    }

    // Migrate client-only keys to the new localStorage key
    const clientPatch = buildLegacyClientSettingsMigrationPatch(old);
    if (Object.keys(clientPatch).length > 0) {
      const existing = localStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY);
      const current = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
      localStorage.setItem(
        CLIENT_SETTINGS_STORAGE_KEY,
        JSON.stringify({ ...current, ...clientPatch }),
      );
    }
  } catch (error) {
    console.error("[MIGRATION] Error migrating local settings:", error);
  } finally {
    // Remove the legacy key regardless to keep migration one-shot behavior.
    localStorage.removeItem(OLD_SETTINGS_KEY);
  }
}

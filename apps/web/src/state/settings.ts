import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  type ResolvedKeybindingsConfig,
  type ServerConfig,
  type ServerConfigUpdatedPayload,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@tabs/contracts";
import {
  type ClientSettings,
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
} from "@tabs/contracts/settings";
import { Atom } from "@tabs/client-runtime/state";
import { useEffect } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { setEnvironmentThemes, refreshTheme } from "../hooks/useTheme";
import { ensureNativeApi } from "../nativeApi";
import { appAtomRegistry } from "./atomRegistry";

const CLIENT_SETTINGS_STORAGE_KEY = "tabs:client-settings:v1";

export const serverConfigAtom = Atom.make<ServerConfig | null>(null).pipe(
  Atom.withLabel("tabs-server-config"),
  Atom.keepAlive,
);

export const serverSettingsAtom = Atom.make((get): ServerSettings => {
  const loaded = get(serverConfigAtom)?.settings;
  if (!loaded) return DEFAULT_SERVER_SETTINGS;
  const mergedProviders = {
    ...DEFAULT_SERVER_SETTINGS.providers,
    ...loaded.providers,
  };
  const anyEnabled = Object.values(mergedProviders).some((p) => p && p.enabled !== false);
  if (!anyEnabled && mergedProviders.codex) {
    mergedProviders.codex = {
      ...mergedProviders.codex,
      enabled: true,
    };
  }
  return {
    ...loaded,
    providers: mergedProviders,
  };
}).pipe(Atom.withLabel("tabs-server-settings"));

export const keybindingsAtom = Atom.make((get): ResolvedKeybindingsConfig => {
  return get(serverConfigAtom)?.keybindings ?? [];
}).pipe(Atom.withLabel("tabs-keybindings"));

export const clientSettingsAtom = Atom.make<ClientSettings>(DEFAULT_CLIENT_SETTINGS).pipe(
  Atom.withLabel("tabs-client-settings"),
  Atom.keepAlive,
);

let clientSettingsHydrated = false;
let refreshServerConfigPromise: Promise<ServerConfig | null> | null = null;

export function setServerConfig(config: ServerConfig) {
  appAtomRegistry.set(serverConfigAtom, config);
  setEnvironmentThemes(config.environmentThemes ?? []);
}

export function applyServerConfigUpdate(payload: ServerConfigUpdatedPayload) {
  if (payload.environmentThemes) setEnvironmentThemes(payload.environmentThemes);
  appAtomRegistry.update(serverConfigAtom, (config) =>
    config === null
      ? config
      : {
          ...config,
          providers: payload.providers,
          ...(payload.settings ? { settings: payload.settings } : {}),
          ...(payload.environmentThemes ? { environmentThemes: payload.environmentThemes } : {}),
          ...(payload.usageLimitSources ? { usageLimitSources: payload.usageLimitSources } : {}),
        },
  );
}

export function patchServerSettings(
  patch: ServerSettingsPatch,
  merge: (current: ServerSettings) => ServerSettings,
) {
  appAtomRegistry.update(serverConfigAtom, (config) =>
    config === null ? config : { ...config, settings: merge(config.settings) },
  );
}

export function rollbackServerSettings(previousSettings: ServerSettings) {
  appAtomRegistry.update(serverConfigAtom, (config) =>
    config === null ? config : { ...config, settings: previousSettings },
  );
}

export function rollbackClientSettings(previousSettings: ClientSettings) {
  appAtomRegistry.set(clientSettingsAtom, previousSettings);
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.dataset.diffColorScheme = previousSettings.diffColorScheme;
  }
  try {
    setLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, previousSettings, ClientSettingsSchema);
  } catch (error) {
    console.error("[CLIENT_SETTINGS] rollback persist failed", error);
  }
}

export type SettingsSaveStatus = "idle" | "pending" | "saving" | "saved" | "failed";

export interface SettingsPersistenceState {
  status: SettingsSaveStatus;
  error?: string | null;
  lastSavedAt?: number | null;
  failedPatch?: Record<string, any> | null;
  retry?: (() => Promise<boolean>) | null;
}

export const settingsPersistenceAtom = Atom.make<SettingsPersistenceState>({
  status: "idle",
  error: null,
  lastSavedAt: null,
  failedPatch: null,
  retry: null,
}).pipe(Atom.withLabel("tabs-settings-persistence"), Atom.keepAlive);

export function setSettingsPersistence(state: SettingsPersistenceState) {
  appAtomRegistry.set(settingsPersistenceAtom, state);
}

export function updateSettingsPersistence(
  updater: (prev: SettingsPersistenceState) => SettingsPersistenceState,
) {
  appAtomRegistry.update(settingsPersistenceAtom, updater);
}

export function useSettingsPersistence(): SettingsPersistenceState {
  return useAtomValue(settingsPersistenceAtom);
}

export function hydrateClientSettings(force = false) {
  if (clientSettingsHydrated && !force) return;
  clientSettingsHydrated = true;
  try {
    const persisted = getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, ClientSettingsSchema);
    const settings = persisted ?? DEFAULT_CLIENT_SETTINGS;
    appAtomRegistry.set(clientSettingsAtom, settings);
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.dataset.diffColorScheme = settings.diffColorScheme;
    }
    if (settings.aiProvider && typeof window !== "undefined") {
      void window.desktopBridge?.setAiProvider?.(settings.aiProvider);
    }
  } catch (error) {
    console.error("[CLIENT_SETTINGS] hydrate failed", error);
    appAtomRegistry.set(clientSettingsAtom, DEFAULT_CLIENT_SETTINGS);
  }
}

export function updateClientSettings(update: (current: ClientSettings) => ClientSettings) {
  hydrateClientSettings();
  appAtomRegistry.update(clientSettingsAtom, (current) => {
    const next = update(current);
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.dataset.diffColorScheme = next.diffColorScheme;
    }
    if (next.diffColorScheme && next.diffColorScheme !== current.diffColorScheme) {
      refreshTheme();
    }
    if (
      next.aiProvider &&
      next.aiProvider !== current.aiProvider &&
      typeof window !== "undefined"
    ) {
      void window.desktopBridge?.setAiProvider?.(next.aiProvider);
    }
    try {
      setLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, next, ClientSettingsSchema);
    } catch (error) {
      console.error("[CLIENT_SETTINGS] persist failed", error);
    }
    return next;
  });
}

export function refreshServerConfig(): Promise<ServerConfig | null> {
  if (refreshServerConfigPromise) return refreshServerConfigPromise;
  refreshServerConfigPromise = ensureNativeApi()
    .server.getConfig()
    .then((config) => {
      if (config) {
        setServerConfig(config);
      }
      return config;
    })
    .catch((error) => {
      console.warn("[SERVER_CONFIG] refresh failed", error);
      return null;
    })
    .finally(() => {
      refreshServerConfigPromise = null;
    });
  return refreshServerConfigPromise;
}

export function useServerConfig(): ServerConfig | null {
  const config = useAtomValue(serverConfigAtom);
  useEffect(() => {
    void refreshServerConfig();
  }, []);
  return config;
}

export function useServerSettings(): ServerSettings {
  return useAtomValue(serverSettingsAtom);
}

export function useKeybindings(): ResolvedKeybindingsConfig {
  return useAtomValue(keybindingsAtom);
}

export function useClientSettings(): ClientSettings {
  const settings = useAtomValue(clientSettingsAtom);
  useEffect(() => {
    hydrateClientSettings();
  }, []);
  return settings;
}

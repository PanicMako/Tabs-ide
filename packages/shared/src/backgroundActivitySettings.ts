import {
  type BackgroundActivityProfile,
  type BackgroundActivitySettings,
  DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL,
  DEFAULT_BACKGROUND_ACTIVITY_PROFILE,
  DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL,
  type ServerSettings,
} from "@tabs/contracts";
import * as Duration from "effect/Duration";

export interface ResolvedBackgroundActivitySettings {
  readonly profile: BackgroundActivityProfile;
  readonly automaticGitFetchInterval: Duration.Duration;
  readonly providerHealthRefreshInterval: Duration.Duration;
  readonly hostPowerMonitorActiveInterval: Duration.Duration;
  readonly hostPowerMonitorIdleInterval: Duration.Duration;
  readonly idleClientTtl: Duration.Duration;
  readonly pauseWhenHostLocked: boolean;
  readonly pauseWhenHostLowPower: boolean;
  readonly pauseWhenClientLowPower: boolean;
  readonly pauseWhenOnBattery: boolean;
}

const PRESETS: Record<BackgroundActivityProfile, ResolvedBackgroundActivitySettings> = {
  performance: {
    profile: "performance",
    automaticGitFetchInterval: Duration.seconds(15),
    providerHealthRefreshInterval: Duration.minutes(1),
    hostPowerMonitorActiveInterval: Duration.seconds(30),
    hostPowerMonitorIdleInterval: Duration.minutes(2),
    idleClientTtl: Duration.seconds(45),
    pauseWhenHostLocked: true,
    pauseWhenHostLowPower: false,
    pauseWhenClientLowPower: false,
    pauseWhenOnBattery: false,
  },
  balanced: {
    profile: "balanced",
    automaticGitFetchInterval: DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL,
    providerHealthRefreshInterval: DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL,
    hostPowerMonitorActiveInterval: Duration.seconds(30),
    hostPowerMonitorIdleInterval: Duration.minutes(5),
    idleClientTtl: Duration.seconds(45),
    pauseWhenHostLocked: true,
    pauseWhenHostLowPower: true,
    pauseWhenClientLowPower: true,
    pauseWhenOnBattery: false,
  },
  "battery-saver": {
    profile: "battery-saver",
    automaticGitFetchInterval: Duration.zero,
    providerHealthRefreshInterval: Duration.minutes(15),
    hostPowerMonitorActiveInterval: Duration.minutes(1),
    hostPowerMonitorIdleInterval: Duration.minutes(10),
    idleClientTtl: Duration.seconds(45),
    pauseWhenHostLocked: true,
    pauseWhenHostLowPower: true,
    pauseWhenClientLowPower: true,
    pauseWhenOnBattery: true,
  },
};

export function getBackgroundActivityPresetSettings(profile: BackgroundActivityProfile) {
  return PRESETS[profile];
}

export function resolveBackgroundActivitySettings(
  settings: BackgroundActivitySettings,
): ResolvedBackgroundActivitySettings {
  const base =
    settings.profile === "custom"
      ? (settings.baseProfile ?? DEFAULT_BACKGROUND_ACTIVITY_PROFILE)
      : settings.profile;
  const preset = PRESETS[base];
  const overrides = settings.profile === "custom" ? settings.overrides : {};
  return { ...preset, ...overrides, profile: base };
}

export function resolveServerBackgroundActivitySettings(
  settings: ServerSettings,
): ResolvedBackgroundActivitySettings {
  const configured = resolveBackgroundActivitySettings(settings.backgroundActivity);
  if (
    settings.backgroundActivity.profile !== DEFAULT_BACKGROUND_ACTIVITY_PROFILE ||
    Object.keys(settings.backgroundActivity.overrides).length > 0
  )
    return configured;
  const legacyPreset = PRESETS[settings.backgroundActivityProfile];
  return {
    ...legacyPreset,
    automaticGitFetchInterval: settings.automaticGitFetchInterval,
    providerHealthRefreshInterval: settings.providerHealthRefreshInterval,
  };
}

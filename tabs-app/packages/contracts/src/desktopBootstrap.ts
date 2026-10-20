import * as Schema from "effect/Schema";

import { PortSchema } from "./baseSchemas.ts";

export const DesktopBackendBootstrap = Schema.Struct({
  mode: Schema.Literal("desktop"),
  noBrowser: Schema.optionalKey(Schema.Boolean),
  port: PortSchema,
  // Omitted when the desktop launches the backend inside WSL, since the
  // Windows-side baseDir maps to /mnt/c/... and the Linux side should use its
  // own home directory instead.
  t3Home: Schema.optionalKey(Schema.String),
  tabsHome: Schema.optionalKey(Schema.String),
  host: Schema.optionalKey(Schema.String),
  desktopBootstrapToken: Schema.optionalKey(Schema.String),
  authToken: Schema.optionalKey(Schema.String),
  desktopExtensionBroker: Schema.optionalKey(
    Schema.Struct({ endpoint: Schema.String, token: Schema.String }),
  ),
  desktopBootstrapSecret: Schema.optionalKey(Schema.String),
  desktopTelemetryFd: Schema.optionalKey(Schema.Int),
  desktopTelemetryControlFd: Schema.optionalKey(Schema.Int),
  // Delivered over the bootstrap pipe after the parent login-shell lookup.
  shellEnvironment: Schema.optionalKey(
    Schema.Struct({
      PATH: Schema.String.check(Schema.isMinLength(1)),
      SSH_AUTH_SOCK: Schema.optionalKey(Schema.String),
    }),
  ),
  resourceMonitorPath: Schema.optionalKey(Schema.String),
  tailscaleServeEnabled: Schema.optionalKey(Schema.Boolean),
  tailscaleServePort: Schema.optionalKey(PortSchema),
  otlpTracesUrl: Schema.optionalKey(Schema.String),
  otlpMetricsUrl: Schema.optionalKey(Schema.String),
  otlpLogsUrl: Schema.optionalKey(Schema.String),
});

export type DesktopBackendBootstrap = typeof DesktopBackendBootstrap.Type;

/** Written to `<t3Home>/runtime` just before the desktop app stops its
    backend to install an update. The updated app starts a new backend right
    away, so a backend that sees a fresh marker at shutdown keeps its managed
    tunnel. */
export const DESKTOP_UPDATE_RESTART_MARKER_FILE = "desktop-update-restart";

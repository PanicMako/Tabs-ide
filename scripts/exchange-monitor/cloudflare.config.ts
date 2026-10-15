import { defineConfig, triggers } from "cf/config";

export default defineConfig({
  worker: {
    name: "tabs-exchange-monitor",
    entrypoint: "./worker.mjs",
    compatibilityDate: "2026-10-15",
    workersDev: false,
    observability: {
      enabled: true,
      traces: { enabled: true },
    },
    triggers: [triggers.scheduled({ schedule: "*/10 * * * *" })],
  },
});

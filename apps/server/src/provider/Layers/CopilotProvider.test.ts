import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CopilotSettings } from "@tabs/contracts";

import {
  buildCopilotModelsFromCatalog,
  buildInitialCopilotProviderSnapshot,
  checkCopilotProviderStatus,
  classifyCopilotCatalogFailure,
} from "./CopilotProvider";

const decodeCopilotSettings = Schema.decodeSync(CopilotSettings);

describe("buildInitialCopilotProviderSnapshot", () => {
  it.effect("returns a disabled snapshot when settings.enabled is false", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialCopilotProviderSnapshot(
        decodeCopilotSettings({ enabled: false }),
      );
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.installed).toBe(false);
      expect(snapshot.message).toContain("disabled");
      expect(snapshot.models).toHaveLength(0);
    }),
  );

  it.effect("returns a pending snapshot with empty model list by default (Decision 1)", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialCopilotProviderSnapshot(
        decodeCopilotSettings({ enabled: true }),
      );
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.version).toBeNull();
      expect(snapshot.models).toHaveLength(0);
      expect(snapshot.requiresNewThreadForModelChange).toBe(false);
    }),
  );
});

describe("classifyCopilotCatalogFailure", () => {
  it("distinguishes authentication, explicit entitlement, and transient failures", () => {
    expect(classifyCopilotCatalogFailure("Authentication required; run copilot login")).toBe(
      "unauthenticated",
    );
    expect(classifyCopilotCatalogFailure("No active seat for this account")).toBe("unentitled");
    expect(classifyCopilotCatalogFailure("Connection reset by peer")).toBe("unknown");
  });
});

describe("buildCopilotModelsFromCatalog", () => {
  it("normalizes only descriptors advertised by models.list", () => {
    const models = buildCopilotModelsFromCatalog([
      {
        id: "account-model-a",
        name: "Account Model A",
        capabilities: {
          supports: { vision: false, reasoningEffort: true },
          limits: { max_context_window_tokens: 1000 },
        },
        supportedReasoningEfforts: ["low", "high"],
        defaultReasoningEffort: "low",
      },
      {
        id: "account-model-b",
        name: "Account Model B",
        capabilities: {
          supports: { vision: false, reasoningEffort: false },
          limits: { max_context_window_tokens: 1000 },
        },
      },
    ]);

    expect(models.map((model) => model.slug)).toEqual(["account-model-a", "account-model-b"]);
    expect(models[0]?.capabilities?.reasoningEffortLevels).toEqual([
      { value: "low", label: "low", isDefault: true },
      { value: "high", label: "high" },
    ]);
  });

  it("omits malformed and duplicate descriptors without inventing fallbacks", () => {
    const models = buildCopilotModelsFromCatalog([
      {
        id: "",
        name: "Missing id",
        capabilities: {
          supports: { vision: false, reasoningEffort: false },
          limits: { max_context_window_tokens: 0 },
        },
      },
      {
        id: "account-model",
        name: "Account Model",
        capabilities: {
          supports: { vision: false, reasoningEffort: false },
          limits: { max_context_window_tokens: 0 },
        },
      },
      {
        id: "account-model",
        name: "Duplicate",
        capabilities: {
          supports: { vision: false, reasoningEffort: false },
          limits: { max_context_window_tokens: 0 },
        },
      },
    ]);
    expect(models.map((model) => model.slug)).toEqual(["account-model"]);
  });

  it("accepts a successful empty catalog", () => {
    expect(buildCopilotModelsFromCatalog([])).toEqual([]);
  });
});

it.layer(NodeServices.layer)("checkCopilotProviderStatus", (it) => {
  it.effect("reports the binary as missing when binary path does not resolve", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkCopilotProviderStatus(
        decodeCopilotSettings({
          enabled: true,
          binaryPath: "/definitely/not/installed/copilot-binary-path",
        }),
      );
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.models).toHaveLength(0);
      expect(snapshot.message).toMatch(/not installed|not on PATH|Failed to execute/);
    }),
  );
});

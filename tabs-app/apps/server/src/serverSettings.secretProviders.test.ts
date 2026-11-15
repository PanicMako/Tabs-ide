import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import { ServerSettings, SecretProviderId, SecretProviderKind } from "@tabs/contracts";

import { redactServerSettingsForClient } from "./serverSettings.ts";

const decode = Schema.decodeUnknownSync(ServerSettings);

describe("secret providers in server settings", () => {
  it("defaults to none and round-trips an entry", () => {
    expect(decode({}).secretProviders).toEqual({});
    const settings = decode({
      secretProviders: {
        work: { kind: "one_password", label: "Work", config: { account: "my.1password.com" } },
      },
    });
    expect(settings.secretProviders[SecretProviderId.make("work")]).toMatchObject({
      kind: SecretProviderKind.make("one_password"),
      label: "Work",
    });
  });

  it("never sends a client the config of a kind this server cannot check", () => {
    const settings = decode({
      secretProviders: {
        known: { kind: "one_password", label: "Known", config: { account: "a.1password.com" } },
        newer: { kind: "future_vault", label: "Newer", config: { token: "do-not-send" } },
      },
    });
    const redacted = redactServerSettingsForClient(settings);
    expect(redacted.secretProviders[SecretProviderId.make("known")]).toHaveProperty("config");
    expect(redacted.secretProviders[SecretProviderId.make("newer")]).not.toHaveProperty("config");
  });

  it("shows a provider variable's secret reference as written instead of redacting it", () => {
    const settings = decode({
      providerInstances: {
        codex: {
          driver: "codex",
          environment: [
            {
              name: "OPENAI_API_KEY",
              value: "",
              secret: { provider: "work", reference: "op://v/i/f" },
            },
          ],
        },
      },
    });
    const redacted = redactServerSettingsForClient(settings);
    const variable =
      redacted.providerInstances[Object.keys(redacted.providerInstances)[0]! as never]
        ?.environment?.[0];
    expect(variable?.value).toEqual({ provider: "work", reference: "op://v/i/f" });
  });
});

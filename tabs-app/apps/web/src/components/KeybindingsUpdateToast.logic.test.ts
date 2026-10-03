import type { ServerConfigStreamEvent, ServerConfigUpdatedPayload } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import {
  createKeybindingsUpdateToastController,
  KEYBINDINGS_SUCCESS_TOAST_COOLDOWN_MS,
} from "./KeybindingsUpdateToast.logic";

function keybindingsStreamEvent(
  overrides: Partial<Extract<ServerConfigStreamEvent, { type: "keybindingsUpdated" }>> = {},
): Extract<ServerConfigStreamEvent, { type: "keybindingsUpdated" }> {
  return {
    version: 1,
    type: "keybindingsUpdated",
    payload: {
      keybindings: [],
      issues: [],
    },
    ...overrides,
  };
}

function keybindingsPayload(
  overrides: Partial<ServerConfigUpdatedPayload> = {},
): ServerConfigUpdatedPayload {
  return {
    issues: [],
    providers: [],
    ...overrides,
  };
}

describe("keybindings update toast policy", () => {
  it("coalesces repeated successful reload notifications during the cooldown", () => {
    let now = 1_000;
    const controller = createKeybindingsUpdateToastController({
      now: () => now,
    });

    expect(controller.handle(keybindingsStreamEvent())).toEqual({ _tag: "Success" });

    now += KEYBINDINGS_SUCCESS_TOAST_COOLDOWN_MS - 1;
    expect(controller.handle(keybindingsStreamEvent())).toBeNull();

    now += 1;
    expect(controller.handle(keybindingsStreamEvent())).toEqual({ _tag: "Success" });
  });

  it("coalesces repeated payload updates during the cooldown", () => {
    let now = 5_000;
    const controller = createKeybindingsUpdateToastController({
      now: () => now,
    });

    expect(controller.handle(keybindingsPayload())).toEqual({ _tag: "Success" });

    now += 500;
    expect(controller.handle(keybindingsPayload())).toBeNull();

    now += KEYBINDINGS_SUCCESS_TOAST_COOLDOWN_MS;
    expect(controller.handle(keybindingsPayload())).toEqual({ _tag: "Success" });
  });

  it("surfaces keybinding configuration issues from stream event", () => {
    const controller = createKeybindingsUpdateToastController({});

    expect(
      controller.handle(
        keybindingsStreamEvent({
          payload: {
            keybindings: [],
            issues: [
              {
                kind: "keybindings.malformed-config",
                message: "Expected JSON array",
              },
            ],
          },
        }),
      ),
    ).toEqual({
      _tag: "InvalidConfiguration",
      message: "Expected JSON array",
    });
  });

  it("surfaces keybinding configuration issues from payload", () => {
    const controller = createKeybindingsUpdateToastController({});

    expect(
      controller.handle(
        keybindingsPayload({
          issues: [
            {
              kind: "keybindings.invalid-entry",
              message: "Syntax error in keybindings.json",
              index: 0,
            },
          ],
        }),
      ),
    ).toEqual({
      _tag: "InvalidConfiguration",
      message: "Syntax error in keybindings.json",
    });
  });

  it("ignores unrelated server config notifications", () => {
    const controller = createKeybindingsUpdateToastController({});

    expect(
      controller.handle({
        version: 1,
        type: "settingsUpdated",
        payload: { settings: {} as never },
      }),
    ).toBeNull();

    expect(
      controller.handle(
        keybindingsPayload({
          settings: {} as never,
        }),
      ),
    ).toBeNull();
  });
});

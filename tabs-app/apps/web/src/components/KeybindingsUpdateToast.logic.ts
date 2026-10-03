import type {
  ServerConfigIssue,
  ServerConfigStreamEvent,
  ServerConfigUpdatedPayload,
} from "@tabs/contracts";

export const KEYBINDINGS_SUCCESS_TOAST_COOLDOWN_MS = 2_000;

export type KeybindingsUpdateToastDecision =
  | { readonly _tag: "Success" }
  | { readonly _tag: "InvalidConfiguration"; readonly message: string };

export type KeybindingsUpdateEventLike =
  | ServerConfigStreamEvent
  | ServerConfigUpdatedPayload
  | {
      readonly type: "keybindingsUpdated";
      readonly payload: { readonly issues: ReadonlyArray<ServerConfigIssue> };
    }
  | { readonly issues?: ReadonlyArray<ServerConfigIssue>; readonly settings?: unknown }
  | null
  | undefined;

export interface KeybindingsUpdateToastController {
  readonly handle: (event: KeybindingsUpdateEventLike) => KeybindingsUpdateToastDecision | null;
}

export function createKeybindingsUpdateToastController(input: {
  readonly now?: () => number;
}): KeybindingsUpdateToastController {
  const now = input.now ?? Date.now;
  let lastSuccessToastAt: number | null = null;

  return {
    handle: (event) => {
      if (!event) {
        return null;
      }

      // If it's a tagged event like ServerConfigStreamEvent:
      if ("type" in event) {
        if (event.type !== "keybindingsUpdated") {
          return null;
        }
        const issues = event.payload?.issues ?? [];
        const issue = issues.find((entry) => entry.kind.startsWith("keybindings."));
        if (issue) {
          return {
            _tag: "InvalidConfiguration",
            message: issue.message,
          };
        }
      } else {
        // If it's a ServerConfigUpdatedPayload:
        // Ignore settings updates
        if (event.settings) {
          return null;
        }
        const issues = event.issues ?? [];
        const issue = issues.find((entry) => entry.kind.startsWith("keybindings."));
        if (issue) {
          return {
            _tag: "InvalidConfiguration",
            message: issue.message,
          };
        }
      }

      const currentTime = now();
      if (
        lastSuccessToastAt !== null &&
        currentTime - lastSuccessToastAt < KEYBINDINGS_SUCCESS_TOAST_COOLDOWN_MS
      ) {
        return null;
      }

      lastSuccessToastAt = currentTime;
      return { _tag: "Success" };
    },
  };
}

import type { NativeComputerCapabilities, NativeWindowChoice } from "@tabs/contracts";
import type { DiffableSnapshot } from "./treeDiff.ts";

export interface RuntimeSnapshot {
  readonly id: string;
  readonly app: { readonly name: string; readonly bundleId: string | null; readonly pid: number };
  readonly window: {
    readonly title: string;
    readonly key: string;
    readonly frame: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  };
  readonly treeText: string;
  readonly elementCount: number;
  readonly focusedElementIndex: number | null;
  readonly truncated: boolean;
  readonly elements?: ReadonlyArray<string | null>;
  readonly scale?: number;
  readonly display?: string;
}

export interface RuntimeAction {
  readonly path: "accessibility" | "synthetic";
  readonly detail: string;
  readonly fallbackReason?: string;
  /** `background` means the app was not raised and the real pointer did not move. */
  readonly delivery?: "background" | "foreground";
  /** Present when the runtime read the target back after writing it. */
  readonly verification?: { readonly state: "verified" | "unverified"; readonly detail: string };
}

export interface RuntimeAppInfo {
  readonly name: string;
  readonly bundleId: string | null;
  readonly pid: number;
  readonly active?: boolean;
  readonly hidden?: boolean;
}

export interface RuntimeSuccess {
  readonly ok: true;
  readonly handoff?: string;
  readonly userDemonstration?: string;
  readonly permissions?: {
    readonly accessibility: boolean;
    readonly capabilities?: NativeComputerCapabilities;
    readonly screenRecording: "granted" | "denied" | "unknown";
  };
  readonly windows?: ReadonlyArray<NativeWindowChoice>;
  readonly apps?: ReadonlyArray<RuntimeAppInfo>;
  readonly app?: RuntimeAppInfo;
  readonly frame?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly action?: RuntimeAction;
  readonly snapshot?: RuntimeSnapshot;
}

export interface RuntimeFailure {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

export type RuntimeResponse = RuntimeSuccess | RuntimeFailure;

/** osascript prints the script's return value as the last line; warnings may precede it. */
export function parseRuntimeResponse(stdout: string, stderr = ""): RuntimeResponse {
  const line = stdout
    .trim()
    .split("\n")
    .findLast((candidate) => candidate.startsWith("{"));
  if (line !== undefined) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null && "ok" in parsed) {
        return parsed as RuntimeResponse;
      }
    } catch {
      // Fall through to the generic failure below.
    }
  }
  const detail = stderr.trim().split("\n").at(-1) ?? "";
  return {
    ok: false,
    code: "accessibility_error",
    message: detail
      ? `The desktop runtime failed: ${detail}`
      : "The desktop runtime returned no result.",
  };
}

export function toDiffable(session: string, snapshot: RuntimeSnapshot): DiffableSnapshot {
  return {
    session,
    pid: snapshot.app.pid,
    windowKey: snapshot.window.key,
    snapshotId: snapshot.id,
    treeText: snapshot.treeText,
  };
}

/** Hints appended to a failure so the agent knows the next safe step. */
export function failureAdvice(code: string): string {
  switch (code) {
    case "permission_denied":
      return "Ask the user to grant the permission in System Settings > Privacy & Security, then call computer_permissions.";
    case "stale_observation":
    case "element_not_found":
      return "Call computer_snapshot again and use the new observation and indexes.";
    case "window_stale":
      return "Check whether the same window is still open. Ask the user to attach it again if its identity changed.";
    case "sensitive_field":
      return "Do not retry. The user must enter secrets themselves.";
    case "app_blocked":
      return "Do not retry: password managers are never driven.";
    case "background_unavailable":
      return "Use an accessibility action, or ask the user to allow physical input and bring the selected window to the front.";
    case "action_not_supported":
    case "value_not_settable":
      return "Try computer_click or computer_type on the element instead.";
    case "app_not_found":
      return "Call computer_list_apps and pass a bundle id.";
    default:
      return "";
  }
}

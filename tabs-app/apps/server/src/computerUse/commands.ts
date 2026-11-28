import type { NativeWindowFrame } from "@tabs/contracts";
import { resolveKeySpec, type ParsedKey } from "./keySpec.ts";

/** Everything the JXA runtime needs to perform one operation. Plain JSON: it crosses a process boundary. */
export type ComputerRequest = RuntimeRequest & {
  readonly native?: NativeActionGuard;
  readonly controlFile?: string;
};

export interface NativeActionGuard {
  readonly foreground: boolean;
  readonly frame?: NativeWindowFrame;
  readonly scale?: number;
  readonly display?: string;
  readonly elements?: Readonly<Record<string, string>>;
  readonly focused?: string;
}

type RuntimeRequest =
  | { readonly op: "permissions" }
  | { readonly op: "listApps" }
  | { readonly op: "listWindows" }
  | { readonly op: "focusApp"; readonly app: AppSelector }
  | {
      readonly op: "snapshot";
      readonly app: AppSelector;
      readonly maxNodes: number;
      readonly rootElementIndex?: number;
    }
  | {
      readonly op: "click";
      readonly app: AppSelector;
      readonly target: Target;
      readonly clickCount: 1 | 2;
      readonly button: "left" | "right";
      readonly foreground: boolean;
      readonly maxNodes: number;
    }
  | {
      readonly op: "type";
      readonly app: AppSelector;
      readonly text: string;
      readonly elementIndex?: number;
      readonly maxNodes: number;
    }
  | {
      readonly op: "key";
      readonly app: AppSelector;
      readonly key: ParsedKey;
      readonly foreground: boolean;
      readonly maxNodes: number;
    }
  | {
      readonly op: "drag";
      readonly app: AppSelector;
      readonly from: Target;
      readonly to: Target;
      readonly foreground: boolean;
      readonly maxNodes: number;
    }
  | {
      readonly op: "setValue";
      readonly app: AppSelector;
      readonly elementIndex: number;
      readonly value: string;
      readonly maxNodes: number;
    }
  | {
      readonly op: "secondaryAction";
      readonly app: AppSelector;
      readonly elementIndex: number;
      readonly action: string;
      readonly maxNodes: number;
    }
  | { readonly op: "screenshot"; readonly app: AppSelector; readonly path: string }
  | {
      readonly op: "scroll";
      readonly app: AppSelector;
      readonly target: Target;
      readonly dx: number;
      readonly dy: number;
      readonly foreground: boolean;
      readonly maxNodes: number;
    }
  | { readonly op: "windowFrame"; readonly app: AppSelector };

export type AppComputerRequest = Extract<ComputerRequest, { readonly app: AppSelector }>;
export type AttachedAppSelector = Extract<AppSelector, { readonly kind: "attachment" }>;

export type AppSelector =
  | { readonly kind: "window"; readonly id: string }
  | { readonly kind: "attachment"; readonly selector: string }
  | { readonly kind: "pid"; readonly pid: number }
  | { readonly kind: "name"; readonly query: string };

export type Target =
  | { readonly kind: "element"; readonly index: number }
  | { readonly kind: "point"; readonly x: number; readonly y: number };

export type Parsed<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly message: string };

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

export const DEFAULT_MAX_NODES = 400;
export const MAX_MAX_NODES = 1500;
export const MAX_TYPE_LENGTH = 10_000;
export const MAX_SCROLL_AMOUNT = 50;

/** Accepts a bundle id, an app name, or `pid:<number>`. */
export function parseAppSelector(raw: string): Parsed<AppSelector> {
  const trimmed = raw.trim();
  if (trimmed === "")
    return fail("app is required: pass a bundle id or name from computer_list_apps.");
  if (trimmed.startsWith("window:")) {
    return { ok: true, value: { kind: "attachment", selector: trimmed } };
  }
  const pid = /^pid:(\d+)$/i.exec(trimmed);
  if (pid) {
    const value = Number(pid[1]);
    return value > 0
      ? { ok: true, value: { kind: "pid", pid: value } }
      : fail("pid must be positive.");
  }
  return { ok: true, value: { kind: "name", query: trimmed } };
}

function parseIndex(raw: number | undefined, label = "elementIndex"): Parsed<number | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  return Number.isInteger(raw) && raw >= 1
    ? { ok: true, value: raw }
    : fail(`${label} must be a positive integer taken from the latest snapshot.`);
}

function parseMaxNodes(raw: number | undefined): Parsed<number> {
  if (raw === undefined) return { ok: true, value: DEFAULT_MAX_NODES };
  return Number.isInteger(raw) && raw >= 20 && raw <= MAX_MAX_NODES
    ? { ok: true, value: raw }
    : fail(`maxNodes must be an integer from 20 to ${MAX_MAX_NODES}.`);
}

/** Exactly one of an element index or a window-local point. */
export function parseTarget(input: {
  readonly elementIndex?: number | undefined;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
}): Parsed<Target> {
  const index = parseIndex(input.elementIndex);
  if (!index.ok) return index;
  const hasPoint = input.x !== undefined || input.y !== undefined;
  if (index.value !== undefined && hasPoint)
    return fail("Pass either elementIndex or x and y, not both.");
  if (index.value !== undefined)
    return { ok: true, value: { kind: "element", index: index.value } };
  if (!hasPoint)
    return fail("Pass elementIndex from the latest snapshot, or window-local x and y.");
  const { x, y } = input;
  if (
    x === undefined ||
    y === undefined ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0
  ) {
    return fail("x and y must both be non-negative numbers in window points.");
  }
  return { ok: true, value: { kind: "point", x, y } };
}

export function buildSnapshotRequest(input: {
  readonly app: string;
  readonly query?: string | undefined;
  readonly maxNodes?: number | undefined;
  readonly rootElementIndex?: number | undefined;
}): Parsed<ComputerRequest> {
  const app = parseAppSelector(input.app);
  if (!app.ok) return app;
  const maxNodes = parseMaxNodes(input.maxNodes);
  if (!maxNodes.ok) return maxNodes;
  const root = parseIndex(input.rootElementIndex, "rootElementIndex");
  if (!root.ok) return root;
  return {
    ok: true,
    value: {
      op: "snapshot",
      app: app.value,
      maxNodes: maxNodes.value,
      ...(root.value === undefined ? {} : { rootElementIndex: root.value }),
    },
  };
}

export function buildClickRequest(input: {
  readonly app: string;
  readonly elementIndex?: number | undefined;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly doubleClick?: boolean | undefined;
  readonly button?: "left" | "right" | undefined;
  readonly foreground?: boolean | undefined;
}): Parsed<ComputerRequest> {
  const app = parseAppSelector(input.app);
  if (!app.ok) return app;
  const target = parseTarget(input);
  if (!target.ok) return target;
  return {
    ok: true,
    value: {
      op: "click",
      app: app.value,
      target: target.value,
      clickCount: input.doubleClick === true ? 2 : 1,
      button: input.button ?? "left",
      foreground: input.foreground === true,
      maxNodes: DEFAULT_MAX_NODES,
    },
  };
}

export function buildTypeRequest(input: {
  readonly app: string;
  readonly text: string;
  readonly elementIndex?: number | undefined;
}): Parsed<ComputerRequest> {
  const app = parseAppSelector(input.app);
  if (!app.ok) return app;
  if (input.text.length === 0) return fail("text must not be empty.");
  if (input.text.length > MAX_TYPE_LENGTH)
    return fail(`text is limited to ${MAX_TYPE_LENGTH} characters.`);
  const index = parseIndex(input.elementIndex);
  if (!index.ok) return index;
  return {
    ok: true,
    value: {
      op: "type",
      app: app.value,
      text: input.text,
      ...(index.value === undefined ? {} : { elementIndex: index.value }),
      maxNodes: DEFAULT_MAX_NODES,
    },
  };
}

export function buildKeyRequest(
  input: {
    readonly app: string;
    readonly key: string;
    readonly foreground?: boolean | undefined;
  },
  platform: NodeJS.Platform = "darwin",
): Parsed<ComputerRequest> {
  const app = parseAppSelector(input.app);
  if (!app.ok) return app;
  const key = resolveKeySpec(input.key, platform);
  if (!key.ok) return key;
  return {
    ok: true,
    value: {
      op: "key",
      app: app.value,
      key: key.key,
      foreground: input.foreground === true,
      maxNodes: DEFAULT_MAX_NODES,
    },
  };
}

const DIRECTIONS = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] } as const;
export type ScrollDirection = keyof typeof DIRECTIONS;

export function buildScrollRequest(input: {
  readonly app: string;
  readonly direction: string;
  readonly amount?: number | undefined;
  readonly elementIndex?: number | undefined;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly foreground?: boolean | undefined;
}): Parsed<ComputerRequest> {
  const app = parseAppSelector(input.app);
  if (!app.ok) return app;
  const direction = DIRECTIONS[input.direction as ScrollDirection];
  if (!direction) return fail("direction must be up, down, left or right.");
  const amount = input.amount ?? 5;
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_SCROLL_AMOUNT) {
    return fail(`amount must be an integer from 1 to ${MAX_SCROLL_AMOUNT} lines.`);
  }
  const target = parseTarget(input);
  if (!target.ok) return target;
  return {
    ok: true,
    value: {
      op: "scroll",
      app: app.value,
      target: target.value,
      dx: direction[0] * amount,
      dy: direction[1] * amount,
      foreground: input.foreground === true,
      maxNodes: DEFAULT_MAX_NODES,
    },
  };
}

export function buildDragRequest(input: {
  readonly app: string;
  readonly fromElementIndex?: number | undefined;
  readonly fromX?: number | undefined;
  readonly fromY?: number | undefined;
  readonly toElementIndex?: number | undefined;
  readonly toX?: number | undefined;
  readonly toY?: number | undefined;
  readonly foreground?: boolean | undefined;
}): Parsed<ComputerRequest> {
  const app = parseAppSelector(input.app);
  if (!app.ok) return app;
  const from = parseTarget({
    elementIndex: input.fromElementIndex,
    x: input.fromX,
    y: input.fromY,
  });
  if (!from.ok) return fail(`Drag start: ${from.message}`);
  const to = parseTarget({ elementIndex: input.toElementIndex, x: input.toX, y: input.toY });
  if (!to.ok) return fail(`Drag end: ${to.message}`);
  return {
    ok: true,
    value: {
      op: "drag",
      app: app.value,
      from: from.value,
      to: to.value,
      foreground: input.foreground === true,
      maxNodes: DEFAULT_MAX_NODES,
    },
  };
}

export function buildSetValueRequest(input: {
  readonly app: string;
  readonly elementIndex: number;
  readonly value: string;
}): Parsed<ComputerRequest> {
  const app = parseAppSelector(input.app);
  if (!app.ok) return app;
  const index = parseIndex(input.elementIndex);
  if (!index.ok || index.value === undefined) return fail("elementIndex is required.");
  if (input.value.length > MAX_TYPE_LENGTH)
    return fail(`value is limited to ${MAX_TYPE_LENGTH} characters.`);
  return {
    ok: true,
    value: {
      op: "setValue",
      app: app.value,
      elementIndex: index.value,
      value: input.value,
      maxNodes: DEFAULT_MAX_NODES,
    },
  };
}

const ACTION_NAME = /^[A-Za-z][A-Za-z0-9 _-]{0,63}$/;

export function buildSecondaryActionRequest(input: {
  readonly app: string;
  readonly elementIndex: number;
  readonly action: string;
}): Parsed<ComputerRequest> {
  const app = parseAppSelector(input.app);
  if (!app.ok) return app;
  const index = parseIndex(input.elementIndex);
  if (!index.ok || index.value === undefined) return fail("elementIndex is required.");
  const action = input.action.trim();
  if (!ACTION_NAME.test(action))
    return fail("action must be an action name the element lists, such as AXShowMenu or invoke.");
  return {
    ok: true,
    value: {
      op: "secondaryAction",
      app: app.value,
      elementIndex: index.value,
      action,
      maxNodes: DEFAULT_MAX_NODES,
    },
  };
}

/** Reads width and height from a PNG's IHDR chunk; null when the bytes are not a PNG. */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

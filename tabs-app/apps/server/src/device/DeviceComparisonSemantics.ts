import { createHash, randomUUID } from "node:crypto";
import type {
  DeviceComparisonControl,
  DeviceComparisonInput,
  DeviceComparisonTotal,
} from "@tabs/contracts";
import { readImageDimensions } from "@tabs/shared/imageDimensions";
import { PNG } from "pngjs";

import type { SemanticNode, SemanticSnapshot } from "./DeviceSemanticDriver.ts";

export interface ObservedControl extends DeviceComparisonControl {
  readonly ref: string;
  readonly parentIndex: number | undefined;
  readonly amountValue: string | undefined;
  readonly identifier?: string;
  readonly rect?: NonNullable<SemanticNode["rect"]>;
}

export interface DeviceObservation {
  readonly controls: ReadonlyArray<ObservedControl>;
  readonly identifierCounts: ReadonlyMap<string, number>;
  readonly screenKey?: string;
  readonly sourceTap?: {
    readonly id: string;
    readonly width: number;
    readonly height: number;
  };
  readonly png?: string;
}

export function comparisonScreenKey(snapshot: SemanticSnapshot): string | undefined {
  if (!snapshot.appBundleId || snapshot.truncated || snapshot.systemSurfaceOnly) return undefined;
  const visible = snapshot.nodes.filter((node) => node.visibleToUser !== false);
  if (visible.length === 0) return undefined;
  const screen = visible.map(({ ref: _ref, ...node }) => {
    // The Android status bar can tick while capturing an unchanged app.
    if (
      node.bundleId === "com.android.systemui" &&
      node.identifier === "com.android.systemui:id/clock"
    ) {
      const { label: _label, value: _value, ...clock } = node;
      return clock;
    }
    return node;
  });
  return createHash("sha256")
    .update(JSON.stringify([snapshot.appBundleId, screen]))
    .digest("hex");
}

const actionRoles = new Set([
  "button",
  "imagebutton",
  "link",
  "checkbox",
  "check box",
  "radio button",
  "radiobutton",
  "switch",
  "togglebutton",
  "tab",
  "menuitem",
  "menu item",
  "segmentedcontrol",
]);
// Labels that spend money, send data, or destroy something. "Checkout as guest" is a plain
// navigation step, so checkout only counts when it is placed, completed or confirmed.
const consequentialAction = new RegExp(
  String.raw`\b(?:pay(?:ment)?|purchase|buy|book|subscribe|donate|transfer|authori[sz]e|sign|delete|remove|discard|cancel|send|submit|publish|confirm|order now|(?:place|complete|finali[sz]e)\s+(?:\S+\s+){0,2}?(?:order|checkout|booking|purchase|payment|donation))\b`,
  "i",
);

export const normalizeLabel = (text: string) =>
  text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export const isConsequentialDeviceAction = (label: string) =>
  consequentialAction.test(normalizeLabel(label));

const label = (value: string | undefined) => {
  const text = value?.trim().replace(/\s+/g, " ");
  return text && text.length <= 180 ? text : undefined;
};

const monetaryValue = (value: string | undefined) =>
  value && /[$€£]|\b(?:USD|EUR|GBP)\b/.test(value) ? label(value) : undefined;

function sharedIdentifier(identifier: string | undefined, appId: string) {
  if (!identifier) return undefined;
  const prefix = `${appId}:id/`;
  const value = identifier.startsWith(prefix) ? identifier.slice(prefix.length) : identifier;
  // Match developer-defined names such as checkout_continue across Android resource IDs and iOS AX IDs.
  if (value.length > 96 || !/^[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z][A-Za-z0-9]*)+$/.test(value))
    return undefined;
  return value.replaceAll("-", "_");
}

function browserLocationMode(
  snapshot: SemanticSnapshot,
  node: SemanticNode,
): "display" | "editing" | undefined {
  const app = snapshot.appBundleId;
  // Safari gives the editing field a distinct native identifier.
  if (
    app === "com.apple.mobilesafari" &&
    node.type === "TextField" &&
    (node.identifier === "URL" || node.identifier === "TabBarItemTitle") &&
    snapshot.nodes.some(
      (other) =>
        other.index === node.parentIndex &&
        other.identifier === "CapsuleNavigationBar?isSelected=true",
    )
  )
    return node.identifier === "URL" || node.focused || node.editable ? "editing" : "display";
  if (
    app !== "com.android.chrome" ||
    node.type !== "android.widget.EditText" ||
    node.bundleId !== app ||
    node.identifier !== "com.android.chrome:id/url_bar"
  )
    return;
  if (node.focused) return "editing";
  const parent = snapshot.nodes.find(
    (other) =>
      other.index === node.parentIndex &&
      other.bundleId === app &&
      other.identifier === "com.android.chrome:id/location_bar",
  );
  if (parent?.parentIndex === undefined) return;
  // The tab switcher is shown beside the location display during browsing.
  const buttons = snapshot.nodes.find(
    (other) =>
      other.parentIndex === parent.parentIndex &&
      other.bundleId === app &&
      other.identifier === "com.android.chrome:id/toolbar_buttons",
  );
  return buttons &&
    snapshot.nodes.some(
      (other) =>
        other.parentIndex === buttons.index &&
        other.visibleToUser === true &&
        other.bundleId === app &&
        other.identifier === "com.android.chrome:id/tab_switcher_button",
    )
    ? "display"
    : "editing";
}

function isPlainWebAddress(value: string) {
  const address = value.trim().replace(/^\u200e/u, "");
  if (!address || /[\\@\s]/u.test(address)) return false;
  try {
    const url = new URL(address.includes("://") ? address : `https://${address}`);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function needsPrivateDeviceInput(
  snapshot: SemanticSnapshot,
  { blockPopulatedFields = true, allowBrowserLocationDisplay = false } = {},
): boolean {
  return snapshot.nodes.some((node) => {
    if (node.visibleToUser === false) return false;
    const role = node.type ?? node.role ?? "";
    if (node.password || /password|securetextfield/i.test(role)) return true;
    if (
      /\b(password|passcode|verification code|one.time (code|password)|select an account|choose an account|security code|card number|cvv|cvc|private key|recovery phrase)\b/i.test(
        node.label ?? "",
      )
    )
      return true;
    const location = allowBrowserLocationDisplay ? browserLocationMode(snapshot, node) : undefined;
    if (location === "editing") return true;
    return Boolean(
      blockPopulatedFields &&
      (node.editable || /edittext|textfield|textinput/i.test(role)) &&
      node.value?.trim() &&
      (location !== "display" || !isPlainWebAddress(node.value)),
    );
  });
}

export function observeDevice(
  snapshot: SemanticSnapshot,
  allowSourceTap = false,
): DeviceObservation {
  const screenKey = comparisonScreenKey(snapshot);
  const roots =
    allowSourceTap && screenKey
      ? snapshot.nodes.filter(
          (node) => node.parentIndex === undefined && node.type === "Application",
        )
      : [];
  const root = roots.length === 1 ? roots[0]?.rect : undefined;
  const sourceBounds =
    root?.x === 0 &&
    root.y === 0 &&
    Number.isFinite(root.width) &&
    Number.isFinite(root.height) &&
    root.width > 0 &&
    root.height > 0
      ? root
      : undefined;
  const byIndex = new Map(snapshot.nodes.map((node) => [node.index, node]));
  const identifiers = new Map<number, string>();
  const identifierCounts = new Map<string, number>();
  if (snapshot.appBundleId && !snapshot.truncated && !snapshot.systemSurfaceOnly) {
    for (const node of snapshot.nodes) {
      if (node.visibleToUser === false) continue;
      const id = sharedIdentifier(node.identifier, snapshot.appBundleId);
      if (id === undefined) continue;
      identifiers.set(node.index, id);
      identifierCounts.set(id, (identifierCounts.get(id) ?? 0) + 1);
    }
  }
  const aliases = new Set<number>();
  const controls = snapshot.nodes.flatMap((node) => {
    const name = label(node.label);
    const role = (node.type ?? node.role ?? "").split(".").at(-1)?.toLowerCase() ?? "";
    if (
      !name ||
      node.visibleToUser === false ||
      node.editable ||
      node.password ||
      /edittext|textfield|textinput|password|textvieweditable/.test(role)
    )
      return [];
    const parent = node.parentIndex === undefined ? undefined : byIndex.get(node.parentIndex);
    const parentLabel = label(parent?.label);
    // Mobile browsers repeat a web label through nested accessibility containers.
    // A sibling label can describe a separate element, even when the text matches.
    if (
      parent &&
      parent.index < node.index &&
      (parent.type === "Other" ||
        parent.type === "WebView" ||
        parent.type === "android.webkit.WebView") &&
      !parent.identifier &&
      !parent.editable &&
      !parent.password &&
      !actionRoles.has(parent.role?.toLowerCase() ?? "") &&
      parentLabel &&
      normalizeLabel(parentLabel) === normalizeLabel(name) &&
      (monetaryValue(parent.value) === undefined ||
        monetaryValue(parent.value) === monetaryValue(node.value))
    ) {
      aliases.add(parent.index);
    }
    const context =
      parentLabel && normalizeLabel(parentLabel) !== normalizeLabel(name) ? parentLabel : undefined;
    const ref = /^@?e\d+$/.test(node.ref) ? `@${node.ref.replace(/^@/, "")}` : "";
    const actionRole = actionRoles.has(role) ? role : node.role?.toLowerCase();
    const actionable = actionRole !== undefined && actionRoles.has(actionRole);
    const identifier = identifiers.get(node.index);
    // Type, sign-in and account selection stay with the user in the device's normal controls.
    const protectedAction =
      /\b(sign[ -]?in|log[ -]?in|password|passkey|apple account|google account|mfa|verification code)\b/i.test(
        name,
      );
    const rect = sourceBounds && node.rect;
    const onScreen =
      rect &&
      sourceBounds &&
      [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
      rect.x >= 0 &&
      rect.y >= 0 &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.x + rect.width <= sourceBounds.width &&
      rect.y + rect.height <= sourceBounds.height;
    return [
      {
        id: randomUUID(),
        label: name,
        role: actionable ? actionRole : "text",
        ...(context === undefined ? {} : { context }),
        canTap: Boolean(
          ref &&
          snapshot.refsGeneration !== undefined &&
          actionable &&
          node.enabled !== false &&
          node.hittable !== false &&
          !node.interactionBlocked &&
          !protectedAction,
        ),
        ref: `${ref}~s${snapshot.refsGeneration}`,
        ...(identifier === undefined ? {} : { identifier }),
        ...(onScreen ? { rect } : {}),
        parentIndex: node.parentIndex,
        amountValue: monetaryValue(node.value),
        index: node.index,
      },
    ];
  });
  const observed = controls.flatMap(({ index, ...control }) =>
    aliases.has(index) ? [] : [control],
  );
  return {
    controls: observed,
    identifierCounts,
    ...(screenKey ? { screenKey } : {}),
    ...(sourceBounds && observed.some((control) => control.canTap && control.rect)
      ? {
          sourceTap: {
            id: randomUUID(),
            width: sourceBounds.width,
            height: sourceBounds.height,
          },
        }
      : {}),
  };
}

export function sourceControlAtPoint(
  observed: DeviceObservation,
  tap: Pick<Extract<DeviceComparisonInput, { action: "sourceTap" }>, "x" | "y" | "viewport">,
): ObservedControl | undefined {
  const bounds = observed.sourceTap;
  if (!bounds) return;
  const { viewport } = tap;
  if (Math.abs(viewport.width / viewport.height / (bounds.width / bounds.height) - 1) > 0.01)
    return;
  const x = tap.x * bounds.width;
  const y = tap.y * bounds.height;
  const matching = observed.controls.filter(
    ({ canTap, rect }) =>
      canTap &&
      rect &&
      x >= rect.x &&
      y >= rect.y &&
      x < rect.x + rect.width &&
      y < rect.y + rect.height,
  );
  return matching.length === 1 ? matching[0] : undefined;
}

export const exposedControl = ({
  id,
  label,
  role,
  context,
  canTap,
}: ObservedControl): DeviceComparisonControl => ({
  id,
  label,
  role,
  ...(context === undefined ? {} : { context }),
  canTap,
});

export function matchControl(
  intended: Pick<ObservedControl, "label" | "role" | "context">,
  controls: ReadonlyArray<ObservedControl>,
): ObservedControl | undefined {
  const candidates = controls.filter(
    (node) => node.canTap && normalizeLabel(node.label) === normalizeLabel(intended.label),
  );
  if (candidates.length === 1) return candidates[0];
  const contextual = candidates.filter(
    (node) =>
      node.role === intended.role &&
      node.context !== undefined &&
      intended.context !== undefined &&
      normalizeLabel(node.context) === normalizeLabel(intended.context),
  );
  return contextual.length === 1 ? contextual[0] : undefined;
}

export function matchReplayControl(
  intended: ObservedControl,
  source: DeviceObservation,
  target: DeviceObservation,
): { control: ObservedControl } | { reason: string } {
  const byLabel = matchControl(intended, target.controls);
  const id = intended.identifier;
  if (!id || source.identifierCounts.get(id) !== 1 || !target.identifierCounts.has(id))
    return byLabel
      ? { control: byLabel }
      : {
          reason: `The destination has no unique tappable “${intended.label}”.`,
        };
  if (target.identifierCounts.get(id) !== 1)
    return {
      reason: `Multiple destination controls share the identifier for “${intended.label}”.`,
    };
  const byId = target.controls.find((control) => control.identifier === id);
  if (!byId?.canTap || byId.role !== intended.role)
    return {
      reason: `The destination control for “${intended.label}” is unavailable or has a different role.`,
    };
  if (byLabel && byLabel !== byId)
    return {
      reason: `The label and identifier for “${intended.label}” point to different destination controls.`,
    };
  if (
    normalizeLabel(byId.label) !== normalizeLabel(intended.label) &&
    (isConsequentialDeviceAction(intended.label) || isConsequentialDeviceAction(byId.label))
  )
    return {
      reason: `Review “${byId.label}” on the destination before continuing from “${intended.label}”.`,
    };
  return { control: byId };
}

const spaces = "\\s\\u00a0\\u202f";
// US (1,234.56), European (1.234,56), French/Swiss (1 234,56) and plain (12,50) amounts.
const amountPattern = `(?:[0-9]{1,3}(?:[.,${spaces}][0-9]{3})+(?:[.,][0-9]{2})?|[0-9]+(?:[.,][0-9]{2})?)`;
const currencySymbols = { USD: "\\$", EUR: "€", GBP: "£" } as const;

/** Parse one locale-formatted amount into minor units, or null when it is ambiguous. */
export function parseAmountMinor(text: string): number | null {
  const decimal = /[.,][0-9]{2}$/.exec(text)?.[0];
  const integer = decimal ? text.slice(0, -3) : text;
  if (!/^(?:[0-9]{1,3}(?:[.,\s\u00a0\u202f][0-9]{3})+|[0-9]+)$/.test(integer)) return null;
  const groups = new Set(integer.replace(/[0-9]/g, "").replace(/[\s\u00a0\u202f]/g, " "));
  // One group separator, and never the same character as the decimal separator.
  if (groups.size > 1 || (decimal && groups.has(decimal[0]!))) return null;
  const whole = Number(integer.replace(/[^0-9]/g, ""));
  const minor = whole * 100 + Number(decimal?.slice(1) ?? "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

/** True when a label looks like a currency amount (used to suggest configuring a total check). */
export const looksLikeCurrencyAmount = (text: string | undefined) =>
  text !== undefined &&
  new RegExp(
    `(?:[$€£]|\\b(?:USD|EUR|GBP)\\b)\\s*${amountPattern}|${amountPattern}\\s*(?:[$€£]|\\b(?:USD|EUR|GBP)\\b)`,
    "i",
  ).test(text);

export function observeTotal(
  frame: DeviceObservation,
  expectedLabel: string,
  currency: DeviceComparisonTotal["currency"],
): { minor: number; display: string } | null | undefined {
  const expected = normalizeLabel(expectedLabel);
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = `(?:${currencySymbols[currency]}|${currency})`;
  const money = new RegExp(
    `^(?:${marker}\\s*(${amountPattern})|(${amountPattern})\\s*${marker})$`,
    "i",
  );
  const labelPrefix = escape(expectedLabel.trim().replace(/\s+/g, " "));
  const inline = new RegExp(
    `^${labelPrefix}(?:\\s*:\\s*(.+)|\\s+((?:[$€£]|USD\\b|EUR\\b|GBP\\b|[0-9]).*))$`,
    "i",
  );
  const controls = frame.controls;
  let observedMinor: number | undefined;
  for (const node of controls) {
    const text = normalizeLabel(node.label);
    const matches = inline.exec(node.label);
    const embedded = matches?.[1] ?? matches?.[2];
    if (!embedded && text.replace(/:$/, "").trim() !== expected) continue;
    let amount = embedded ?? node.amountValue;
    if (amount === undefined && node.parentIndex !== undefined) {
      const siblings = controls.filter(
        (sibling) => sibling.parentIndex === node.parentIndex && money.test(sibling.label),
      );
      if (siblings.length === 1) amount = siblings[0]?.label;
    }
    const match = amount === undefined ? null : money.exec(amount.trim());
    if (!match) return null;
    const minor = parseAmountMinor(match[1] ?? match[2]!);
    // WebViews can expose the same visible total more than once. Every match must agree.
    if (minor === null || (observedMinor !== undefined && observedMinor !== minor)) {
      return null;
    }
    observedMinor = minor;
  }
  return observedMinor === undefined
    ? undefined
    : {
        minor: observedMinor,
        display: `${currency} ${(observedMinor / 100).toFixed(2)}`,
      };
}

export function screenshotPng(bytes: Uint8Array): string | undefined {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const screenshot = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = screenshot.indexOf(signature);
  if (start < 0 || screenshot.length - start > 4 * 1024 * 1024) return undefined;
  return screenshot.subarray(start).toString("base64");
}

export function cropComparisonScreenshot(
  bytes: Uint8Array,
  { left, top, right, bottom }: { left: number; top: number; right: number; bottom: number },
) {
  const encoded = screenshotPng(bytes);
  if (!encoded) return undefined;
  const png = Buffer.from(encoded, "base64");
  const size = readImageDimensions(png);
  if (
    !size ||
    size.width * size.height > 16_000_000 ||
    left < 0 ||
    top < 0 ||
    right > size.width ||
    bottom > size.height ||
    left >= right ||
    top >= bottom
  )
    return undefined;
  try {
    const screen = PNG.sync.read(png);
    const crop = new PNG({ width: right - left, height: bottom - top });
    PNG.bitblt(screen, crop, left, top, crop.width, crop.height, 0, 0);
    return screenshotPng(PNG.sync.write(crop));
  } catch {
    return undefined;
  }
}

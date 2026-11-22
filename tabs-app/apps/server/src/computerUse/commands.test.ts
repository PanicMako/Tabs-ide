import { describe, expect, it } from "vitest";
import {
  buildClickRequest,
  buildKeyRequest,
  buildScrollRequest,
  buildSnapshotRequest,
  buildTypeRequest,
  parseAppSelector,
  parseTarget,
  pngDimensions,
} from "./commands.ts";
import { blockedKeyEffect, parseKeySpec, resolveKeySpec } from "./keySpec.ts";
import { isSensitiveField, SENSITIVE_LABEL_SOURCE } from "./sensitive.ts";
import { parseRuntimeResponse } from "./runtimeResponse.ts";
import { JXA_RUNTIME } from "./jxaScript.ts";

const messageOf = (result: { ok: boolean; message?: string }) =>
  result.ok ? "" : (result.message ?? "");

describe("parseAppSelector", () => {
  it("accepts names, bundle ids and pid selectors", () => {
    expect(parseAppSelector(" com.apple.Notes ")).toEqual({
      ok: true,
      value: { kind: "name", query: "com.apple.Notes" },
    });
    expect(parseAppSelector("PID:42")).toEqual({ ok: true, value: { kind: "pid", pid: 42 } });
  });
  it("rejects empty and zero pid", () => {
    expect(parseAppSelector("  ").ok).toBe(false);
    expect(parseAppSelector("pid:0").ok).toBe(false);
  });
});

describe("parseTarget", () => {
  it("takes exactly one of an element or a point", () => {
    expect(parseTarget({ elementIndex: 3 })).toEqual({
      ok: true,
      value: { kind: "element", index: 3 },
    });
    expect(parseTarget({ x: 4, y: 5 })).toEqual({ ok: true, value: { kind: "point", x: 4, y: 5 } });
    expect(parseTarget({ elementIndex: 3, x: 1, y: 1 }).ok).toBe(false);
    expect(parseTarget({}).ok).toBe(false);
    expect(parseTarget({ x: 1 }).ok).toBe(false);
    expect(parseTarget({ x: -1, y: 1 }).ok).toBe(false);
    expect(parseTarget({ elementIndex: 0 }).ok).toBe(false);
    expect(parseTarget({ elementIndex: 1.5 }).ok).toBe(false);
  });
});

describe("request builders", () => {
  it("validates snapshot limits", () => {
    expect(buildSnapshotRequest({ app: "Notes" }).ok).toBe(true);
    expect(buildSnapshotRequest({ app: "Notes", maxNodes: 5 }).ok).toBe(false);
    expect(buildSnapshotRequest({ app: "Notes", maxNodes: 99_999 }).ok).toBe(false);
    expect(buildSnapshotRequest({ app: "Notes", rootElementIndex: 0 }).ok).toBe(false);
  });

  it("builds click requests with a click count", () => {
    const single = buildClickRequest({ app: "Notes", elementIndex: 2 });
    const double = buildClickRequest({ app: "Notes", x: 1, y: 2, doubleClick: true });
    expect(single.ok && single.value.op === "click" && single.value.clickCount).toBe(1);
    expect(double.ok && double.value.op === "click" && double.value.clickCount).toBe(2);
  });

  it("rejects empty and oversized text", () => {
    expect(buildTypeRequest({ app: "Notes", text: "" }).ok).toBe(false);
    expect(buildTypeRequest({ app: "Notes", text: "x".repeat(10_001) }).ok).toBe(false);
    expect(buildTypeRequest({ app: "Notes", text: "hi", elementIndex: 4 }).ok).toBe(true);
  });

  it("maps scroll directions to wheel deltas", () => {
    const down = buildScrollRequest({ app: "Notes", direction: "down", amount: 3, x: 1, y: 1 });
    expect(down.ok && down.value.op === "scroll" && [down.value.dx, down.value.dy]).toEqual([
      0, -3,
    ]);
    const right = buildScrollRequest({ app: "Notes", direction: "right", elementIndex: 1 });
    expect(right.ok && right.value.op === "scroll" && [right.value.dx, right.value.dy]).toEqual([
      -5, 0,
    ]);
    expect(buildScrollRequest({ app: "Notes", direction: "sideways", x: 1, y: 1 }).ok).toBe(false);
    expect(buildScrollRequest({ app: "Notes", direction: "up", amount: 500, x: 1, y: 1 }).ok).toBe(
      false,
    );
  });
});

describe("key specs", () => {
  it("parses keys and chords into key codes and modifiers", () => {
    const enter = parseKeySpec("Enter");
    expect(enter.ok && enter.key).toMatchObject({ keyCode: 36, modifiers: [], insertsText: false });
    const chord = parseKeySpec("CmdOrCtrl+Shift+P");
    expect(chord.ok && chord.key).toMatchObject({
      keyCode: 35,
      modifiers: ["command", "shift"],
      insertsText: false,
    });
    const plus = parseKeySpec("+");
    expect(plus.ok && plus.key).toMatchObject({ keyCode: 24, modifiers: ["shift"] });
    const shiftPlus = parseKeySpec("Cmd++");
    expect(shiftPlus.ok && shiftPlus.key.modifiers).toEqual(["command", "shift"]);
  });

  it("flags text-producing keys and paste", () => {
    const letter = parseKeySpec("a");
    expect(letter.ok && letter.key.insertsText).toBe(true);
    const space = parseKeySpec("Space");
    expect(space.ok && space.key.insertsText).toBe(true);
    const paste = parseKeySpec("Cmd+V");
    expect(paste.ok && paste.key.insertsText).toBe(true);
    const selectAll = parseKeySpec("Cmd+A");
    expect(selectAll.ok && selectAll.key.insertsText).toBe(false);
    const tab = parseKeySpec("Tab");
    expect(tab.ok && tab.key.insertsText).toBe(false);
  });

  it("rejects unknown keys and modifiers", () => {
    expect(parseKeySpec("Hyper+A").ok).toBe(false);
    expect(parseKeySpec("Cmd+Banana").ok).toBe(false);
    expect(parseKeySpec("Cmd+").ok).toBe(false);
    expect(messageOf(resolveKeySpec("  "))).toContain("one key");
  });

  it("blocks quit, log out, lock, force quit and empty trash", () => {
    for (const [spec, effect] of [
      ["Cmd+Q", "quit the app"],
      ["Cmd+Shift+Q", "log out"],
      ["Cmd+Ctrl+Q", "lock the screen"],
      ["Cmd+Option+Esc", "Force Quit"],
      ["Cmd+Shift+Delete", "Trash"],
      ["Cmd+Alt+Shift+Q", "log out"],
    ] as const) {
      const parsed = parseKeySpec(spec);
      expect(parsed.ok && blockedKeyEffect(parsed.key)).toContain(effect);
      expect(messageOf(resolveKeySpec(spec))).toContain("Refusing");
    }
    expect(resolveKeySpec("Cmd+W").ok).toBe(true);
    expect(resolveKeySpec("q").ok).toBe(true);
    expect(buildKeyRequest({ app: "Notes", key: "Cmd+Q" }).ok).toBe(false);
  });
});

describe("sensitive fields", () => {
  it("treats secure subroles as sensitive", () => {
    expect(isSensitiveField({ role: "AXTextField", subrole: "AXSecureTextField" })).toBe(true);
  });
  it("flags secret-looking labels on editable fields only", () => {
    expect(isSensitiveField({ role: "AXTextField", labels: ["Password"] })).toBe(true);
    expect(isSensitiveField({ role: "AXTextField", labels: ["Enter your 2FA code"] })).toBe(true);
    expect(isSensitiveField({ role: "AXTextArea", labels: ["Card number"] })).toBe(true);
    expect(isSensitiveField({ role: "AXButton", labels: ["Forgot password?"] })).toBe(false);
    expect(isSensitiveField({ role: "AXTextField", labels: ["Search", undefined] })).toBe(false);
    expect(isSensitiveField({ role: "AXTextField", labels: ["Pinned notes"] })).toBe(false);
  });
  it("embeds the same label pattern in the macOS runtime", () => {
    expect(JXA_RUNTIME).toContain(JSON.stringify(SENSITIVE_LABEL_SOURCE));
    expect(JXA_RUNTIME).not.toContain("`");
  });
});

describe("parseRuntimeResponse", () => {
  it("reads the last JSON line", () => {
    const parsed = parseRuntimeResponse('warning\n{"ok":true,"apps":[]}\n');
    expect(parsed.ok).toBe(true);
  });
  it("passes runtime failures through", () => {
    const parsed = parseRuntimeResponse('{"ok":false,"code":"app_not_found","message":"x"}');
    expect(parsed).toEqual({ ok: false, code: "app_not_found", message: "x" });
  });
  it("turns garbage into an accessibility error with stderr detail", () => {
    const parsed = parseRuntimeResponse("", "execution error: boom\n");
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.message).toContain("boom");
    const empty = parseRuntimeResponse("");
    expect(!empty.ok && empty.message).toContain("no result");
  });
});

describe("pngDimensions", () => {
  it("reads IHDR width and height", () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47]);
    new DataView(bytes.buffer).setUint32(16, 800);
    new DataView(bytes.buffer).setUint32(20, 600);
    expect(pngDimensions(bytes)).toEqual({ width: 800, height: 600 });
    expect(pngDimensions(new Uint8Array(30))).toBeNull();
  });
});

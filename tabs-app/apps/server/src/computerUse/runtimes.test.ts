import { describe, expect, it } from "vitest";
import {
  buildClickRequest,
  buildDragRequest,
  buildKeyRequest,
  buildSecondaryActionRequest,
  buildSetValueRequest,
  type ComputerRequest,
} from "./commands.ts";
import { JXA_RUNTIME } from "./jxaScript.ts";
import { blockedKeyEffect, parseKeySpec, resolveKeySpec } from "./keySpec.ts";
import { LINUX_RUNTIME } from "./linuxRuntime.ts";
import {
  buildRuntimeInvocation,
  REQUEST_ENV,
  runtimePlatformSupported,
} from "./runtimeInvocation.ts";
import { parseRuntimeResponse } from "./runtimeResponse.ts";
import { BLOCKED_APP_FRAGMENTS, isBlockedApp, SENSITIVE_LABEL_SOURCE } from "./sensitive.ts";
import {
  evaluateWaitCondition,
  filterTreeByQuery,
  hasWaitCondition,
  treeUnchanged,
} from "./treeQuery.ts";
import { describeVerification } from "./verification.ts";
import { WINDOWS_RUNTIME } from "./windowsRuntime.ts";
import { hideComputerTools } from "../mcp/toolkits/computer/visibility.ts";

const TREE = [
  "App: Notes (com.apple.Notes, pid 1)",
  'Window: "Draft" at (0, 0) size 800x600 points; click coordinates are window-local.',
  "",
  '1 Window "Notes"',
  "\t2 Toolbar",
  '\t\t3 Button "New note"',
  '\t\t4 Button "Share" (disabled)',
  '\t5 TextArea value="hello"',
  '\t6 StaticText "Saved"',
  "",
  "6 elements.",
].join("\n");

describe("filterTreeByQuery", () => {
  it("keeps matches with their ancestors and original indexes", () => {
    const filtered = filterTreeByQuery(TREE, "new note");
    expect(filtered?.matches).toBe(1);
    expect(filtered?.text).toContain('\t\t3 Button "New note"');
    expect(filtered?.text).toContain("\t2 Toolbar");
    expect(filtered?.text).toContain('1 Window "Notes"');
    expect(filtered?.text).not.toContain("TextArea");
  });

  it("caps matches and reports the rest", () => {
    const filtered = filterTreeByQuery(TREE, "button", 1);
    expect(filtered?.text).toContain("1 more not shown");
  });

  it("returns null for empty queries and misses", () => {
    expect(filterTreeByQuery(TREE, "  ")).toBeNull();
    expect(filterTreeByQuery(TREE, "zebra")).toBeNull();
  });
});

describe("evaluateWaitCondition", () => {
  it("matches text case-insensitively", () => {
    expect(evaluateWaitCondition(TREE, { text: "SAVED" })?.matches).toHaveLength(1);
    expect(evaluateWaitCondition(TREE, { text: "Uploading" })).toBeNull();
  });

  it("requires every enabled match to be enabled", () => {
    expect(evaluateWaitCondition(TREE, { enabled: "new note" })).not.toBeNull();
    expect(evaluateWaitCondition(TREE, { enabled: "share" })).toBeNull();
  });

  it("checks the window title and combines conditions", () => {
    expect(evaluateWaitCondition(TREE, { windowTitle: "draft" })).not.toBeNull();
    expect(evaluateWaitCondition(TREE, { windowTitle: "other" })).toBeNull();
    expect(evaluateWaitCondition(TREE, { windowTitle: "draft", text: "nothing" })).toBeNull();
  });

  it("knows when no condition was given", () => {
    expect(hasWaitCondition({})).toBe(false);
    expect(hasWaitCondition({ text: " " })).toBe(false);
    expect(hasWaitCondition({ text: "x" })).toBe(true);
  });
});

describe("verification", () => {
  const press = { path: "accessibility", detail: "pressed" } as const;
  it("trusts a runtime read-back", () => {
    expect(
      describeVerification(
        { ...press, verification: { state: "verified", detail: "reads back" } },
        false,
      ),
    ).toBe("verified: reads back");
  });
  it("flags an accessibility call that changed nothing as a suspected no-op", () => {
    expect(describeVerification(press, true)).toContain("suspected no-op");
    expect(describeVerification({ path: "synthetic", detail: "x" }, true)).toContain(
      "no visible change",
    );
  });
  it("never calls an unasserted action verified", () => {
    expect(describeVerification(press, false)).toMatch(/^unverified/);
    expect(describeVerification({ path: "synthetic", detail: "x" }, false)).toMatch(/^unverified/);
  });
  it("detects unchanged diffs", () => {
    expect(treeUnchanged("No change in the accessibility tree since the previous snapshot.")).toBe(
      true,
    );
    expect(treeUnchanged(TREE)).toBe(false);
  });
});

describe("new request builders", () => {
  it("builds right clicks, drags, set-value and secondary actions", () => {
    const right = buildClickRequest({ app: "Notes", elementIndex: 2, button: "right" });
    expect(right.ok && right.value.op === "click" && right.value.button).toBe("right");
    const drag = buildDragRequest({ app: "Notes", fromElementIndex: 1, toX: 5, toY: 6 });
    expect(drag.ok && drag.value.op === "drag" && drag.value.to).toEqual({
      kind: "point",
      x: 5,
      y: 6,
    });
    expect(buildDragRequest({ app: "Notes", fromElementIndex: 1 }).ok).toBe(false);
    expect(buildSetValueRequest({ app: "Notes", elementIndex: 4, value: "x" }).ok).toBe(true);
    expect(buildSetValueRequest({ app: "Notes", elementIndex: 0, value: "x" }).ok).toBe(false);
    expect(
      buildSetValueRequest({ app: "Notes", elementIndex: 1, value: "x".repeat(10_001) }).ok,
    ).toBe(false);
    expect(
      buildSecondaryActionRequest({ app: "Notes", elementIndex: 1, action: "AXShowMenu" }).ok,
    ).toBe(true);
    expect(buildSecondaryActionRequest({ app: "Notes", elementIndex: 1, action: "x; rm" }).ok).toBe(
      false,
    );
  });

  it("defaults to background delivery", () => {
    const click = buildClickRequest({ app: "Notes", elementIndex: 2 });
    expect(click.ok && click.value.op === "click" && click.value.foreground).toBe(false);
    const key = buildKeyRequest({ app: "Notes", key: "Return", foreground: true });
    expect(key.ok && key.value.op === "key" && key.value.foreground).toBe(true);
  });
});

describe("platform key rules", () => {
  it("maps cmdorctrl per platform", () => {
    const mac = parseKeySpec("CmdOrCtrl+A", "darwin");
    const win = parseKeySpec("CmdOrCtrl+A", "win32");
    expect(mac.ok && mac.key.modifiers).toEqual(["command"]);
    expect(win.ok && win.key.modifiers).toEqual(["control"]);
  });

  it("blocks the right shortcuts on Windows and Linux", () => {
    for (const [spec, platform, effect] of [
      ["Alt+F4", "win32", "close the app"],
      ["Win+L", "win32", "lock Windows"],
      ["Ctrl+Shift+Esc", "win32", "Task Manager"],
      ["Ctrl+Alt+Delete", "linux", "log out"],
      ["Ctrl+Alt+F3", "linux", "virtual terminal"],
      ["Ctrl+Q", "linux", "quit the app"],
      ["Super+L", "linux", "lock the screen"],
    ] as const) {
      const parsed = parseKeySpec(spec, platform);
      expect(parsed.ok && blockedKeyEffect(parsed.key, platform)).toContain(effect);
      expect(resolveKeySpec(spec, platform).ok).toBe(false);
    }
    expect(resolveKeySpec("Ctrl+Q", "win32").ok).toBe(true);
    expect(resolveKeySpec("Cmd+W", "darwin").ok).toBe(true);
  });

  it("treats Ctrl+V as paste off macOS", () => {
    const paste = parseKeySpec("Ctrl+V", "linux");
    expect(paste.ok && paste.key.insertsText).toBe(true);
    const mac = parseKeySpec("Ctrl+V", "darwin");
    expect(mac.ok && mac.key.insertsText).toBe(false);
  });
});

describe("runtime invocation", () => {
  const request: ComputerRequest = { op: "listApps" };

  it("selects a script runtime per platform", () => {
    const mac = buildRuntimeInvocation("darwin", request);
    expect(mac.command).toBe("osascript");
    expect(mac.args.at(-1)).toBe(JSON.stringify(request));
    expect(mac.stdin).toBe(JXA_RUNTIME);

    const win = buildRuntimeInvocation("win32", request);
    expect(win.command).toBe("powershell.exe");
    expect(win.args).toContain("-NoProfile");
    expect(win.stdin).toBe(WINDOWS_RUNTIME);
    expect(win.env[REQUEST_ENV]).toBe(JSON.stringify(request));
    expect(win.args.join(" ")).not.toContain("listApps");

    const linux = buildRuntimeInvocation("linux", request);
    expect(linux.command).toBe("python3");
    expect(linux.stdin).toBe(LINUX_RUNTIME);
    expect(linux.env[REQUEST_ENV]).toBe(JSON.stringify(request));
  });

  it("supports the three desktop platforms only", () => {
    expect(
      ["darwin", "win32", "linux"].every((p) => runtimePlatformSupported(p as NodeJS.Platform)),
    ).toBe(true);
    expect(runtimePlatformSupported("freebsd")).toBe(false);
  });

  it("embeds the shared safety lists in every runtime", () => {
    for (const script of [JXA_RUNTIME, WINDOWS_RUNTIME, LINUX_RUNTIME]) {
      expect(script).toContain(JSON.stringify(SENSITIVE_LABEL_SOURCE));
      expect(script).toContain(JSON.stringify(BLOCKED_APP_FRAGMENTS));
      expect(script).not.toContain("`");
      expect(script).not.toMatch(/\$\{/);
    }
  });

  it("refuses secret fields inside every runtime", () => {
    expect(JXA_RUNTIME).toContain("sensitive_field");
    expect(WINDOWS_RUNTIME).toContain("IsPassword");
    expect(LINUX_RUNTIME).toContain("PASSWORD_TEXT");
    for (const script of [JXA_RUNTIME, WINDOWS_RUNTIME, LINUX_RUNTIME]) {
      expect(script).toContain("sensitive_field");
      expect(script).toContain("app_blocked");
    }
  });
});

describe("response parsing across runtimes", () => {
  it("reads PowerShell and Python one-line JSON", () => {
    const ok = parseRuntimeResponse(
      '{"ok":true,"permissions":{"accessibility":true,"screenRecording":"granted"}}\r\n',
    );
    expect(ok.ok).toBe(true);
    const failure = parseRuntimeResponse('{"ok":false,"code":"app_blocked","message":"x"}\n');
    expect(failure).toMatchObject({ ok: false, code: "app_blocked" });
  });
});

describe("blocked apps", () => {
  it("matches password managers by name or bundle id", () => {
    expect(isBlockedApp("1Password")).toBe(true);
    expect(isBlockedApp("Safari", "com.bitwarden.desktop")).toBe(true);
    expect(isBlockedApp("Notes", "com.apple.Notes")).toBe(false);
  });
});

describe("hideComputerTools", () => {
  const list = (names: string[]) =>
    JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: names.map((name) => ({ name })) } });

  it("removes computer_* tools from a JSON tools/list body", () => {
    const body = hideComputerTools(
      list(["t3_theme_read", "computer_click", "computer_snapshot"]),
      "application/json",
    );
    expect(JSON.parse(body).result.tools).toEqual([{ name: "t3_theme_read" }]);
  });

  it("handles event-stream bodies and leaves other payloads alone", () => {
    const sse = `event: message\ndata: ${list(["computer_key", "preview_act"])}\n\n`;
    const out = hideComputerTools(sse, "text/event-stream");
    expect(out).toContain("preview_act");
    expect(out).not.toContain("computer_key");
    expect(hideComputerTools("not json", "application/json")).toBe("not json");
    expect(hideComputerTools('{"result":{}}', "application/json")).toBe('{"result":{}}');
  });
});

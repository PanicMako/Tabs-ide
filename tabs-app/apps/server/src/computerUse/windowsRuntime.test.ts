import { spawnSync } from "node:child_process";
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  ensureWindowsRuntime,
  WINDOWS_RUNTIME_SHA256,
  windowsRuntimeSourcePath,
} from "./windowsRuntime.ts";

const source = new URL("./windowsRuntime.ps1", import.meta.url);
const configuredPowerShell = process.env.TABS_QA_POWERSHELL;
const powershell =
  configuredPowerShell ?? (process.platform === "win32" ? "powershell.exe" : "pwsh");
const powershellProbeError =
  configuredPowerShell || process.platform === "win32"
    ? undefined
    : spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], {
        timeout: 5000,
      }).error;
const powershellMissing =
  powershellProbeError !== undefined &&
  "code" in powershellProbeError &&
  powershellProbeError.code === "ENOENT";

describe("on-demand Windows computer-use runtime", () => {
  it("resolves the checkout source from both TypeScript and the built desktop development server", () => {
    const bundled = new URL("../../dist/chunks/main.mjs", import.meta.url);
    expect(windowsRuntimeSourcePath(bundled.href)).toBe(fileURLToPath(source));
    expect(windowsRuntimeSourcePath(import.meta.url)).toBe(fileURLToPath(source));
  });

  it("downloads the pinned release asset once and reuses the verified cache", async () => {
    const directory = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tabs-cu-runtime-"));
    const bytes = await NodeFS.readFile(source);
    const fetcher = vi.fn((input: string) => {
      expect(input).toContain("/vtest/tabs-computer-use-windows.ps1");
      return Promise.resolve(new Response(bytes));
    });
    try {
      const options = { directory, version: "test", sourcePath: null, fetcher };
      const first = await ensureWindowsRuntime(options);
      const second = await ensureWindowsRuntime(options);

      expect(first).toBe(second);
      expect(await NodeFS.readFile(first)).toEqual(bytes);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await NodeFS.rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a release asset whose bytes do not match the pinned hash", async () => {
    const directory = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tabs-cu-runtime-"));
    const bytes = Buffer.concat([await NodeFS.readFile(source), Buffer.from("tampered")]);
    try {
      await expect(
        ensureWindowsRuntime({
          directory,
          version: "tampered",
          sourcePath: null,
          fetcher: async () => new Response(bytes),
        }),
      ).rejects.toThrow("failed its integrity check");
      await expect(
        NodeFS.access(NodePath.join(directory, "vtampered", "windows.ps1")),
      ).rejects.toThrow();
      expect(WINDOWS_RUNTIME_SHA256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await NodeFS.rm(directory, { recursive: true, force: true });
    }
  });
});

it.skipIf(powershellMissing)(
  "validates layout, integrity, pointer input and screenshot protection for the selected Windows target",
  async () => {
    const directory = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tabs-cu-snapshot-"));
    try {
      const fixture = NodePath.join(directory, "layout.ps1");
      await NodeFS.writeFile(
        fixture,
        String.raw`
param([string]$runtime)
$ErrorActionPreference = 'Stop'
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($runtime, [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
$names = @('Fail', 'RejectBlocked', 'CheckControl', 'SameFrame', 'ReadWindowLayout', 'CheckLayout',
           'ResolveExact', 'RunRequest', 'Snapshot', 'Done', 'DoScroll', 'DoDrag',
           'CheckScreenshotProtection', 'CheckScreenshotScope', 'DoScreenshot')
foreach ($fn in $ast.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $names
  }, $false)) {
  $definition = $fn.Extent.Text -replace 'System\.Windows\.Automation\.', 'CuFixture.Automation.' -replace 'System\.Drawing\.', 'CuFixture.Drawing.'
  . ([scriptblock]::Create($definition))
}
Add-Type -TypeDefinition @'
using System;
public static class CuNative {
  public static int Display;
  public static uint Dpi;
  public static int Moves;
  public static int Prints, Saves;
  public static int TargetIntegrity = 0x2000;
  public static int CallerIntegrity = 0x2000;
  public static readonly System.Collections.Generic.List<uint> Events = new System.Collections.Generic.List<uint>();
  public static bool InteractiveDesktop() { return true; }
  public static uint GetWindowThreadProcessId(IntPtr handle, out int owner) { owner = 42; return 1; }
  public static int Integrity(int pid) { return pid == 42 ? TargetIntegrity : CallerIntegrity; }
  public static bool EligibleWindow(IntPtr handle) { return true; }
  public static IntPtr MonitorFromWindow(IntPtr handle, uint flags) { return new IntPtr(Display); }
  public static uint GetDpiForWindow(IntPtr handle) { return Dpi; }
  public static bool SetCursorPos(int x, int y) { Moves++; return true; }
  public static bool PointerAt(int x, int y) { return true; }
  public static void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra) { Events.Add(flags); }
  public static bool ProtectedCapture(IntPtr handle) { return false; }
  public static bool PrintWindow(IntPtr handle, IntPtr dc, uint flags) {
    if (handle.ToInt64() != 73 || flags != 2) throw new InvalidOperationException("Wrong capture target");
    Prints++;
    return true;
  }
}
namespace CuFixture.Automation {
  public class ControlType {
    public string ProgrammaticName;
  }
  public class AutomationElement {
    public const string IsPasswordProperty = "password", ControlTypeProperty = "type";
    public static readonly object NotSupported = new object();
    public object Password = NotSupported, Type;
    public AutomationElement Child, Sibling;
    public string Name = "", AutomationId = "", HelpText = "";
    public int ProcessId = 42;
    public bool Unreadable;
    public AutomationElement Current { get { return this; } }
    public AutomationElement(string type) { Type = new ControlType { ProgrammaticName = "ControlType." + type }; }
    public object GetCurrentPropertyValue(string property, bool ignoreDefault) {
      var value = property == IsPasswordProperty ? Password : Type;
      return !ignoreDefault && value == NotSupported && property == IsPasswordProperty ? false : value;
    }
  }
  public class TreeWalker {
    public static readonly TreeWalker RawViewWalker = new TreeWalker();
    public AutomationElement GetFirstChild(AutomationElement element) { return element.Child; }
    public AutomationElement GetNextSibling(AutomationElement element) {
      if (element.Unreadable) throw new InvalidOperationException("UIA could not read the next sibling");
      return element.Sibling;
    }
  }
}
namespace CuFixture.Drawing {
  public class Bitmap : IDisposable {
    public Bitmap(int width, int height) {}
    public void Save(string path, object format) { CuNative.Saves++; }
    public void Dispose() {}
  }
  public class Graphics : IDisposable {
    public static Graphics FromImage(Bitmap bitmap) { return new Graphics(); }
    public IntPtr GetHdc() { return new IntPtr(1); }
    public void ReleaseHdc(IntPtr handle) {}
    public void Dispose() {}
  }
}
namespace CuFixture.Drawing.Imaging {
  public static class ImageFormat { public static readonly object Png = new object(); }
}
'@
$script:NativeHandle = [IntPtr]73
$script:NativeRequest = @{ app = @{ id = '42:1:73:fixture' }; native = @{} }
$proc = @{ Id = 42; ProcessName = 'Fixture' }
$BlockedApps = @()
$Editable = @('Edit', 'Document', 'ComboBox')
$MaxDepth = 40
$SensitivePattern = 'password'
$script:DpiContext = [IntPtr]1
$script:captureRoot = $null
function Get-Process($Id, $ErrorAction) { if ($Id -eq 42) { return $script:proc } }
function RootOf($proc) {
  $script:rootRead = $true
  if ($null -ne $script:captureRoot) {
    if ($script:failAfterPrint -eq ([CuNative]::Prints -gt 0)) { return $script:failedRoot }
    return $script:captureRoot
  }
  return @{ Current = @{ ProcessId = 42; Name = 'Fixture' } }
}
function TargetId($proc, $handle, $root) { return '42:1:73:fixture' }
function Rect($root) { return @{ x = 10; y = 20; width = 200; height = 120 } }
function Walk($root, $maxNodes) { return @{ nodes = @(@{ depth = 0; focused = $false }); truncated = $false } }
function Render($node, $index, $depth) { return '1 Button' }
function Clip($text, $limit) { return $text }
function AppInfo($proc) { return @{ name = $proc.ProcessName; pid = $proc.Id } }
function NodeToken($node) {
  if ($script:change -eq 'display') { [CuNative]::Display = 32 }
  if ($script:change -eq 'scale') { [CuNative]::Dpi = 96 }
  return 'button'
}
function Attempt($change, $afterAction) {
  [CuNative]::Display = 31
  [CuNative]::Dpi = 144
  $script:change = $change
  $script:NativeRequest.native = @{}
  if ($afterAction) { $script:NativeRequest.native = @{ display = '30'; scale = 1 } }
  try {
    $observed = Snapshot $proc 20 $null $afterAction
    return @{ display = $observed.display; scale = $observed.scale; elements = $observed.elements }
  } catch {
    if ($_.Exception.Message -notlike 'CU|*') { throw }
    return ($_.Exception.Message.Split('|')[1])
  }
}
function PointFor($proc, $target, $maxNodes) { return $target }
function CheckForeground($proc, $point) {}
function CheckClickHit($proc, $point) {
  if ($point.x -eq $script:coveredPoint -and [CuNative]::Moves -ge $script:coverAfterMoves) {
    Fail 'target_occluded' 'Another control covers the target.'
  }
}
function Gesture($op, $coveredPoint, $coverAfterMoves) {
  [CuNative]::Moves = 0
  [CuNative]::Events.Clear()
  $script:coveredPoint = $coveredPoint
  $script:coverAfterMoves = $coverAfterMoves
  $from = @{ x = 20; y = 30; kind = 'point' }
  $to = @{ x = 100; y = 30; kind = 'point' }
  $code = 'ok'
  try {
    if ($op -eq 'scroll') { $null = DoScroll $proc @{ target = $to; dx = 0; dy = 1; foreground = $true } }
    else { $null = DoDrag $proc @{ from = $from; to = $to; foreground = $true } }
  } catch {
    if ($_.Exception.Message -notlike 'CU|*') { throw }
    $code = $_.Exception.Message.Split('|')[1]
  }
  return @{ code = $code; moves = [CuNative]::Moves; events = @([CuNative]::Events.ToArray()) }
}
function DoClick($proc, $req) { $script:operationReached = $true }
function Dispatch($op, $targetIntegrity, $callerIntegrity) {
  function DoScreenshot($proc, $req) { $script:operationReached = $true }
  [CuNative]::TargetIntegrity = $targetIntegrity
  [CuNative]::CallerIntegrity = $callerIntegrity
  $script:rootRead = $false
  $script:operationReached = $false
  $code = 'ok'
  try {
    $null = RunRequest @{ op = $op; app = @{ kind = 'window'; id = '42:1:73:fixture' }; maxNodes = 20 }
  } catch {
    if ($_.Exception.Message -notlike 'CU|*') { throw }
    $code = $_.Exception.Message.Split('|')[1]
  }
  return @{ code = $code; rootRead = $script:rootRead; operationReached = $script:operationReached }
}
function Capture($failure, $afterPrint) {
  [CuNative]::TargetIntegrity = [CuNative]::CallerIntegrity = 0x2000
  [CuNative]::Prints = [CuNative]::Saves = 0
  $script:failAfterPrint = $afterPrint
  $script:captureRoot = [CuFixture.Automation.AutomationElement]::new('Window')
  $script:captureRoot.Child = [CuFixture.Automation.AutomationElement]::new('Button')
  $script:failedRoot = [CuFixture.Automation.AutomationElement]::new('Window')
  $child = [CuFixture.Automation.AutomationElement]::new('Edit')
  $child.Password = $false
  $script:failedRoot.Child = $child
  switch ($failure) {
    'root only' { $script:failedRoot.Child = $null }
    'unreadable sibling' { $child.Unreadable = $true }
    'unknown type' { $child.Type = [CuFixture.Automation.AutomationElement]::NotSupported }
    'unknown password state' { $child.Password = [CuFixture.Automation.AutomationElement]::NotSupported }
    'protected' { $child.HelpText = 'Enter password' }
    'too deep' {
      for ($i = 0; $i -lt $MaxDepth; $i++) {
        $child.Child = [CuFixture.Automation.AutomationElement]::new('Pane')
        $child = $child.Child
      }
    }
    'too many controls' {
      for ($i = 0; $i -lt 599; $i++) {
        $child.Sibling = [CuFixture.Automation.AutomationElement]::new('Pane')
        $child = $child.Sibling
      }
    }
  }
  $code = 'ok'
  try {
    $null = DoScreenshot $proc @{ path = 'fixture.png' }
  } catch {
    if ($_.Exception.Message -notlike 'CU|*') { throw }
    $code = $_.Exception.Message.Split('|')[1]
  } finally { $script:captureRoot = $null }
  return @{ failure = $failure; afterPrint = $afterPrint; code = $code; prints = [CuNative]::Prints; saves = [CuNative]::Saves }
}
ConvertTo-Json -Compress -Depth 5 -InputObject @{
  snapshots = @((Attempt 'stable' $false), (Attempt 'display' $false), (Attempt 'scale' $true), (Attempt 'stable' $true))
  gestures = @(
    (Gesture 'scroll' 0 0), (Gesture 'scroll' 100 0), (Gesture 'scroll' 100 1),
    (Gesture 'drag' 100 0), (Gesture 'drag' 20 1), (Gesture 'drag' 100 6), (Gesture 'drag' 0 0)
  )
  exactRequests = @(foreach ($op in 'snapshot', 'click', 'screenshot') {
    @{
      op = $op
      sameMediumIntegrity = Dispatch $op 0x2000 0x2000
      elevatedTarget = Dispatch $op 0x3000 0x2000
      elevatedCallerAndTarget = Dispatch $op 0x3000 0x3000
      targetAboveCaller = Dispatch $op 0x2000 0x1000
      unknownTargetIntegrity = Dispatch $op -1 0x2000
    }
  })
  captures = @(
    (Capture 'none' $false), (Capture 'root only' $false), (Capture 'root only' $true),
    (Capture 'unreadable sibling' $true), (Capture 'unknown type' $false),
    (Capture 'unknown password state' $false), (Capture 'protected' $true),
    (Capture 'too deep' $false), (Capture 'too many controls' $false)
  )
}
`,
      );
      const result = spawnSync(
        powershell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          fixture,
          fileURLToPath(source),
        ],
        { encoding: "utf8", timeout: 15_000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const refused = { code: "window_stale", rootRead: false, operationReached: false };
      expect(JSON.parse(result.stdout)).toEqual({
        snapshots: [
          { display: "31", scale: 1.5, elements: ["button"] },
          "stale_observation",
          "stale_observation",
          { display: "31", scale: 1.5, elements: ["button"] },
        ],
        gestures: [
          { code: "ok", moves: 1, events: [2048] },
          { code: "target_occluded", moves: 0, events: [] },
          { code: "target_occluded", moves: 1, events: [] },
          { code: "target_occluded", moves: 0, events: [] },
          { code: "target_occluded", moves: 1, events: [] },
          { code: "target_occluded", moves: 8, events: [2, 4] },
          { code: "ok", moves: 9, events: [2, 4] },
        ],
        exactRequests: ["snapshot", "click", "screenshot"].map((op) => ({
          op,
          sameMediumIntegrity: { code: "ok", rootRead: true, operationReached: op !== "snapshot" },
          elevatedTarget: refused,
          elevatedCallerAndTarget: refused,
          targetAboveCaller: refused,
          unknownTargetIntegrity: refused,
        })),
        captures: [
          ["none", false, "ok", 1, 1],
          ["root only", false, "screenshot_failed", 0, 0],
          ["root only", true, "screenshot_failed", 1, 0],
          ["unreadable sibling", true, "screenshot_failed", 1, 0],
          ["unknown type", false, "screenshot_failed", 0, 0],
          ["unknown password state", false, "screenshot_failed", 0, 0],
          ["protected", true, "sensitive_field", 1, 0],
          ["too deep", false, "screenshot_failed", 0, 0],
          ["too many controls", false, "screenshot_failed", 0, 0],
        ].map(([failure, afterPrint, code, prints, saves]) => ({
          failure,
          afterPrint,
          code,
          prints,
          saves,
        })),
      });
    } finally {
      await NodeFS.rm(directory, { recursive: true, force: true });
    }
  },
  20_000,
);

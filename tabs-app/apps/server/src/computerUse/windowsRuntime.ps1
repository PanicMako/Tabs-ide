
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public static class CuNative {
  [StructLayout(LayoutKind.Sequential)] private struct GUITHREADINFO {
    public int size, flags;
    public IntPtr active, focus, capture, menuOwner, moveSize, caret;
    public int left, top, right, bottom;
  }
  [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint MapVirtualKey(uint code, uint mode);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr hwnd, out uint affinity);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out int pid);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] private static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern bool GetUserObjectInformation(IntPtr desktop, int index, StringBuilder data, uint size, out uint needed);
  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
  [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll")] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll")] private static extern bool GetTokenInformation(IntPtr token, int info, IntPtr buffer, int size, out int needed);
  [DllImport("advapi32.dll")] private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
  [DllImport("advapi32.dll")] private static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
  private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc visit, IntPtr param);

  public static bool EligibleWindow(IntPtr hwnd) {
    int cloaked;
    return IsWindowVisible(hwnd) && !IsIconic(hwnd) &&
      DwmGetWindowAttribute(hwnd, 14, out cloaked, 4) == 0 && cloaked == 0;
  }
  public static IntPtr[] VisibleWindows() {
    var found = new List<IntPtr>();
    EnumWindows((hwnd, param) => {
      if (EligibleWindow(hwnd)) found.Add(hwnd);
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }
  public static bool PointerAt(int x, int y) {
    POINT point;
    return GetCursorPos(out point) && point.X == x && point.Y == y;
  }
  public static string PostWindowKey(IntPtr window, uint key) {
    int pid;
    var thread = GetWindowThreadProcessId(window, out pid);
    var info = new GUITHREADINFO { size = Marshal.SizeOf(typeof(GUITHREADINFO)) };
    if (thread == 0 || !GetGUIThreadInfo(thread, ref info) || info.focus == IntPtr.Zero ||
        GetAncestor(info.focus, 2) != window || GetForegroundWindow() != window)
      return "focus_changed";
    // Enqueue to the actual focused HWND. A subsequent focus change cannot redirect it.
    uint scan = MapVirtualKey(key, 4);
    int flags = 1 | (int)((scan & 0xff) << 16);
    if ((scan & 0xff00) != 0) flags |= 1 << 24;
    var wParam = new IntPtr(key);
    if (!PostMessage(info.focus, 0x100, wParam, new IntPtr(flags))) return "focus_changed";
    return PostMessage(info.focus, 0x101, wParam, new IntPtr(unchecked(flags | (int)0xc0000000)))
      ? "" : "input_unverified";
  }
  public static bool ProtectedCapture(IntPtr hwnd) {
    uint affinity;
    return GetWindowDisplayAffinity(hwnd, out affinity) && affinity != 0;
  }
  public static IntPtr HitRoot(int x, int y) {
    return GetAncestor(WindowFromPoint(new POINT { X = x, Y = y }), 2);
  }
  public static bool InteractiveDesktop() {
    var desktop = OpenInputDesktop(0, false, 1);
    if (desktop == IntPtr.Zero) return false;
    try {
      uint length;
      var name = new StringBuilder(256);
      return GetUserObjectInformation(desktop, 2, name, 512, out length) &&
        String.Equals(name.ToString(), "Default", StringComparison.OrdinalIgnoreCase);
    } finally { CloseDesktop(desktop); }
  }
  public static int Integrity(int pid) {
    var process = OpenProcess(0x1000, false, pid);
    if (process == IntPtr.Zero) return -1;
    IntPtr token = IntPtr.Zero;
    IntPtr buffer = IntPtr.Zero;
    try {
      if (!OpenProcessToken(process, 8, out token)) return -1;
      int size;
      GetTokenInformation(token, 25, IntPtr.Zero, 0, out size);
      if (size <= 0) return -1;
      buffer = Marshal.AllocHGlobal(size);
      if (!GetTokenInformation(token, 25, buffer, size, out size)) return -1;
      var sid = Marshal.ReadIntPtr(buffer);
      var count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
      return Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1)));
    } finally {
      if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
      if (token != IntPtr.Zero) CloseHandle(token);
      CloseHandle(process);
    }
  }

}
'@

$SensitivePattern = $env:TABS_COMPUTER_USE_SENSITIVE_PATTERN
$BlockedApps = @($env:TABS_COMPUTER_USE_BLOCKED_APPS | ConvertFrom-Json)
$Editable = @('Edit', 'Document', 'ComboBox')
$Transparent = @('Pane', 'Group', 'Custom', 'Window')
$ValueTypes = @('Edit', 'Document', 'ComboBox', 'CheckBox', 'RadioButton', 'Slider', 'Spinner', 'ProgressBar')
$MaxDepth = 40

function Fail($code, $message) {
  throw ('CU|' + $code + '|' + $message)
}
function Clip($text, $limit) {
  $flat = [regex]::Replace([string]$text, '[\r\n\t]+', ' ')
  if ($flat.Length -gt $limit) { return $flat.Substring(0, $limit) + '...' }
  return $flat
}
function TypeName($el) {
  return $el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
}
function Pattern($el, $pattern) {
  $out = $null
  if ($el.TryGetCurrentPattern($pattern, [ref]$out)) { return $out }
  return $null
}
function ValueOf($el) {
  $vp = Pattern $el ([System.Windows.Automation.ValuePattern]::Pattern)
  if ($vp -ne $null) { return [string]$vp.Current.Value }
  return ''
}
function IsSecure($el) {
  if ($el.Current.IsPassword) { return $true }
  $type = TypeName $el
  if ($Editable -contains $type) {
    $label = $el.Current.Name + ' ' + $el.Current.AutomationId + ' ' + $el.Current.HelpText
    return [regex]::IsMatch($label, $SensitivePattern, 'IgnoreCase')
  }
  return $false
}
function Rect($el) {
  $r = $el.Current.BoundingRectangle
  if ([double]::IsInfinity($r.X) -or $r.Width -le 0) { return $null }
  return @{ x = [int]$r.X; y = [int]$r.Y; width = [int]$r.Width; height = [int]$r.Height }
}
function AppInfo($proc) {
  return @{ name = $proc.ProcessName; bundleId = $null; pid = $proc.Id }
}
function ListProcs() {
  return @(Get-Process | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero })
}
function ResolveApp($sel) {
  $procs = ListProcs
  if ($sel.kind -eq 'pid') {
    $hit = @($procs | Where-Object { $_.Id -eq $sel.pid })
    if ($hit.Count -ge 1) { return $hit[0] }
    Fail 'app_not_found' ('No running app has pid ' + $sel.pid + '. Call computer_list_apps.')
  }
  $q = $sel.query.ToLower()
  $exact = @($procs | Where-Object { $_.ProcessName.ToLower() -eq $q })
  if ($exact.Count -eq 0) { $exact = @($procs | Where-Object { $_.ProcessName.ToLower().Contains($q) -or $_.MainWindowTitle.ToLower().Contains($q) }) }
  if ($exact.Count -eq 1) { return $exact[0] }
  if ($exact.Count -gt 1) { Fail 'app_not_found' ('App "' + $sel.query + '" is ambiguous: ' + (($exact | Select-Object -First 6 | ForEach-Object { $_.ProcessName + ' (pid ' + $_.Id + ')' }) -join ', ') + '. Use pid:N.') }
  Fail 'app_not_found' ('No running app matches "' + $sel.query + '". Call computer_list_apps.')
}
function RejectBlocked($proc) {
  $hay = ($proc.ProcessName + ' ' + $proc.MainWindowTitle).ToLower()
  foreach ($b in $BlockedApps) { if ($hay.Contains($b)) { Fail 'app_blocked' ($proc.ProcessName + ' is a password manager and is off limits to computer use.') } }
}

$script:NativeRequest = $null
$script:NativeHandle = [IntPtr]::Zero
$script:DpiContext = [CuNative]::SetThreadDpiAwarenessContext([IntPtr](-4))

function TargetId($proc, [IntPtr]$handle, $el) {
  return ([string]$proc.Id + ':' + $proc.StartTime.ToUniversalTime().Ticks + ':' + $handle.ToInt64() + ':' + ($el.GetRuntimeId() -join '.'))
}
function AccessibleWindows {
  if (-not [CuNative]::InteractiveDesktop()) { return }
  foreach ($handle in [CuNative]::VisibleWindows()) {
    try {
      $owner = 0
      [void][CuNative]::GetWindowThreadProcessId($handle, [ref]$owner)
      $p = Get-Process -Id $owner
      RejectBlocked $p
      if ($p.ProcessName -match "^Tabs( IDE)?$") { continue }
      $el = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
      if ($null -eq $el -or $el.Current.ProcessId -ne $owner) { continue }
      $title = [string]$el.Current.Name
      $frame = Rect $el
      $integrity = [CuNative]::Integrity($owner)
      if (-not $title -or -not $frame -or $integrity -lt 0 -or $integrity -ge 0x3000 -or $integrity -gt [CuNative]::Integrity($PID)) { continue }
      @{ id = (TargetId $p $handle $el); app = $p.ProcessName; title = $title; pid = $owner; frame = $frame }
    } catch {
      # A window can close during enumeration or be protected from this process.
      continue
    }
  }
}
function CheckControl {
  if ($null -ne $script:NativeRequest -and $script:NativeRequest.controlFile -and
      -not [System.IO.File]::Exists($script:NativeRequest.controlFile)) { Fail 'user_turn' 'The user has taken control.' }
}
function SameFrame($first, $second) {
  return ($first.x -eq $second.x -and $first.y -eq $second.y -and $first.width -eq $second.width -and $first.height -eq $second.height)
}
function ReadWindowLayout($proc, $reobserve) {
  CheckControl
  if (-not [CuNative]::InteractiveDesktop()) { Fail 'permission_denied' 'The Windows input desktop is inaccessible.' }
  $h = $script:NativeHandle
  $owner = 0
  [void][CuNative]::GetWindowThreadProcessId($h, [ref]$owner)
  $integrity = [CuNative]::Integrity($owner)
  if ($owner -ne $proc.Id -or $integrity -lt 0 -or $integrity -ge 0x3000 -or $integrity -gt [CuNative]::Integrity($PID) -or
      -not [CuNative]::EligibleWindow($h)) { Fail 'window_stale' 'The selected window closed, is hidden or is protected.' }
  $root = RootOf $proc
  if ($null -eq $root -or $root.Current.ProcessId -ne $owner -or (TargetId $proc $h $root) -ne $script:NativeRequest.app.id) { Fail 'window_stale' 'The window identity changed.' }
  $frame = Rect $root
  $expected = $script:NativeRequest.native
  if (-not $frame) { Fail 'window_stale' 'The window has no usable frame.' }
  $display = [string][CuNative]::MonitorFromWindow($h, 2).ToInt64()
  $scale = [CuNative]::GetDpiForWindow($h) / 96
  if (-not $reobserve -and (($expected.frame -and -not (SameFrame $frame $expected.frame)) -or
      ($null -ne $expected.scale -and $scale -ne $expected.scale) -or
      ($expected.display -and $display -ne $expected.display))) {
    Fail 'stale_observation' 'The window moved, resized or changed display scale.'
  }
  return @{ frame = $frame; display = $display; scale = $scale }
}
function CheckLayout($proc, $reobserve) {
  return (ReadWindowLayout $proc $reobserve).frame
}
function ResolveExact($req) {
  $idParts = $req.app.id.Split(':')
  $p = Get-Process -Id ([int]$idParts[0]) -ErrorAction SilentlyContinue
  if (-not $p) { Fail 'window_stale' 'The selected app has closed.' }
  RejectBlocked $p
  if ($p.ProcessName -match '^Tabs( IDE)?$') { Fail 'app_blocked' 'Tabs cannot operate its own desktop controls.' }
  $script:NativeRequest = $req
  $script:NativeHandle = [IntPtr]([long]$idParts[2])
  $null = CheckLayout $p
  return $p
}
function NodeToken($node) {
  $f = Rect $node.el
  $parts = @(($node.el.GetRuntimeId() -join '.'), $node.type, (Clip $node.label 120), $f.x, $f.y, $f.width, $f.height)
  if (-not $parts[0]) { return $null }
  return (ConvertTo-Json -InputObject $parts -Compress)
}
function CheckNode($node, $expected) {
  if (-not $expected -or (NodeToken $node) -cne $expected) { Fail 'stale_observation' 'The accessibility element changed.' }
  CheckControl
}
function CheckForeground($proc, $point) {
  if (-not $script:NativeRequest.native.foreground -or -not $script:NativeRequest.foreground) {
    Fail 'background_unavailable' 'This action requires physical input.'
  }
  if ($script:DpiContext -eq [IntPtr]::Zero) { Fail 'unsupported_capability' 'Per-monitor DPI mapping is unavailable.' }
  $f = CheckLayout $proc
  if ([CuNative]::GetForegroundWindow() -ne $script:NativeHandle) {
    Fail 'focus_changed' 'Bring the selected window to the front before sending physical input.'
  }
  if ($null -ne $point) {
    if ($point.x -lt $f.x -or $point.y -lt $f.y -or $point.x -ge ($f.x + $f.width) -or $point.y -ge ($f.y + $f.height)) {
      Fail 'element_not_clickable' 'The point is outside the selected window.'
    }
    if ([CuNative]::HitRoot($point.x, $point.y) -ne $script:NativeHandle) { Fail 'target_occluded' 'Another window or overlay covers this point.' }
  }
}
function Permissions {
  $desktop = [CuNative]::InteractiveDesktop()
  $uia = $false
  if ($desktop) {
    try { $uia = $null -ne [System.Windows.Automation.AutomationElement]::RootElement } catch {}
  }
  $input = $uia -and $script:DpiContext -ne [IntPtr]::Zero
  $details = 'Windows UI Automation is available on the interactive desktop. Elevated, minimized and protected windows are excluded.'
  if (-not $uia) { $details = 'The Windows input desktop or UI Automation is unavailable.' }
  elseif (-not $input) { $details += ' Per-monitor DPI mapping is unavailable, so physical input and capture are disabled.' }
  else { $details += ' Keyboard input supports unmodified keys in the selected foreground window.' }
  return @{ accessibility = $uia; screenRecording = 'unknown'; capabilities = @{
    session = 'windows'; windowSelection = $uia; accessibilityActions = $uia; windowCapture = $input;
    foregroundInput = $input; details = $details
  } }
}
function RootOf($proc) {
  if ($null -ne $script:NativeRequest) { return [System.Windows.Automation.AutomationElement]::FromHandle($script:NativeHandle) }
  return [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
}

function Walk($root, $maxNodes) {
  $nodes = New-Object System.Collections.ArrayList
  $state = @{ truncated = $false }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  function Visit($el, $depth) {
    if ($depth -gt $MaxDepth) { $state.truncated = $true; return }
    $type = TypeName $el
    $label = [string]$el.Current.Name
    $secure = IsSecure $el
    $text = ''
    if (-not $secure -and ($ValueTypes -contains $type)) { $text = ValueOf $el }
    $shown = $label
    if ($type -eq 'Text' -and -not $label) { $shown = $text }
    $childDepth = $depth
    if (-not (($Transparent -contains $type) -and -not $shown -and -not $secure)) {
      if ($nodes.Count -ge $maxNodes) { $state.truncated = $true; return }
      [void]$nodes.Add(@{ el = $el; type = $type; label = $label; text = $text; secure = $secure; depth = $depth; enabled = [bool]$el.Current.IsEnabled; focused = [bool]$el.Current.HasKeyboardFocus })
      $childDepth = $depth + 1
    }
    $kid = $walker.GetFirstChild($el)
    while ($kid -ne $null) {
      Visit $kid $childDepth
      $kid = $walker.GetNextSibling($kid)
    }
  }
  Visit $root 0
  return @{ nodes = $nodes; truncated = $state.truncated }
}

function Render($node, $index, $base) {
  $parts = New-Object System.Collections.ArrayList
  [void]$parts.Add(('<TAB>' * ($node.depth - $base)) + [string]$index)
  [void]$parts.Add($node.type)
  if ($node.label) { [void]$parts.Add('"' + (Clip $node.label 100) + '"') }
  if ($node.secure) { [void]$parts.Add('(secure)') }
  elseif ($node.text) { [void]$parts.Add('value=' + (ConvertTo-Json (Clip $node.text 100) -Compress)) }
  if (-not $node.enabled) { [void]$parts.Add('(disabled)') }
  if ($node.focused) { [void]$parts.Add('(focused)') }
  return (($parts -join ' ') -replace '<TAB>', [string][char]9)
}

function Snapshot($proc, $maxNodes, $rootIndex, $afterAction) {
  $layout = $null
  if ($null -ne $script:NativeRequest) { $layout = ReadWindowLayout $proc $afterAction }
  $root = RootOf $proc
  if ($null -ne $layout) { $frame = $layout.frame } else { $frame = Rect $root }
  if ($frame -eq $null) { $frame = @{ x = 0; y = 0; width = 0; height = 0 } }
  $walked = Walk $root $maxNodes
  $nodes = $walked.nodes
  $start = 0
  $end = $nodes.Count
  if ($rootIndex -ne $null) {
    if ($rootIndex -lt 1 -or $rootIndex -gt $nodes.Count) { Fail 'element_not_found' ('Element ' + $rootIndex + ' is not in the current window. Take a fresh snapshot.') }
    $start = $rootIndex - 1
    $end = $start + 1
    while ($end -lt $nodes.Count -and $nodes[$end].depth -gt $nodes[$start].depth) { $end++ }
  }
  if ($null -ne $script:NativeRequest -and $null -ne $rootIndex) { CheckNode $nodes[$rootIndex - 1] $script:NativeRequest.native.elements.([string]$rootIndex) }
  $lines = New-Object System.Collections.ArrayList
  $focused = $null
  for ($i = $start; $i -lt $end; $i++) {
    [void]$lines.Add((Render $nodes[$i] ($i + 1) $nodes[$start].depth))
    if ($nodes[$i].focused) { $focused = $i + 1 }
  }
  $title = [string]$root.Current.Name
  $header = 'App: ' + $proc.ProcessName + ' (pid ' + $proc.Id + ')' + [char]10 + 'Window: ' + (ConvertTo-Json (Clip $title 120) -Compress) + ' at (' + $frame.x + ', ' + $frame.y + ') size ' + $frame.width + 'x' + $frame.height + ' points; click coordinates are window-local.'
  $note = ''
  if ($walked.truncated) { $note = ' (snapshot limit reached: pass rootElementIndex to read a subtree, or raise maxNodes)' }
  $footer = [string]($end - $start) + ' elements' + $note + '.'
  $result = @{
    id = ([string]$proc.Id + ':' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    app = (AppInfo $proc)
    window = @{ title = $title; key = 'window'; frame = $frame }
    treeText = ($header + [char]10 + [char]10 + ($lines -join [string][char]10) + [char]10 + [char]10 + $footer)
    elementCount = ($end - $start)
    focusedElementIndex = $focused
    truncated = $walked.truncated
  }
  if ($null -ne $layout) {
    $tokens = New-Object object[] $nodes.Count
    for ($i = 0; $i -lt $nodes.Count; $i++) { $tokens[$i] = NodeToken $nodes[$i] }
    $after = ReadWindowLayout $proc $afterAction
    if (-not (SameFrame $layout.frame $after.frame) -or $layout.display -ne $after.display -or $layout.scale -ne $after.scale) {
      Fail 'stale_observation' 'The layout changed while it was being read.'
    }
    $result.window.key = $script:NativeRequest.app.id
    $result.elements = $tokens
    $result.display = $layout.display
    $result.scale = $layout.scale
  }
  return $result
}

function NodeAt($proc, $index, $maxNodes) {
  $walked = Walk (RootOf $proc) ([Math]::Max($maxNodes, $index))
  if ($index -lt 1 -or $index -gt $walked.nodes.Count) { Fail 'element_not_found' ('Element ' + $index + ' is not in the current window. Take a fresh snapshot.') }
  $node = $walked.nodes[$index - 1]
  if ($null -ne $script:NativeRequest) {
    CheckNode $node $script:NativeRequest.native.elements.([string]$index)
    $null = CheckLayout $proc
  }
  return $node
}
function Raise($proc) {
  [void][CuNative]::ShowWindow($proc.MainWindowHandle, 9)
  [void][CuNative]::SetForegroundWindow($proc.MainWindowHandle)
  Start-Sleep -Milliseconds 200
}
function PointFor($proc, $target, $maxNodes) {
  if ($target.kind -eq 'point') {
    $f = Rect (RootOf $proc)
    if ($f -eq $null) { Fail 'window_not_found' 'Could not read the window frame.' }
    return @{ x = [int]($f.x + $target.x); y = [int]($f.y + $target.y) }
  }
  $node = NodeAt $proc $target.index $maxNodes
  $r = Rect $node.el
  if ($r -eq $null) { Fail 'element_not_clickable' ('Element ' + $target.index + ' has no on-screen frame.') }
  return @{ x = [int]($r.x + $r.width / 2); y = [int]($r.y + $r.height / 2); element = $node.el }
}
function CheckClickHit($proc, $point) {
  $verified = $false
  $secure = $false
  try {
    $root = RootOf $proc
    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $hit = [System.Windows.Automation.AutomationElement]::FromPoint(
      [System.Windows.Point]::new($point.x, $point.y))
    $matchesTarget = $null -eq $point.element
    for ($depth = 0; $null -ne $hit -and $depth -le $MaxDepth; $depth++) {
      if (!$matchesTarget -and [System.Windows.Automation.Automation]::Compare($hit, $point.element)) {
        $matchesTarget = $true
      }
      if ([System.Windows.Automation.Automation]::Compare($hit, $root)) {
        $verified = $matchesTarget
        break
      }
      if ($hit.Current.ProcessId -ne $proc.Id) { break }
      if (IsSecure $hit) { $secure = $true }
      $hit = $walker.GetParent($hit)
    }
  } catch {
    # UI Automation can lose the element while reading its ancestry.
    $verified = $false
  }
  if (!$verified) { Fail 'target_occluded' 'Windows could not verify the click target at this point.' }
  if ($secure) { Fail 'sensitive_field' 'Ask the user to handle this protected control.' }
}
function MouseAt($proc, $p, $right, $count) {
  if ($null -ne $script:NativeRequest) {
    CheckClickHit $proc $p
    CheckForeground $proc $p
  }
  if (-not [CuNative]::SetCursorPos($p.x, $p.y)) { Fail 'focus_changed' 'Windows rejected the pointer move.' }
  $down = 2; $up = 4
  if ($right) { $down = 8; $up = 16 }
  for ($i = 0; $i -lt $count; $i++) {
    if ($null -ne $script:NativeRequest) {
      CheckClickHit $proc $p
      CheckForeground $proc $p
      if (-not [CuNative]::PointerAt($p.x, $p.y)) { Fail 'focus_changed' 'The pointer moved before input.' }
    }
    [CuNative]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
    [CuNative]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 50
  }
}
function Done($path, $delivery, $detail) {
  return @{ path = $path; delivery = $delivery; detail = $detail }
}

function DoClick($proc, $req) {
  $right = ($req.button -eq 'right')
  if ($req.target.kind -eq 'element') {
    $node = NodeAt $proc $req.target.index $req.maxNodes
    if ($null -ne $script:NativeRequest -and $node.secure) { Fail 'sensitive_field' 'Ask the user to handle this protected control.' }
    if (-not $node.enabled) { Fail 'element_not_enabled' ('Element ' + $req.target.index + ' is disabled. Nothing was sent.') }
    if (-not $req.foreground -and -not $right -and $req.clickCount -eq 1) {
      $el = $node.el
      $p = Pattern $el ([System.Windows.Automation.InvokePattern]::Pattern)
      if ($p -ne $null) { $p.Invoke(); return Done 'accessibility' 'background' ('invoked ' + (Render $node $req.target.index $node.depth)) }
      $p = Pattern $el ([System.Windows.Automation.TogglePattern]::Pattern)
      if ($p -ne $null) { $p.Toggle(); return Done 'accessibility' 'background' ('toggled ' + (Render $node $req.target.index $node.depth)) }
      $p = Pattern $el ([System.Windows.Automation.SelectionItemPattern]::Pattern)
      if ($p -ne $null) { $p.Select(); return Done 'accessibility' 'background' ('selected ' + (Render $node $req.target.index $node.depth)) }
      $p = Pattern $el ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
      if ($p -ne $null) { $p.Expand(); return Done 'accessibility' 'background' ('expanded ' + (Render $node $req.target.index $node.depth)) }
      if ($null -eq $script:NativeRequest -and $Editable -contains $node.type) { $el.SetFocus(); return Done 'accessibility' 'background' ('focused ' + (Render $node $req.target.index $node.depth)) }
    }
  }
  $pt = PointFor $proc $req.target $req.maxNodes
  if ($null -ne $script:NativeRequest) { CheckForeground $proc $pt } else { Raise $proc }
  MouseAt $proc $pt $right $req.clickCount
  return Done 'synthetic' 'foreground' 'clicked with the real pointer'
}

function DoType($proc, $req) {
  if ($req.elementIndex -ne $null) { $node = NodeAt $proc $req.elementIndex $req.maxNodes }
  else {
    $walked = Walk (RootOf $proc) $req.maxNodes
    $node = $walked.nodes | Where-Object { $_.focused } | Select-Object -First 1
    if ($node -eq $null) { Fail 'element_not_found' 'No text field has focus in that app. Click a field first, or pass elementIndex.' }
  }
  if ($null -ne $script:NativeRequest -and $null -eq $req.elementIndex) {
    CheckNode $node $script:NativeRequest.native.focused
    $null = CheckLayout $proc
  }
  if ($node.secure) { Fail 'sensitive_field' 'Refusing to type into a password or other secret field. Ask the user to enter it themselves.' }
  if (-not $node.enabled) { Fail 'element_not_enabled' 'That field is disabled.' }
  $vp = Pattern $node.el ([System.Windows.Automation.ValuePattern]::Pattern)
  if ($vp -ne $null -and -not $vp.Current.IsReadOnly) {
    $before = [string]$vp.Current.Value
    $vp.SetValue($before + $req.text)
    $ok = ((ValueOf $node.el) -eq ($before + $req.text))
    $state = 'unverified'; $why = 'the write succeeded but the field did not read back the expected text; check the tree'
    if ($ok) { $state = 'verified'; $why = 'the field now holds the text' }
    $r = Done 'accessibility' 'background' 'appended text through the value pattern'
    $r.verification = @{ state = $state; detail = $why }
    return $r
  }
  if ($req.elementIndex -ne $null) { Fail 'value_not_settable' 'That element does not accept text through accessibility. Click it, then call computer_type without elementIndex.' }
  if ($null -ne $script:NativeRequest) { Fail 'background_unavailable' 'This field needs direct keyboard input. Ask the user to type it.' }
  Raise $proc
  $again = (Walk (RootOf $proc) $req.maxNodes).nodes | Where-Object { $_.focused } | Select-Object -First 1
  if ($again -eq $null -or $again.secure) { Fail 'sensitive_field' 'Refusing to type into a password or other secret field. Ask the user to enter it themselves.' }
  $escaped = [regex]::Replace($req.text, '([+^%~(){}\[\]])', '{$1}')
  [System.Windows.Forms.SendKeys]::SendWait($escaped)
  $r = Done 'synthetic' 'foreground' 'typed with the keyboard; the window was raised'
  $r.verification = @{ state = 'unverified'; detail = 'keystrokes are not read back' }
  return $r
}

function DoSetValue($proc, $req) {
  $node = NodeAt $proc $req.elementIndex $req.maxNodes
  if ($node.secure) { Fail 'sensitive_field' 'Refusing to write a password or other secret field. Ask the user to enter it themselves.' }
  if (-not $node.enabled) { Fail 'element_not_enabled' ('Element ' + $req.elementIndex + ' is disabled.') }
  $vp = Pattern $node.el ([System.Windows.Automation.ValuePattern]::Pattern)
  if ($vp -eq $null -or $vp.Current.IsReadOnly) { Fail 'value_not_settable' ('Element ' + $req.elementIndex + ' does not accept a value. Use computer_type or another action.') }
  $vp.SetValue([string]$req.value)
  $ok = ((ValueOf $node.el) -eq [string]$req.value)
  $state = 'unverified'; $why = 'the element reports a different value than requested'
  if ($ok) { $state = 'verified'; $why = 'the element reads back the new value' }
  $r = Done 'accessibility' 'background' ('set the value of ' + (Render $node $req.elementIndex $node.depth))
  $r.verification = @{ state = $state; detail = $why }
  return $r
}

function DoSecondary($proc, $req) {
  $node = NodeAt $proc $req.elementIndex $req.maxNodes
  if (-not $node.enabled) { Fail 'element_not_enabled' ('Element ' + $req.elementIndex + ' is disabled.') }
  if ($null -ne $script:NativeRequest -and $node.secure) { Fail 'sensitive_field' 'Ask the user to handle this protected control.' }
  $el = $node.el
  $name = $req.action.ToLower()
  $names = @()
  if ((Pattern $el ([System.Windows.Automation.InvokePattern]::Pattern)) -ne $null) { $names += 'invoke' }
  if ((Pattern $el ([System.Windows.Automation.TogglePattern]::Pattern)) -ne $null) { $names += 'toggle' }
  if ((Pattern $el ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)) -ne $null) { $names += 'expand'; $names += 'collapse' }
  if ((Pattern $el ([System.Windows.Automation.SelectionItemPattern]::Pattern)) -ne $null) { $names += 'select' }
  if ((Pattern $el ([System.Windows.Automation.ScrollItemPattern]::Pattern)) -ne $null) { $names += 'scrollintoview' }
  $names += 'focus'
  if ($names -notcontains $name) { Fail 'action_not_supported' ('Element ' + $req.elementIndex + ' lists these actions: ' + ($names -join ', ') + '.') }
  if ($null -ne $script:NativeRequest -and $name -eq 'focus') { Fail 'background_unavailable' 'Ask the user to focus the control.' }
  switch ($name) {
    'invoke' { (Pattern $el ([System.Windows.Automation.InvokePattern]::Pattern)).Invoke() }
    'toggle' { (Pattern $el ([System.Windows.Automation.TogglePattern]::Pattern)).Toggle() }
    'expand' { (Pattern $el ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)).Expand() }
    'collapse' { (Pattern $el ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)).Collapse() }
    'select' { (Pattern $el ([System.Windows.Automation.SelectionItemPattern]::Pattern)).Select() }
    'scrollintoview' { (Pattern $el ([System.Windows.Automation.ScrollItemPattern]::Pattern)).ScrollIntoView() }
    'focus' { $el.SetFocus() }
  }
  return Done 'accessibility' 'background' ('performed ' + $name + ' on ' + (Render $node $req.elementIndex $node.depth))
}

$SendKeysNames = @{ return = '{ENTER}'; tab = '{TAB}'; space = ' '; escape = '{ESC}'; backspace = '{BACKSPACE}'; forwarddelete = '{DELETE}'; left = '{LEFT}'; right = '{RIGHT}'; up = '{UP}'; down = '{DOWN}'; home = '{HOME}'; end = '{END}'; pageup = '{PGUP}'; pagedown = '{PGDN}' }
$WindowKeyCodes = @{ return = 0x0d; tab = 0x09; space = 0x20; escape = 0x1b; backspace = 0x08; forwarddelete = 0x2e; left = 0x25; up = 0x26; right = 0x27; down = 0x28; home = 0x24; end = 0x23; pageup = 0x21; pagedown = 0x22 }
function PostNativeKey($proc, $req) {
  $key = $req.key
  $code = $WindowKeyCodes[$key.name]
  if (-not $code -and $key.name -match '^f([1-9]|1[0-2])$') { $code = 0x6f + [int]$key.name.Substring(1) }
  if (-not $code -and $key.name -match '^[a-z0-9]$') { $code = [int][char]$key.name.ToUpperInvariant() }
  if (-not $code -or $key.modifiers.Count -gt 0) {
    Fail 'unsupported_capability' 'Window-scoped Windows input supports unmodified navigation, letter, number and function keys. Ask the user to send this shortcut.'
  }
  $focus = (Walk (RootOf $proc) $req.maxNodes).nodes | Where-Object { $_.focused } | Select-Object -First 1
  if ($null -eq $focus -or $focus.secure) { Fail 'sensitive_field' 'The focused control is unavailable or protected.' }
  CheckNode $focus $script:NativeRequest.native.focused
  CheckForeground $proc $null
  $status = [CuNative]::PostWindowKey($script:NativeHandle, $code)
  if ($status -eq 'focus_changed') { Fail 'focus_changed' 'Windows declined input to the focused control.' }
  $result = Done 'synthetic' 'foreground' ('queued '+ $key.label + ' to the selected window')
  $result.verification = @{ state = 'unverified'; detail = 'the target application may ignore window-scoped keyboard events' }
  return $result
}
function DoKey($proc, $req) {
  if ($null -ne $script:NativeRequest) { return PostNativeKey $proc $req }
  $key = $req.key
  if ($key.insertsText) {
    $focus = (Walk (RootOf $proc) $req.maxNodes).nodes | Where-Object { $_.focused } | Select-Object -First 1
    if ($focus -ne $null -and $focus.secure) { Fail 'sensitive_field' 'Refusing to send text-producing keys to a password or other secret field. Ask the user to enter it themselves.' }
  }
  if ($key.modifiers -contains 'super') { Fail 'unsupported_capability' 'Windows-key chords cannot be sent with SendKeys.' }
  $prefix = ''
  if ($key.modifiers -contains 'control') { $prefix += '^' }
  if ($key.modifiers -contains 'option') { $prefix += '%' }
  if ($key.modifiers -contains 'shift') { $prefix += '+' }
  $body = $key.name
  if ($SendKeysNames.ContainsKey($key.name)) { $body = $SendKeysNames[$key.name] }
  elseif ($key.name -match '^f[0-9]+$') { $body = '{' + $key.name.ToUpper() + '}' }
  elseif ($key.name.Length -eq 1 -and '+^%~(){}[]'.Contains($key.name)) { $body = '{' + $key.name + '}' }
  Raise $proc
  [System.Windows.Forms.SendKeys]::SendWait($prefix + $body)
  return Done 'synthetic' 'foreground' ('sent ' + $key.label + ' to the foreground window')
}

function DoScroll($proc, $req) {
  if ($req.target.kind -eq 'element' -and -not $req.foreground) {
    $node = NodeAt $proc $req.target.index $req.maxNodes
    $sp = Pattern $node.el ([System.Windows.Automation.ScrollPattern]::Pattern)
    if ($sp -ne $null) {
      $v = [System.Windows.Automation.ScrollAmount]::NoAmount; $h = [System.Windows.Automation.ScrollAmount]::NoAmount
      if ($req.dy -gt 0) { $v = [System.Windows.Automation.ScrollAmount]::SmallDecrement } elseif ($req.dy -lt 0) { $v = [System.Windows.Automation.ScrollAmount]::SmallIncrement }
      if ($req.dx -gt 0) { $h = [System.Windows.Automation.ScrollAmount]::SmallDecrement } elseif ($req.dx -lt 0) { $h = [System.Windows.Automation.ScrollAmount]::SmallIncrement }
      $count = [Math]::Max([Math]::Abs($req.dx), [Math]::Abs($req.dy))
      for ($i = 0; $i -lt $count; $i++) { CheckControl; $sp.Scroll($h, $v) }
      return Done 'accessibility' 'background' 'scrolled through the scroll pattern'
    }
  }
  $pt = PointFor $proc $req.target $req.maxNodes
  if ($null -ne $script:NativeRequest) {
    CheckForeground $proc $pt
    CheckClickHit $proc $pt
    CheckForeground $proc $pt
  } else { Raise $proc }
  if (-not [CuNative]::SetCursorPos($pt.x, $pt.y)) { Fail 'focus_changed' 'Windows rejected the pointer move.' }
  if ($null -ne $script:NativeRequest) {
    CheckClickHit $proc $pt
    CheckForeground $proc $pt
    if (-not [CuNative]::PointerAt($pt.x, $pt.y)) { Fail 'focus_changed' 'The pointer moved before input.' }
  }
  if ($req.dy -ne 0) { [CuNative]::mouse_event(0x0800, 0, 0, [int]($req.dy * 120), [UIntPtr]::Zero) }
  if ($req.dx -ne 0) { [CuNative]::mouse_event(0x01000, 0, 0, [int](-$req.dx * 120), [UIntPtr]::Zero) }
  return Done 'synthetic' 'foreground' 'scrolled with the real pointer'
}

function DoDrag($proc, $req) {
  $from = PointFor $proc $req.from $req.maxNodes
  $to = PointFor $proc $req.to $req.maxNodes
  if ($null -ne $script:NativeRequest) {
    CheckForeground $proc $to
    CheckClickHit $proc $to
    CheckClickHit $proc $from
    CheckForeground $proc $from
  } else { Raise $proc }
  if (-not [CuNative]::SetCursorPos($from.x, $from.y)) { Fail 'focus_changed' 'Windows rejected the pointer move.' }
  if ($null -ne $script:NativeRequest) {
    CheckClickHit $proc $from
    CheckForeground $proc $from
    if (-not [CuNative]::PointerAt($from.x, $from.y)) { Fail 'focus_changed' 'The pointer moved before input.' }
  }
  $last = $from
  [CuNative]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  try {
    for ($i = 1; $i -le 8; $i++) {
      $point = @{ x = [int]($from.x + ($to.x - $from.x) * $i / 8); y = [int]($from.y + ($to.y - $from.y) * $i / 8) }
      if ($null -ne $script:NativeRequest) {
        if ($i -eq 8) { CheckClickHit $proc $to }
        CheckForeground $proc $point
        if (-not [CuNative]::PointerAt($last.x, $last.y)) { Fail 'focus_changed' 'The pointer moved during the drag.' }
      }
      if (-not [CuNative]::SetCursorPos($point.x, $point.y)) { Fail 'focus_changed' 'Windows rejected the pointer move.' }
      $last = $point
      Start-Sleep -Milliseconds 20
    }
  } finally {
    [CuNative]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  }
  return Done 'synthetic' 'foreground' 'dragged with the real pointer'
}

function CheckScreenshotProtection($proc) {
  $incomplete = 'Windows UI Automation could not check the entire window for protected fields.'
  $state = @{ remaining = 600 }
  function VisitCaptureElement($el, $depth) {
    if ($null -eq $el -or $depth -gt $MaxDepth -or $state.remaining -eq 0) { Fail 'screenshot_failed' $incomplete }
    $state.remaining--
    $password = $el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsPasswordProperty, $true)
    if ($password -is [bool] -and $password) { return $true }
    $type = $el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $true)
    if ($type -isnot [System.Windows.Automation.ControlType]) { Fail 'screenshot_failed' $incomplete }
    $editableControl = $Editable -contains ($type.ProgrammaticName -replace '^ControlType\.', '')
    if ($password -isnot [bool] -and ($editableControl -or
        -not [object]::ReferenceEquals($password, [System.Windows.Automation.AutomationElement]::NotSupported))) {
      Fail 'screenshot_failed' $incomplete
    }
    if ($editableControl) {
      $current = $el.Current
      # UIA permits absent labels. Their default is an empty string.
      $name, $id, $help = $current.Name, $current.AutomationId, $current.HelpText
      if ($null -eq $name -or $null -eq $id -or $null -eq $help) { Fail 'screenshot_failed' $incomplete }
      if ([regex]::IsMatch("$name $id $help", $SensitivePattern, 'IgnoreCase')) { return $true }
    }
    $child = $walker.GetFirstChild($el)
    # An HWND can expose a UIA root without exposing its contents.
    if ($depth -eq 0 -and $null -eq $child) { Fail 'screenshot_failed' $incomplete }
    while ($null -ne $child) {
      if (VisitCaptureElement $child ($depth + 1)) { return $true }
      $child = $walker.GetNextSibling($child)
    }
    return $false
  }
  try {
    # Inspect raw descendants, including controls omitted from the semantic tree.
    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $sensitive = VisitCaptureElement (RootOf $proc) 0
  } catch {
    Fail 'screenshot_failed' $incomplete
  }
  if ($sensitive) { Fail 'sensitive_field' 'Ask the user to finish the protected step before capturing this window.' }
}

function CheckScreenshotScope($proc) {
  $null = CheckLayout $proc
  CheckScreenshotProtection $proc
  $frame = CheckLayout $proc
  if ([CuNative]::ProtectedCapture($script:NativeHandle)) { Fail 'permission_denied' 'The selected window is protected against screen capture.' }
  return $frame
}

function DoScreenshot($proc, $req) {
  $exact = $null -ne $script:NativeRequest
  if ($exact) {
    if ($script:DpiContext -eq [IntPtr]::Zero) { Fail 'unsupported_capability' 'Per-monitor DPI mapping is unavailable.' }
    $f = CheckScreenshotScope $proc
  } else {
    $f = Rect (RootOf $proc)
  }
  if ($f -eq $null) { Fail 'window_not_found' 'The app has no window to capture.' }
  $bmp = New-Object System.Drawing.Bitmap $f.width, $f.height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    if ($exact) {
      $null = CheckLayout $proc
      $context = $g.GetHdc()
      try { $captured = [CuNative]::PrintWindow($script:NativeHandle, $context, 2) }
      finally { $g.ReleaseHdc($context) }
      if (-not $captured) { Fail 'screenshot_failed' 'Windows or the application declined window capture.' }
      $null = CheckScreenshotScope $proc
    } else {
      $g.CopyFromScreen($f.x, $f.y, 0, 0, $bmp.Size)
    }
    $bmp.Save([string]$req.path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $g.Dispose(); $bmp.Dispose() }
  return Done 'synthetic' 'background' 'captured the window'
}

function RunRequest($req) {
  $result = @{ ok = $true }
  switch ($req.op) {
    'permissions' { $result.permissions = Permissions }
    'listWindows' { $result.permissions = Permissions; $result.windows = @(AccessibleWindows) }
    'listApps' { $result.apps = @(ListProcs | ForEach-Object { @{ name = $_.ProcessName; bundleId = $null; pid = $_.Id; active = $false; hidden = $false } }) }
    'focusApp' {
      if ($req.app.kind -eq 'window') {
        $p = ResolveExact $req
        [void][CuNative]::SetForegroundWindow($script:NativeHandle)
        $null = CheckLayout $p
        if ([CuNative]::GetForegroundWindow() -ne $script:NativeHandle) {
          Fail 'focus_changed' 'Use the window switcher to show the selected window.'
        }
      } else { $p = ResolveApp $req.app; RejectBlocked $p; Raise $p }
      $result.app = AppInfo $p
    }
    'windowFrame' { $p = ResolveApp $req.app; RejectBlocked $p; $result.app = AppInfo $p; $result.frame = Rect (RootOf $p) }
    'snapshot' { if ($req.app.kind -eq 'window') { $p = ResolveExact $req } else { $p = ResolveApp $req.app; RejectBlocked $p }; $result.snapshot = Snapshot $p $req.maxNodes $req.rootElementIndex }
    default {
      if ($req.app.kind -eq 'window') { $p = ResolveExact $req } else { $p = ResolveApp $req.app; RejectBlocked $p }
      switch ($req.op) {
        'click' { $result.action = DoClick $p $req }
        'type' { $result.action = DoType $p $req }
        'key' { $result.action = DoKey $p $req }
        'scroll' { $result.action = DoScroll $p $req }
        'drag' { $result.action = DoDrag $p $req }
        'setValue' { $result.action = DoSetValue $p $req }
        'secondaryAction' { $result.action = DoSecondary $p $req }
        'screenshot' { $result.action = DoScreenshot $p $req; return $result }
        default { Fail 'invalid_argument' ('Unknown operation ' + $req.op) }
      }
      if ($null -eq $script:NativeRequest) {
        Start-Sleep -Milliseconds 350
        $result.snapshot = Snapshot $p $req.maxNodes $null
      } else {
        try { $result.snapshot = Snapshot $p $req.maxNodes $null $true } catch {
          # Preserve the action outcome if the target closed or became inaccessible.
        }
      }
    }
  }
  return $result
}

try {
  $request = $env:COMPUTER_USE_REQUEST | ConvertFrom-Json
  Write-Output (ConvertTo-Json (RunRequest $request) -Depth 12 -Compress)
} catch {
  $text = $_.Exception.Message
  if ($text.StartsWith('CU|')) {
    $bits = $text.Split('|', 3)
    Write-Output (ConvertTo-Json @{ ok = $false; code = $bits[1]; message = $bits[2] } -Compress)
  } else {
    Write-Output (ConvertTo-Json @{ ok = $false; code = 'accessibility_error'; message = $text } -Compress)
  }
}

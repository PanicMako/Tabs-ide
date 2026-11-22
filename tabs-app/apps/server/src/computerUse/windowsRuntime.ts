import { BLOCKED_APP_FRAGMENTS, SENSITIVE_LABEL_SOURCE } from "./sensitive.ts";

/**
 * The Windows runtime: PowerShell driving UI Automation (System.Windows.Automation), run with
 * `powershell -Command -` (script on stdin, request in COMPUTER_USE_REQUEST). It follows the
 * design of Orca's native/computer-use-windows/runtime.ps1 (MIT, (c) 2026 Lovecast Inc.) but is a
 * compact rewrite that speaks Tabs' request and response JSON. UI Automation patterns (Invoke,
 * Value, Toggle, Scroll) run without moving the pointer; pointer and key input use user32 and
 * SendKeys and need the window in front. Windows blocks input into elevated windows.
 *
 * Keep this source free of backticks and dollar-brace sequences other than the two
 * interpolations; it lives in a template literal.
 */
export const WINDOWS_RUNTIME = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CuNative {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
}
'@

$SensitivePattern = ${JSON.stringify(SENSITIVE_LABEL_SOURCE)}
$BlockedApps = ${JSON.stringify(BLOCKED_APP_FRAGMENTS)}
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
function RootOf($proc) {
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

function Snapshot($proc, $maxNodes, $rootIndex) {
  $root = RootOf $proc
  $frame = Rect $root
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
  return @{
    id = ([string]$proc.Id + ':' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    app = (AppInfo $proc)
    window = @{ title = $title; key = 'window'; frame = $frame }
    treeText = ($header + [char]10 + [char]10 + ($lines -join [string][char]10) + [char]10 + [char]10 + $footer)
    elementCount = ($end - $start)
    focusedElementIndex = $focused
    truncated = $walked.truncated
  }
}

function NodeAt($proc, $index, $maxNodes) {
  $walked = Walk (RootOf $proc) ([Math]::Max($maxNodes, $index))
  if ($index -lt 1 -or $index -gt $walked.nodes.Count) { Fail 'element_not_found' ('Element ' + $index + ' is not in the current window. Take a fresh snapshot.') }
  return $walked.nodes[$index - 1]
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
  return @{ x = [int]($r.x + $r.width / 2); y = [int]($r.y + $r.height / 2) }
}
function MouseAt($p, $right, $count) {
  [void][CuNative]::SetCursorPos($p.x, $p.y)
  $down = 2; $up = 4
  if ($right) { $down = 8; $up = 16 }
  for ($i = 0; $i -lt $count; $i++) {
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
      if ($Editable -contains $node.type) { $el.SetFocus(); return Done 'accessibility' 'background' ('focused ' + (Render $node $req.target.index $node.depth)) }
    }
  }
  $pt = PointFor $proc $req.target $req.maxNodes
  Raise $proc
  MouseAt $pt $right $req.clickCount
  return Done 'synthetic' 'foreground' 'clicked with the real pointer; the window was raised'
}

function DoType($proc, $req) {
  if ($req.elementIndex -ne $null) { $node = NodeAt $proc $req.elementIndex $req.maxNodes }
  else {
    $walked = Walk (RootOf $proc) $req.maxNodes
    $node = $walked.nodes | Where-Object { $_.focused } | Select-Object -First 1
    if ($node -eq $null) { Fail 'element_not_found' 'No text field has focus in that app. Click a field first, or pass elementIndex.' }
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
function DoKey($proc, $req) {
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
  return Done 'synthetic' 'foreground' ('sent ' + $key.label + ' after raising the window')
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
      for ($i = 0; $i -lt $count; $i++) { $sp.Scroll($h, $v) }
      return Done 'accessibility' 'background' 'scrolled through the scroll pattern'
    }
  }
  $pt = PointFor $proc $req.target $req.maxNodes
  Raise $proc
  [void][CuNative]::SetCursorPos($pt.x, $pt.y)
  if ($req.dy -ne 0) { [CuNative]::mouse_event(0x0800, 0, 0, [int]($req.dy * 120), [UIntPtr]::Zero) }
  if ($req.dx -ne 0) { [CuNative]::mouse_event(0x01000, 0, 0, [int](-$req.dx * 120), [UIntPtr]::Zero) }
  return Done 'synthetic' 'foreground' 'scrolled with the real pointer'
}

function DoDrag($proc, $req) {
  $from = PointFor $proc $req.from $req.maxNodes
  $to = PointFor $proc $req.to $req.maxNodes
  Raise $proc
  [void][CuNative]::SetCursorPos($from.x, $from.y)
  [CuNative]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  for ($i = 1; $i -le 8; $i++) {
    [void][CuNative]::SetCursorPos([int]($from.x + ($to.x - $from.x) * $i / 8), [int]($from.y + ($to.y - $from.y) * $i / 8))
    Start-Sleep -Milliseconds 20
  }
  [CuNative]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  return Done 'synthetic' 'foreground' 'dragged with the real pointer'
}

function DoScreenshot($proc, $req) {
  $f = Rect (RootOf $proc)
  if ($f -eq $null) { Fail 'window_not_found' 'The app has no window to capture.' }
  $bmp = New-Object System.Drawing.Bitmap $f.width, $f.height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($f.x, $f.y, 0, 0, $bmp.Size)
  $bmp.Save([string]$req.path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  return Done 'synthetic' 'background' 'captured the window'
}

function RunRequest($req) {
  $result = @{ ok = $true }
  switch ($req.op) {
    'permissions' { $result.permissions = @{ accessibility = $true; screenRecording = 'granted' } }
    'listApps' { $result.apps = @(ListProcs | ForEach-Object { @{ name = $_.ProcessName; bundleId = $null; pid = $_.Id; active = $false; hidden = $false } }) }
    'focusApp' { $p = ResolveApp $req.app; RejectBlocked $p; Raise $p; $result.app = AppInfo $p }
    'windowFrame' { $p = ResolveApp $req.app; RejectBlocked $p; $result.app = AppInfo $p; $result.frame = Rect (RootOf $p) }
    'snapshot' { $p = ResolveApp $req.app; RejectBlocked $p; $result.snapshot = Snapshot $p $req.maxNodes $req.rootElementIndex }
    default {
      $p = ResolveApp $req.app
      RejectBlocked $p
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
      Start-Sleep -Milliseconds 350
      $result.snapshot = Snapshot $p $req.maxNodes $null
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
`;

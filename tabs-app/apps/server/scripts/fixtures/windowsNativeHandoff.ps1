# Run in a non-elevated Windows desktop PowerShell session from tabs-app.
# powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\apps\server\scripts\fixtures\windowsNativeHandoff.ps1
# Add -SecondMonitor to move to another extended display. Use different Windows scale settings to exercise mixed DPI.
# Add -Reveal to test foreground input against overlays and a switch to a sibling window.
# Add -Capture to verify a window PNG and refusal for display affinity and native password controls.
[CmdletBinding()]
param([switch]$Fixture, [switch]$Reveal, [switch]$SecondMonitor, [switch]$Capture)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HandoffFixtureWindows {
  [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr window, uint affinity);

  public static bool Place(IntPtr window, int fixturePid, int x, int y, bool topmost) {
    int owner;
    if (GetWindowThreadProcessId(window, out owner) == 0 || owner != fixturePid) return false;
    // SWP_NOSIZE | SWP_NOACTIVATE, plus SWP_NOZORDER for a move without covering.
    return SetWindowPos(window, new IntPtr(-1), x, y, 0, 0, topmost ? 0x11u : 0x15u);
  }

  public static IntPtr HitRoot(int x, int y) {
    return GetAncestor(WindowFromPoint(new Point { X = x, Y = y }), 2);
  }
}
'@

if ([HandoffFixtureWindows]::SetThreadDpiAwarenessContext([IntPtr](-4)) -eq [IntPtr]::Zero) {
  throw 'The fixture requires per-monitor DPI awareness on Windows.'
}
if ($Fixture) {
  [AppContext]::SetSwitch('Switch.System.Windows.DoNotScaleForDpiChanges', $false)
  Add-Type -AssemblyName PresentationFramework
  $app = New-Object Windows.Application
  foreach ($left in 40, 390) {
    $window = New-Object Windows.Window
    $window.Title = 'Tabs native handoff fixture'
    $window.Left = $left
    $window.Top = 70
    $window.Width = 300
    $window.Height = 160
    $window.WindowStartupLocation = 'Manual'
    $window.ShowActivated = $false
    $button = New-Object Windows.Controls.Button
    $button.Tag = 0
    $button.Content = 'Save test item (clicks: 0)'
    $button.Add_Click({
      param($sender, $eventArgs)
      $sender.Tag = 1 + [int]$sender.Tag
      $sender.Content = "Save test item (clicks: $($sender.Tag))"
    })
    $grid = New-Object Windows.Controls.Grid
    [void]$grid.Children.Add($button)
    if ($left -eq 40) {
      $cover = New-Object Windows.Controls.Button
      $cover.Content = 'Cover selected control'
      $cover.Width = 160
      $cover.Height = 60
      $cover.Add_Click({
        param($sender, $eventArgs)
        $sender.Tag = 1 + [int]$sender.Tag
        $sender.Content = "Cover clicks: $($sender.Tag)"
      })
      [void]$grid.Children.Add($cover)
      if ($Reveal) {
        $switchFocus = New-Object Windows.Controls.Button
        $switchFocus.Content = 'Switch to sibling'
        $switchFocus.HorizontalAlignment = 'Right'
        $switchFocus.VerticalAlignment = 'Top'
        $switchFocus.Add_Click({
          param($sender, $eventArgs)
          $current = [Windows.Window]::GetWindow($sender)
          foreach ($sibling in [Windows.Application]::Current.Windows) {
            if ($sibling -ne $current) { [void]$sibling.Activate(); break }
          }
        })
        [void]$grid.Children.Add($switchFocus)
      }
    } elseif ($Capture) {
      $protected = New-Object Windows.Controls.PasswordBox
      $protected.Width = 160
      $protected.Height = 26
      $protected.VerticalAlignment = 'Bottom'
      $protected.Password = 'fixture-only-password'
      [Windows.Automation.AutomationProperties]::SetName($protected, 'Fixture password field')
      [void]$grid.Children.Add($protected)
    }
    $window.Content = $grid
    $window.Show()
  }
  if ($Capture) {
    # A layered top-level window lets another process query display affinity.
    Add-Type -AssemblyName System.Windows.Forms
    $affinityWindow = New-Object System.Windows.Forms.Form
    $affinityWindow.Text = 'Tabs display affinity fixture'
    $affinityWindow.StartPosition = 'Manual'
    $affinityWindow.Left = 40
    $affinityWindow.Top = 300
    $affinityWindow.Width = 300
    $affinityWindow.Height = 120
    $affinityWindow.Opacity = 0.99
    $affinityWindow.Show()
    if (![HandoffFixtureWindows]::SetWindowDisplayAffinity($affinityWindow.Handle, 1)) {
      throw 'Windows did not apply display affinity to the layered fixture window.'
    }
  }
  [void]$app.Run()
  exit
}

$runtime = (Resolve-Path (Join-Path $PSScriptRoot '..\..\src\computerUse\windowsRuntime.ps1')).Path
$engine = (Get-Command powershell.exe).Source
Add-Type -AssemblyName System.Windows.Forms
if ($SecondMonitor -and [System.Windows.Forms.Screen]::AllScreens.Count -lt 2) {
  throw '-SecondMonitor requires two active extended displays. Select Extend in Windows Display settings, or rerun without -SecondMonitor.'
}

function Invoke-NativeFixtureRequest($request) {
  $prior = $env:COMPUTER_USE_REQUEST
  try {
    $env:COMPUTER_USE_REQUEST = ConvertTo-Json $request -Depth 12 -Compress
    $response = & $engine -NoLogo -NoProfile -NonInteractive -File $runtime
    if ($LASTEXITCODE -ne 0) { throw 'Unable to run the Windows native runtime.' }
    return ($response | ConvertFrom-Json)
  } finally { $env:COMPUTER_USE_REQUEST = $prior }
}

function Read-FixtureWindow($window) {
  $read = Invoke-NativeFixtureRequest @{ op='snapshot'; app=@{kind='window'; id=$window.id}; native=@{foreground=$false}; maxNodes=80 }
  if (!$read.ok -or $read.snapshot.window.key -ne $window.id) {
    throw ('Exact window snapshot failed: ' + $read.code + ' ' + $read.message)
  }
  return $read.snapshot
}

function Read-FixtureSaveCount($window) {
  $snapshot = Read-FixtureWindow $window
  $match = [regex]::Match($snapshot.treeText, '(?m)^[\t ]*\d+ Button "Save test item \(clicks: ([0-9]+)\)"')
  if (!$match.Success) { throw 'Save button click count missing from the fixture window.' }
  return [int]$match.Groups[1].Value
}

function New-FixtureClick($snapshot, $label = 'Save test item (clicks: 0)') {
  $match = [regex]::Match($snapshot.treeText, ('(?m)^\s*(\d+) Button "' + [regex]::Escape($label) + '"'))
  if (!$match.Success) { throw 'Button missing from the fixture.' }
  $index = [int]$match.Groups[1].Value
  $elements = @{}
  $elements[[string]$index] = $snapshot.elements[$index - 1]
  return @{
    op='click'; app=@{kind='window'; id=$snapshot.window.key}; maxNodes=80
    native=@{foreground=$false; frame=$snapshot.window.frame; scale=$snapshot.scale; display=$snapshot.display; elements=$elements}
    target=@{kind='element'; index=$index}; button='left'; clickCount=1
  }
}

function Assert-FixtureRejection($request, $code, $scenario) {
  $reply = Invoke-NativeFixtureRequest $request
  if ($reply.ok -or $reply.code -ne $code) {
    throw ("${scenario}: expected ${code}, got " + (ConvertTo-Json $reply -Depth 12 -Compress))
  }
}

function Show-FixtureWindow($window, $handle) {
  $opened = Invoke-NativeFixtureRequest @{op='focusApp'; app=@{kind='window'; id=$window.id}}
  if (!$opened.ok -and $opened.code -ne 'focus_changed') {
    throw ('Windows declined to show the selected fixture window: ' + $opened.code + ' ' + $opened.message)
  }
  if ([HandoffFixtureWindows]::GetForegroundWindow() -eq $handle) { return }

  [Console]::Error.WriteLine('Click the title bar of the fixture window with the Cover selected control button within 30 seconds.')
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 200
    if ([HandoffFixtureWindows]::GetForegroundWindow() -eq $handle) { return }
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'The selected fixture window did not receive focus. Rerun -Reveal and click its title bar when prompted.'
}

function Test-FixtureCapture($selectedWindow, $siblingWindow, $affinityWindow) {
  $clear = Read-FixtureWindow $selectedWindow
  $protected = Read-FixtureWindow $siblingWindow
  Add-Type -AssemblyName System.Drawing
  $folder = Join-Path ([IO.Path]::GetTempPath()) ('tabs-window-capture-' + [guid]::NewGuid().ToString())
  [void][IO.Directory]::CreateDirectory($folder)
  try {
    $request = @{
      op='screenshot'; app=@{kind='window'; id=$clear.window.key}; path=(Join-Path $folder 'clear.png')
      native=@{foreground=$false; frame=$clear.window.frame; scale=$clear.scale; display=$clear.display}
    }
    $reply = Invoke-NativeFixtureRequest $request
    if (!$reply.ok -or $reply.action.delivery -ne 'background' -or !(Test-Path -LiteralPath $request.path)) {
      throw ('Scoped capture failed: ' + $reply.code + ' ' + $reply.message)
    }
    $image = [System.Drawing.Image]::FromFile($request.path)
    try {
      if ($image.RawFormat.Guid -ne [System.Drawing.Imaging.ImageFormat]::Png.Guid -or
          $image.Width -ne $clear.window.frame.width -or $image.Height -ne $clear.window.frame.height) {
        throw 'The captured frame is not the expected window-sized PNG.'
      }
    } finally { $image.Dispose() }

    $affinity = Read-FixtureWindow $affinityWindow
    $request.app.id = $affinity.window.key
    $request.path = Join-Path $folder 'display-affinity.png'
    $request.native = @{foreground=$false; frame=$affinity.window.frame; scale=$affinity.scale; display=$affinity.display}
    Assert-FixtureRejection $request 'permission_denied' 'Capture of a window protected by display affinity'
    if (Test-Path -LiteralPath $request.path) { throw 'Display-protected capture produced a file.' }

    if ($protected.treeText -notmatch 'Edit "Fixture password field" \(secure\)' -or
        $protected.treeText -match 'fixture-only-password') {
      throw 'UI Automation did not redact the fixture password field.'
    }
    $request.app.id = $protected.window.key
    $request.path = Join-Path $folder 'protected.png'
    $request.native = @{foreground=$false; frame=$protected.window.frame; scale=$protected.scale; display=$protected.display}
    Assert-FixtureRejection $request 'sensitive_field' 'Capture of a window with a password field'
    if (Test-Path -LiteralPath $request.path) { throw 'Protected window capture produced a file.' }
  } finally { Remove-Item -LiteralPath $folder -Recurse -Force }
}

$priorBlockedApps = $env:TABS_COMPUTER_USE_BLOCKED_APPS
$priorSensitivePattern = $env:TABS_COMPUTER_USE_SENSITIVE_PATTERN
$fixtureArgs = @(
  '-NoLogo', '-NoProfile', '-STA', '-File', ('"' + $PSCommandPath + '"'), '-Fixture'
)
if ($Capture) { $fixtureArgs += '-Capture' }
if ($Reveal) { $fixtureArgs += '-Reveal' }
$process = Start-Process $engine -ArgumentList $fixtureArgs -WindowStyle Hidden -PassThru
try {
  # The application normally supplies these settings when it starts the runtime.
  if (!$priorBlockedApps) { $env:TABS_COMPUTER_USE_BLOCKED_APPS = '["1password"]' }
  if (!$priorSensitivePattern) { $env:TABS_COMPUTER_USE_SENSITIVE_PATTERN = '(?!)' }
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $list = (Invoke-NativeFixtureRequest @{ op = 'listWindows' }).windows
    $windows = @($list | Where-Object { $_.pid -eq $process.Id -and $_.title -eq 'Tabs native handoff fixture' } | Sort-Object { $_.frame.x })
    if ($Capture) {
      $affinity = $list | Where-Object { $_.pid -eq $process.Id -and $_.title -eq 'Tabs display affinity fixture' } | Select-Object -First 1
    }
    if ($windows.Count -eq 2 -and (!$Capture -or $affinity)) { break }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline -and !$process.HasExited)
  if ($windows.Count -ne 2 -or $windows[0].id -eq $windows[1].id) { throw 'Expected two distinct accessible fixture windows.' }
  if ($Capture -and !$affinity) { throw 'The display affinity fixture window did not open.' }

  $selectedHandle = [IntPtr]([long]($windows[0].id.Split(':')[2]))
  $siblingHandle = [IntPtr]([long]($windows[1].id.Split(':')[2]))
  if ($Capture) { Test-FixtureCapture $windows[0] $windows[1] $affinity }
  $selected = Read-FixtureWindow $windows[0]
  $request = New-FixtureClick $selected
  $request.native.scale = $selected.scale + 1
  Assert-FixtureRejection $request 'stale_observation' 'Simulated scale change'
  $request.native.scale = $selected.scale
  $request.controlFile = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
  Assert-FixtureRejection $request 'user_turn' 'Takeover'
  $request.Remove('controlFile')

  $screen = [System.Windows.Forms.Screen]::FromHandle($selectedHandle)
  $destination = $screen
  if ($SecondMonitor) {
    $destination = [System.Windows.Forms.Screen]::AllScreens |
      Where-Object { $_.DeviceName -ne $screen.DeviceName } | Select-Object -First 1
    if (!$destination) { throw 'The second extended display is unavailable. Check Windows Display settings and rerun -SecondMonitor.' }
  }
  $area = $destination.WorkingArea
  $x = $area.Left + [int]($area.Width / 4)
  $y = $area.Top + [int]($area.Height / 4)
  if (![HandoffFixtureWindows]::Place($selectedHandle, $process.Id, $x, $y, $false)) {
    throw 'Could not move the selected fixture window.'
  }
  Assert-FixtureRejection $request 'stale_observation' 'Real window move'

  $moved = Read-FixtureWindow $windows[0]
  $displayChanged = $selected.display -ne $moved.display
  $actualDestination = [System.Windows.Forms.Screen]::FromHandle($selectedHandle)
  if (($moved.window.frame.x -eq $selected.window.frame.x -and $moved.window.frame.y -eq $selected.window.frame.y) -or
      $actualDestination.DeviceName -ne $destination.DeviceName -or $displayChanged -ne $SecondMonitor.IsPresent) {
    throw 'The selected fixture did not move to the expected display and position.'
  }
  $mixedDpi = $displayChanged -and $selected.scale -ne $moved.scale
  $mixedDpiNote = $null
  if ($SecondMonitor -and !$mixedDpi) {
    $mixedDpiNote = 'Both fixture observations reported the same scale. Set different scaling values on these displays in Windows Display settings and rerun -SecondMonitor.'
  }
  $staleIndex = [string]$request.target.index
  $staleToken = $request.native.elements[$staleIndex]
  $request = New-FixtureClick $moved
  $index = [string]$request.target.index
  $freshToken = $request.native.elements[$index]
  if ($index -ne $staleIndex -or !$staleToken -or !$freshToken -or $freshToken -ceq $staleToken) {
    throw 'Expected updated bounds for the observed button at the same accessibility index.'
  }
  # Use the current layout so that only the old accessibility reference can fail.
  $request.native.elements[$index] = $staleToken
  Assert-FixtureRejection $request 'stale_observation' 'Stale accessibility reference after move'
  $request.native.elements[$index] = $freshToken
  if ($mixedDpi) {
    # Keep the destination frame, display, and element token current to isolate the pre-move scale.
    $request.native.scale = $selected.scale
    Assert-FixtureRejection $request 'stale_observation' 'Stale scale after moving to a differently scaled display'
    $request.native.scale = $moved.scale
  }

  # Use the current accessibility bounds to cover the exact point used by a physical click.
  $buttonBounds = ConvertFrom-Json $freshToken
  $buttonX = [int]($buttonBounds[3] + $buttonBounds[5] / 2)
  $buttonY = [int]($buttonBounds[4] + $buttonBounds[6] / 2)
  if ($Reveal) { Show-FixtureWindow $windows[0] $selectedHandle }
  if (![HandoffFixtureWindows]::Place($siblingHandle, $process.Id, ($buttonX - 40), ($buttonY - 40), $true)) {
    throw 'Could not place the sibling fixture over the selected button.'
  }
  if ($Reveal) {
    if ([HandoffFixtureWindows]::HitRoot($buttonX, $buttonY) -ne $siblingHandle) {
      throw 'The sibling fixture did not cover the selected button.'
    }
    $request.foreground = $true
    $request.native.foreground = $true
    Assert-FixtureRejection $request 'target_occluded' 'Physical click on covered fixture button'
    $request.foreground = $false
    $request.native.foreground = $false
  }
  if ((Read-FixtureSaveCount $windows[0]) -ne 0 -or (Read-FixtureSaveCount $windows[1]) -ne 0) {
    throw 'A rejected request changed a fixture window.'
  }
  if ([HandoffFixtureWindows]::HitRoot($buttonX, $buttonY) -ne $siblingHandle) {
    throw 'The sibling fixture did not cover the selected button.'
  }
  $foregroundBeforeBackgroundClick = [HandoffFixtureWindows]::GetForegroundWindow()
  $result = Invoke-NativeFixtureRequest $request
  if (!$result.ok -or $result.action.path -ne 'accessibility' -or $result.action.delivery -ne 'background') {
    throw ('Background accessibility click failed: ' + $result.code + ' ' + $result.message)
  }
  if ([HandoffFixtureWindows]::GetForegroundWindow() -ne $foregroundBeforeBackgroundClick) {
    throw 'Foreground focus changed during the background click check.'
  }
  if ($Reveal) {
    if (![HandoffFixtureWindows]::Place($siblingHandle, $process.Id, ($buttonX + 150), ($buttonY + 80), $false) -or
        [HandoffFixtureWindows]::HitRoot($buttonX, $buttonY) -ne $selectedHandle) {
      throw 'The selected fixture must be topmost at the button.'
    }
    $snapshot = Read-FixtureWindow $windows[0]
    $covered = New-FixtureClick $snapshot 'Save test item (clicks: 1)'
    $covered.foreground = $true
    $covered.native.foreground = $true
    Assert-FixtureRejection $covered 'target_occluded' 'Physical click on a control covered inside its window'
    $snapshot = Read-FixtureWindow $windows[0]
    if ($snapshot.treeText -notmatch 'Button "Cover selected control"') {
      throw 'The rejected input hit the covering control.'
    }
    $visible = New-FixtureClick $snapshot 'Cover selected control'
    $visible.foreground = $true
    $visible.native.foreground = $true
    $clicked = Invoke-NativeFixtureRequest $visible
    $snapshot = Read-FixtureWindow $windows[0]
    if (!$clicked.ok -or $clicked.action.delivery -ne 'foreground' -or
        $snapshot.treeText -notmatch 'Button "Cover clicks: 1"') {
      throw 'The visible covering control did not receive the approved physical click.'
    }
    $staleFocus = New-FixtureClick $snapshot 'Cover clicks: 1'
    $staleFocus.foreground = $true
    $staleFocus.native.foreground = $true
    $switched = Invoke-NativeFixtureRequest (New-FixtureClick $snapshot 'Switch to sibling')
    if (!$switched.ok -or [HandoffFixtureWindows]::GetForegroundWindow() -ne $siblingHandle -or
        [HandoffFixtureWindows]::HitRoot($buttonX, $buttonY) -ne $selectedHandle) {
      throw 'The sibling must have focus while the selected fixture button remains visible.'
    }
    Assert-FixtureRejection $staleFocus 'focus_changed' 'Physical click after a foreground switch'
    if ((Read-FixtureWindow $windows[0]).treeText -notmatch 'Button "Cover clicks: 1"' -or
        [HandoffFixtureWindows]::GetForegroundWindow() -ne $siblingHandle) {
      throw 'A rejected click changed a fixture window or took focus.'
    }
  }
  $correctEffects = Read-FixtureSaveCount $windows[0]
  $wrongTargetEffects = Read-FixtureSaveCount $windows[1]
  if ($correctEffects -ne 1 -or $wrongTargetEffects -ne 0) {
    throw "Expected one selected-window save click and zero sibling-window save clicks. Observed $correctEffects and $wrongTargetEffects."
  }
  [pscustomobject]@{
    windows=(2 + [int]$Capture.IsPresent); correctEffects=$correctEffects; wrongTargetEffects=$wrongTargetEffects; delivery=$result.action.delivery
    fromDisplay=$selected.display; toDisplay=$moved.display; displayChanged=$displayChanged
    fromDisplayName=$screen.DeviceName; toDisplayName=$actualDestination.DeviceName
    fromScale=$selected.scale; scale=$moved.scale; mixedDpi=$mixedDpi; mixedDpiNote=$mixedDpiNote
    stalePriorScaleRejected=$mixedDpi; backgroundFocusPreserved=$true
    staleGeometryRejected=$true; staleElementRejected=$true; covered=$true; occludedInputRejected=$Reveal.IsPresent
    sameWindowOverlayRejected=$Reveal.IsPresent; foregroundClickVerified=$Reveal.IsPresent
    focusChangeRejected=$Reveal.IsPresent
    scopedCaptureVerified=$Capture.IsPresent; protectedCaptureRefused=$Capture.IsPresent
    displayAffinityCaptureRefused=$Capture.IsPresent
  } | ConvertTo-Json
} finally {
  $env:TABS_COMPUTER_USE_BLOCKED_APPS = $priorBlockedApps
  $env:TABS_COMPUTER_USE_SENSITIVE_PATTERN = $priorSensitivePattern
  if (!$process.HasExited) { $process.Kill(); $process.WaitForExit() }
  $process.Dispose()
}

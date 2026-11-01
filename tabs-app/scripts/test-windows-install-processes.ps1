$ErrorActionPreference = "Stop"
$root = Join-Path $env:RUNNER_TEMP "TabsProcessCheck-$([guid]::NewGuid().ToString('N'))"
$installDir = Join-Path $root "installed"
$otherDir = Join-Path $root "other"
New-Item $installDir, $otherDir -ItemType Directory -Force | Out-Null
$inside = $null
$outside = $null
$tempRecord = Join-Path $root 'temp-drive.txt'
$sameVolumeRoot = Join-Path $env:LOCALAPPDATA "Tabs UninstallTempCheck-$([char]0x00DF)-$([guid]::NewGuid().ToString('N'))"
$tempDrive = $null
$junctionPath = $null

try {
  $insideExe = Join-Path $installDir "TabsProcessCheck.exe"
  $outsideExe = Join-Path $otherDir "OtherProcessCheck.exe"
  Copy-Item "$env:WINDIR\System32\cmd.exe" $insideExe
  Copy-Item "$env:WINDIR\System32\cmd.exe" $outsideExe
  $inside = Start-Process $insideExe -ArgumentList '/c ping -t 127.0.0.1' -WindowStyle Hidden -PassThru
  $outside = Start-Process $outsideExe -ArgumentList '/c ping -t 127.0.0.1' -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 2
  $inside.Refresh()
  $outside.Refresh()
  if ($inside.HasExited -or $outside.HasExited) { throw "Test processes did not start." }

  & "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File "$PSScriptRoot/close-windows-install-processes.ps1" $installDir
  if ($LASTEXITCODE -ne 0) { throw "Process closer exited with $LASTEXITCODE." }
  $inside.Refresh()
  $outside.Refresh()
  if (-not $inside.HasExited) { throw "Process closer left the in-installation process running." }
  if ($outside.HasExited) { throw "Process closer killed a process outside the installation." }
  Write-Host "Windows installation process closer passed."

  $sameVolumeInstall = Join-Path $sameVolumeRoot 'installed'
  New-Item $sameVolumeInstall -ItemType Directory -Force | Out-Null
  New-Item (Join-Path $sameVolumeInstall 'Uninstall Tabs.exe') -ItemType File | Out-Null
  & "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File "$PSScriptRoot/close-windows-install-processes.ps1" $sameVolumeInstall -TempDriveOutputPath $tempRecord
  if ($LASTEXITCODE -ne 0) { throw "Private uninstaller temp preparation failed." }
  $record = @(Get-Content -LiteralPath $tempRecord -Encoding UTF8)
  $tempDrive = $record[0].Substring(0, 2)
  $scope = $record[1]
  if ([IO.Path]::GetDirectoryName($scope) -ne $sameVolumeRoot) { throw 'Uninstaller temp is not beside the installation.' }
  $oldContent = Join-Path $sameVolumeInstall 'old-content'
  New-Item $oldContent -ItemType Directory | Out-Null
  Set-Content (Join-Path $oldContent 'marker.txt') 'old application content'
  Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class TabsUninstallRenameTest {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool MoveFile(string source, string destination);
}
'@
  # Use the same native rename as NSIS, without any cross-drive copy fallback.
  if (-not [TabsUninstallRenameTest]::MoveFile($oldContent, "$tempDrive\old-content")) {
    throw "Same-volume native rename failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  if (-not (Test-Path "$tempDrive\old-content\marker.txt")) { throw 'Same-volume uninstaller rename failed.' }

  $outsideMarker = Join-Path $otherDir 'preserved.txt'
  Set-Content $outsideMarker 'preserve outside the private cleanup scope'
  $junctionPath = Join-Path $scope 'outside-junction'
  New-Item $junctionPath -ItemType Junction -Target $otherDir | Out-Null
  & "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File "$PSScriptRoot/close-windows-install-processes.ps1" $sameVolumeInstall -CleanupTempDrive $tempDrive -TempDriveOutputPath $tempRecord
  if ($LASTEXITCODE -ne 0) { throw 'Private uninstaller temp cleanup failed.' }
  $tempDrive = $null
  if (Test-Path -LiteralPath $scope) { throw 'Private uninstaller temp was not removed.' }
  if (-not (Test-Path -LiteralPath $outsideMarker)) { throw 'Private temp cleanup followed a junction outside its scope.' }
  Write-Host 'Same-volume uninstaller staging and junction-safe cleanup passed.'

  $stage = Join-Path $sameVolumeRoot 'staged app'
  foreach ($relative in @(
    'resources/app.asar',
    'resources/tabs-code-oss/out/vs/code/electron-browser/workbench/workbench-dev.html',
    'resources/tabs-code-oss/out/nls.messages.json', 'resources/tabs-code-oss/out-build/nls.messages.json',
    'resources/tabs-code-oss/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
    'resources/tabs-code-oss/extensions/node_modules/typescript/lib/typescript.js',
    'resources/tabs-code-oss/extensions/node_modules/typescript/lib/lib.d.ts',
    'resources/tabs-code-oss/extensions/node_modules/typescript/lib/lib.es5.d.ts',
    'resources/tabs-code-oss/extensions/node_modules/typescript/lib/lib.dom.d.ts'
  )) {
    $filename = Join-Path $stage $relative
    New-Item (Split-Path -Parent $filename) -ItemType Directory -Force | Out-Null
    Set-Content -LiteralPath $filename 'runtime fixture'
  }
  Copy-Item (Get-Command node.exe).Source (Join-Path $stage 'Tabs.exe')
  $validator = Join-Path $root 'validator with spaces'
  New-Item $validator -ItemType Directory | Out-Null
  Copy-Item "$PSScriptRoot/verify-staged-runtime.ps1" $validator
  Copy-Item "$PSScriptRoot/lib/windows-packed-inventory.cjs" $validator
  $runtime = Join-Path $stage 'resources/tabs-code-oss'
  Set-Content (Join-Path $runtime 'tabs-payload.json') '{}'
  & node -e 'require(process.argv[1]).writeWindowsPackedInventory(process.argv[2])' (Join-Path $validator 'windows-packed-inventory.cjs') $runtime
  if ($LASTEXITCODE -ne 0) { throw 'Could not create staged runtime test inventory.' }
  $originalRunAsNode = $env:ELECTRON_RUN_AS_NODE
  & "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $validator 'verify-staged-runtime.ps1') $stage
  if ($LASTEXITCODE -ne 0) { throw 'Bundled Node staged verification failed.' }
  if ($env:ELECTRON_RUN_AS_NODE -ne $originalRunAsNode) { throw 'Verification leaked Node mode into the parent environment.' }
  Remove-Item (Join-Path $stage 'resources/app.asar')
  & "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $validator 'verify-staged-runtime.ps1') $stage
  if ($LASTEXITCODE -ne 2) { throw 'Staged verification accepted an incomplete app.' }
  Write-Host 'Bundled Node validation preserves the parent environment and rejects incomplete payloads.'
} finally {
  if ($tempDrive) { & subst.exe $tempDrive /D | Out-Null }
  foreach ($process in @($inside, $outside)) {
    if ($process -and -not $process.HasExited) {
      & taskkill.exe /F /T /PID $process.Id 2>$null | Out-Null
    }
  }
  if ($junctionPath -and (Get-Item -LiteralPath $junctionPath -Force -ErrorAction SilentlyContinue)) {
    [IO.Directory]::Delete($junctionPath)
  }
  if (Test-Path -LiteralPath $sameVolumeRoot) {
    Remove-Item $sameVolumeRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}

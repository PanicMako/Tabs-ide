$ErrorActionPreference = "Stop"
$root = Join-Path $env:RUNNER_TEMP "TabsProcessCheck-$([guid]::NewGuid().ToString('N'))"
$installDir = Join-Path $root "installed"
$otherDir = Join-Path $root "other"
New-Item $installDir, $otherDir -ItemType Directory -Force | Out-Null
$inside = $null
$outside = $null

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
} finally {
  foreach ($process in @($inside, $outside)) {
    if ($process -and -not $process.HasExited) {
      & taskkill.exe /F /T /PID $process.Id 2>$null | Out-Null
    }
  }
  Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}

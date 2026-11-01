param([Parameter(Mandatory)] [string]$StageDir)
$ErrorActionPreference = 'Stop'
$process = New-Object Diagnostics.Process
$started = $false
try {
  # Use the bundled Node runtime and the build's own inventory reader. This
  # handles long paths and short/long path aliases consistently on Windows.
  $process.StartInfo.FileName = Join-Path $StageDir 'Tabs.exe'
  $script = Join-Path $PSScriptRoot 'windows-packed-inventory.cjs'
  $process.StartInfo.Arguments = "`"$script`" `"$StageDir`""
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.CreateNoWindow = $true
  $process.StartInfo.RedirectStandardOutput = $true
  $process.StartInfo.RedirectStandardError = $true
  # Change only the child's environment; the installer and relaunched app
  # must retain normal Electron startup behavior.
  $process.StartInfo.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
  $started = $process.Start()
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(45000)) {
    $process.Kill()
    $process.WaitForExit()
    throw 'Staged runtime verification timed out.'
  }
  $output = $stdout.GetAwaiter().GetResult()
  $errors = $stderr.GetAwaiter().GetResult()
  if ($process.ExitCode -ne 0) { throw "Bundled Node verification failed: $errors $output" }
  Write-Output $output.Trim()
  if ($env:TABS_INSTALLER_PHASE_LOG) {
    [IO.File]::AppendAllText($env:TABS_INSTALLER_PHASE_LOG, "$($output.Trim())`r`n", [Text.UTF8Encoding]::new($false))
  }
  exit 0
} catch {
  $message = "Staged application validation failed: $_"
  Write-Output $message
  if ($env:TABS_INSTALLER_PHASE_LOG) {
    [IO.File]::AppendAllText($env:TABS_INSTALLER_PHASE_LOG, "$message`r`n", [Text.UTF8Encoding]::new($false))
  }
  exit 2
} finally {
  if ($started -and -not $process.HasExited) { $process.Kill() }
  $process.Dispose()
}

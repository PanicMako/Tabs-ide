param(
  [Parameter(Mandatory)] [string]$InstallDir,
  [string]$TempDriveOutputPath,
  [string]$CleanupTempDrive
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\') + '\'
$logPath = $env:TABS_INSTALLER_PROCESS_LOG
$mappedDrive = $null

function Write-ProcessLog([string]$Message) {
  Write-Output $Message
  if ($logPath) {
    Add-Content -LiteralPath $logPath -Value $Message
  }
}

try {
  if ($CleanupTempDrive) {
    & subst.exe $CleanupTempDrive /D | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not remove temporary drive $CleanupTempDrive." }
    Write-ProcessLog "Removed temporary drive $CleanupTempDrive"
    exit 0
  }

  Write-ProcessLog "Checking processes under $root"
  for ($attempt = 1; $attempt -le 10; $attempt++) {
    $running = @(Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($running.Count -eq 0) {
      Write-ProcessLog "No processes remain under $root"
      if ($TempDriveOutputPath -and (Test-Path (Join-Path $root 'Uninstall Tabs.exe'))) {
        $tempTarget = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
        foreach ($letter in @('Z', 'Y', 'X', 'W', 'V', 'U', 'T', 'S', 'R', 'Q', 'P')) {
          $drive = "${letter}:"
          if (Test-Path "${drive}\") { continue }
          & subst.exe $drive $tempTarget | Out-Null
          if ($LASTEXITCODE -eq 0 -and (Test-Path "${drive}\")) {
            $mappedDrive = $drive
            Set-Content -LiteralPath $TempDriveOutputPath -Value "${drive}\" -Encoding Ascii -NoNewline
            Write-ProcessLog "Mapped private temp directory to $drive for old NSIS uninstaller"
            break
          }
        }
        if (-not $mappedDrive) { throw "Could not map a short temporary drive for the old NSIS uninstaller." }
      }
      exit 0
    }

    foreach ($item in $running) {
      Write-ProcessLog "Closing $($item.Name) (PID $($item.ProcessId)) from $root"
      & taskkill.exe /F /T /PID $item.ProcessId
    }
    Start-Sleep -Milliseconds 500
  }

  Write-Error "Processes remain inside $root after ten attempts."
  exit 1
} catch {
  if ($mappedDrive) { & subst.exe $mappedDrive /D | Out-Null }
  Write-ProcessLog "Process check failed: $_"
  exit 2
}

param(
  [Parameter(Mandatory)] [string]$InstallDir,
  [string]$TempDriveOutputPath,
  [string]$CleanupTempDrive
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\') + '\'
$logPath = $env:TABS_INSTALLER_PROCESS_LOG
$mappedDrive = $null
$tempScope = $null

function Remove-OwnedTempScope([string]$Path) {
  # Windows PowerShell's recursive removal can traverse directory junctions.
  # Unlink reparse points themselves; never walk into their targets.
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    if ($item.PSIsContainer) { [IO.Directory]::Delete($item.FullName) }
    else { [IO.File]::Delete($item.FullName) }
    return
  }
  if ($item.PSIsContainer) {
    foreach ($child in @(Get-ChildItem -LiteralPath $Path -Force)) {
      Remove-OwnedTempScope $child.FullName
    }
    [IO.Directory]::Delete($item.FullName)
  } else {
    $item.IsReadOnly = $false
    [IO.File]::Delete($item.FullName)
  }
}

function Write-ProcessLog([string]$Message) {
  Write-Output $Message
  if ($logPath) {
    Add-Content -LiteralPath $logPath -Value $Message
  }
}

try {
  if ($CleanupTempDrive) {
    if ($CleanupTempDrive -notmatch '^[P-Z]:$' -or -not $TempDriveOutputPath) {
      throw 'Missing private temporary-drive ownership record.'
    }
    $record = @(Get-Content -LiteralPath $TempDriveOutputPath -Encoding UTF8)
    if ($record.Count -ne 2 -or $record[0] -ne "$CleanupTempDrive\") {
      throw 'Invalid private temporary-drive ownership record.'
    }
    $scope = [IO.Path]::GetFullPath($record[1])
    $parent = [IO.Path]::GetDirectoryName($root.TrimEnd('\'))
    if ([IO.Path]::GetDirectoryName($scope) -ne $parent -or
        [IO.Path]::GetFileName($scope) -notmatch '^\.tabs-uninstall-[a-f0-9]{32}$') {
      throw 'Temporary cleanup path is outside the owned installation scope.'
    }
    $marker = Join-Path $scope '.tabs-uninstall-scope'
    if ((Get-Item -LiteralPath $scope -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw 'Temporary cleanup scope was replaced with a reparse point.'
    }
    if ([IO.File]::ReadAllText($marker) -ne $scope -or
        [IO.File]::ReadAllText("$CleanupTempDrive\.tabs-uninstall-scope") -ne $scope) {
      throw 'Temporary drive no longer belongs to this installation.'
    }
    & subst.exe $CleanupTempDrive /D | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not remove temporary drive $CleanupTempDrive." }
    Remove-OwnedTempScope $scope
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
        # The legacy NSIS uninstaller atomically renames old files into its
        # plugin directory. TEMP must therefore be on the installation volume,
        # even when the user's normal TEMP lives on another disk.
        $parent = [IO.Path]::GetDirectoryName($root.TrimEnd('\'))
        $tempScope = Join-Path $parent ".tabs-uninstall-$([guid]::NewGuid().ToString('N'))"
        New-Item -Path $tempScope -ItemType Directory -ErrorAction Stop | Out-Null
        $security = New-Object Security.AccessControl.DirectorySecurity
        $security.SetAccessRuleProtection($true, $false)
        $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
        foreach ($sid in @($owner, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
          $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
          $security.AddAccessRule($rule)
        }
        [IO.Directory]::SetAccessControl($tempScope, $security)
        [IO.File]::WriteAllText((Join-Path $tempScope '.tabs-uninstall-scope'), $tempScope)
        foreach ($letter in @('Z', 'Y', 'X', 'W', 'V', 'U', 'T', 'S', 'R', 'Q', 'P')) {
          $drive = "${letter}:"
          if (Test-Path "${drive}\") { continue }
          & subst.exe $drive $tempScope | Out-Null
          if ($LASTEXITCODE -eq 0 -and (Test-Path "${drive}\")) {
            $mappedDrive = $drive
            # The first line stays ASCII for NSIS FileRead; preserve Unicode
            # paths on the second line without a leading UTF-8 BOM.
            [IO.File]::WriteAllText($TempDriveOutputPath, "${drive}\`r`n$tempScope", [Text.UTF8Encoding]::new($false))
            Write-ProcessLog "Mapped private same-volume temp $tempScope to $drive for old NSIS uninstaller"
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
  if ($tempScope -and (Test-Path -LiteralPath $tempScope)) {
    try { Remove-OwnedTempScope $tempScope } catch { Write-ProcessLog "Temporary cleanup failed: $_" }
  }
  Write-ProcessLog "Process check failed: $_"
  exit 2
}

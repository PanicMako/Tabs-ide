$ErrorActionPreference = "Stop"
$processLogPath = Join-Path $env:RUNNER_TEMP "tabs-installer-processes.log"
$env:TABS_INSTALLER_PROCESS_LOG = $processLogPath
$diagnosticDir = Join-Path $env:RUNNER_TEMP "tabs-installer-diagnostics"

function Save-InstallerDiagnostics {
  param(
    [Diagnostics.Process]$Installer,
    [string]$InstallDir,
    [int]$ElapsedSeconds,
    [switch]$CaptureDump
  )

  New-Item $diagnosticDir -ItemType Directory -Force | Out-Null
  $snapshot = Join-Path $diagnosticDir "installer-$ElapsedSeconds.txt"
  "Elapsed: $ElapsedSeconds seconds; UTC: $([DateTime]::UtcNow.ToString('o'))" | Set-Content $snapshot
  "Installer PID: $($Installer.Id)" | Add-Content $snapshot

  Get-CimInstance Win32_Process -Filter "ProcessId = $($Installer.Id)" |
    Select-Object ProcessId, ParentProcessId, Name, CommandLine, ExecutablePath, CreationDate, KernelModeTime, UserModeTime, ReadTransferCount, WriteTransferCount, ReadOperationCount, WriteOperationCount |
    Format-List | Out-String | Add-Content $snapshot

  try {
    $Installer.Refresh()
    $Installer.Threads |
      Select-Object Id, ThreadState, WaitReason, StartAddress |
      Format-Table -AutoSize | Out-String | Add-Content $snapshot
  } catch {
    "Thread snapshot failed: $_" | Add-Content $snapshot
  }

  $drives = @((Get-Item $env:RUNNER_TEMP).PSDrive) + @((Get-Item $InstallDir).PSDrive)
  foreach ($drive in $drives) {
    if ($drive -and $drive.Free -ne $null) {
      "Drive $($drive.Name): free $($drive.Free) bytes" | Add-Content $snapshot
    }
  }

  "NSIS temporary directories:" | Add-Content $snapshot
  Get-ChildItem $env:RUNNER_TEMP, $env:TEMP -Directory -Filter 'ns*.tmp' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Unique |
    ForEach-Object {
      "  $($_.FullName) modified $($_.LastWriteTimeUtc.ToString('o'))" | Add-Content $snapshot
      Get-ChildItem $_.FullName -Force -ErrorAction SilentlyContinue |
        Select-Object -First 30 FullName, Length, LastWriteTimeUtc |
        Format-Table -AutoSize | Out-String | Add-Content $snapshot
    }

  if ($CaptureDump) {
    $procDump = Join-Path $diagnosticDir 'procdump64.exe'
    if (-not (Test-Path $procDump)) {
      try {
        $zip = Join-Path $diagnosticDir 'procdump.zip'
        Invoke-WebRequest 'https://download.sysinternals.com/files/Procdump.zip' -OutFile $zip
        Expand-Archive $zip -DestinationPath $diagnosticDir -Force
        Remove-Item $zip
      } catch {
        "ProcDump download failed: $_" | Add-Content $snapshot
      }
    }
    if (Test-Path $procDump) {
      & $procDump -accepteula -mt $Installer.Id (Join-Path $diagnosticDir "installer-$ElapsedSeconds.dmp") 2>&1 |
        Out-String | Add-Content $snapshot
    }
  }

  Write-Host "Installer diagnostic snapshot: $snapshot"
}

function Invoke-SilentInstaller {
  param(
    [Parameter(Mandatory)] [string]$Path,
    [Parameter(Mandatory)] [string]$InstallDir,
    [Parameter(Mandatory)] [string]$Label,
    [Diagnostics.Process]$LockHolder,
    [int]$TimeoutSeconds = 1200
  )

  if (-not (Test-Path $Path -PathType Leaf)) {
    throw "$Label installer was not found: $Path"
  }

  Write-Host "$Label`: $Path"
  Write-Host "Install directory: $InstallDir"

  # NSIS requires /D= to be the final installer argument.
  $arguments = @(
    '/S',
    "/D=$InstallDir"
  )

  $process = Start-Process `
    -FilePath $Path `
    -ArgumentList $arguments `
    -PassThru `
    -WorkingDirectory (Split-Path -Parent $Path)

  $sw = [Diagnostics.Stopwatch]::StartNew()
  $lastReport = 0
  $diagnosedAt = @{}

  try {
    while (-not $process.HasExited) {
      Start-Sleep -Seconds 5
      $process.Refresh()
      $elapsed = [int]$sw.Elapsed.TotalSeconds

      if ($Label -eq 'NSIS upgrade') {
        foreach ($checkpoint in @(300, 900)) {
          if ($elapsed -ge $checkpoint -and -not $diagnosedAt.ContainsKey($checkpoint)) {
            $diagnosedAt[$checkpoint] = $true
            try {
              Save-InstallerDiagnostics -Installer $process -InstallDir $InstallDir -ElapsedSeconds $elapsed -CaptureDump
            } catch {
              Write-Warning "Could not capture installer diagnostics: $_"
            }
          }
        }
      }

      if ($LockHolder -and $elapsed -ge 180) {
        $LockHolder.Refresh()
        if (-not $LockHolder.HasExited) {
          Write-Host "Installer has not closed lock holder PID $($LockHolder.Id) after ${elapsed}s."
          if (Test-Path $processLogPath) {
            Get-Content $processLogPath | Write-Host
          } else {
            Write-Host "The installer process-closer did not write a log."
          }
          Get-CimInstance Win32_Process |
            Where-Object { $_.ParentProcessId -eq $process.Id -or $_.ProcessId -eq $process.Id } |
            Select-Object ProcessId, ParentProcessId, Name, CommandLine |
            Format-List | Out-String | Write-Host
          throw "$Label did not close the installation's running process."
        }
      }

      if ($elapsed -ge $TimeoutSeconds) {
        try {
          Save-InstallerDiagnostics -Installer $process -InstallDir $InstallDir -ElapsedSeconds $elapsed
        } catch {
          Write-Warning "Could not capture installer diagnostics: $_"
        }
        $childProcesses = Get-CimInstance Win32_Process |
          Where-Object { $_.ParentProcessId -eq $process.Id } |
          Select-Object ProcessId, Name, CommandLine

        Write-Host "$Label did not exit within $TimeoutSeconds seconds."
        Write-Host "Installer PID: $($process.Id)"
        $childProcesses | Format-List | Out-String | Write-Host

        # Log system-wide Tabs and uninstaller processes
        Write-Host "Active related processes on system:"
        Get-CimInstance Win32_Process |
          Where-Object { $_.Name -like "*Tabs*" -or $_.Name -like "*old-uninstaller*" -or $_.CommandLine -like "*$InstallDir*" } |
          Select-Object ProcessId, Name, CommandLine |
          Format-List | Out-String | Write-Host

        # Log files in install directory
        $installedFiles = @(Get-ChildItem $InstallDir -Recurse -ErrorAction SilentlyContinue)
        Write-Host "Files in install dir ($($installedFiles.Count) total):"
        $installedFiles | Select-Object -First 20 FullName | Format-Table | Out-String | Write-Host

        # Kill descendants first, then the installer.
        Get-CimInstance Win32_Process |
          Where-Object { $_.ParentProcessId -eq $process.Id } |
          ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
          }

        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "$Label timed out."
      }

      # Report progress every 30 seconds
      if ($elapsed - $lastReport -ge 30) {
        $lastReport = $elapsed
        $fileCount = @(Get-ChildItem $InstallDir -Recurse -ErrorAction SilentlyContinue).Count
        Write-Host "  [$Label running: ${elapsed}s elapsed, files in install dir: $fileCount]"
      }
    }

    $process.Refresh()
    if ($process.ExitCode -ne 0) {
      throw "$Label failed with exit code $($process.ExitCode)."
    }
    Write-Host "  [$Label finished successfully in $([int]$sw.Elapsed.TotalSeconds)s]"
  }
  finally {
    if ($process -and -not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
  }
}

$installer = (Get-ChildItem tabs-main/release -Filter *.exe | Select-Object -First 1).FullName
$initialInstaller = $installer
if ($env:TABS_SMOKE_PREVIOUS_VERSION) {
  $version = $env:TABS_SMOKE_PREVIOUS_VERSION
  $assetName = "Tabs-$version-x64.exe"
  $initialInstaller = Join-Path $env:RUNNER_TEMP $assetName
  Write-Host "Downloading and verifying previous installer v$version..."
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    & gh release download "v$version" --repo $env:GITHUB_REPOSITORY --pattern $assetName --dir $env:RUNNER_TEMP --clobber
    if ($LASTEXITCODE -eq 0) { break }
    if ($attempt -eq 3) { throw "Could not download previous installer v$version." }
    Start-Sleep -Seconds (5 * $attempt)
  }
  $expectedDigest = & gh api "repos/$env:GITHUB_REPOSITORY/releases/tags/v$version" --jq ".assets[] | select(.name == `"$assetName`") | .digest"
  if ($LASTEXITCODE -ne 0 -or -not $expectedDigest) { throw "Could not verify previous installer digest." }
  $actualDigest = "sha256:$((Get-FileHash $initialInstaller -Algorithm SHA256).Hash.ToLowerInvariant())"
  if ($actualDigest -ne $expectedDigest) { throw "Previous installer checksum mismatch." }
  Write-Host "Previous installer digest verified."
}
$installDir = Join-Path $env:RUNNER_TEMP "TabsSmokeInstall"
$unrelatedDir = Join-Path $env:RUNNER_TEMP "TabsUnrelatedProcess"
New-Item $unrelatedDir -ItemType Directory -Force | Out-Null
$holder = $null
$unrelated = $null
$installedApp = $null
try {
  Write-Host "Installing previous version into $installDir..."
  Invoke-SilentInstaller -Path $initialInstaller -InstallDir $installDir -Label "Initial NSIS install" -TimeoutSeconds 1200
  if (-not (Test-Path (Join-Path $installDir "Tabs.exe"))) { throw "Tabs.exe was not installed." }
  Write-Host "Initial install completed."

  $holderExe = Join-Path $installDir "TabsSmokeHold.exe"
  $unrelatedExe = Join-Path $unrelatedDir "rg.exe"
  Copy-Item "$env:WINDIR\System32\cmd.exe" $holderExe
  Copy-Item "$env:WINDIR\System32\cmd.exe" $unrelatedExe
  $holder = Start-Process $holderExe -ArgumentList '/c ping -t 127.0.0.1' -WindowStyle Hidden -PassThru
  $unrelated = Start-Process $unrelatedExe -ArgumentList '/c ping -t 127.0.0.1' -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 2
  if ($holder.HasExited -or $unrelated.HasExited) { throw "Smoke-test process exited before upgrade." }

  Write-Host "Upgrading with an in-installation lock holder and unrelated rg.exe running..."
  if ($env:TABS_SMOKE_DIAGNOSE_UNINSTALL -eq 'true') {
    $tempDriveOutputPath = $null
    if ($env:TABS_SMOKE_DIAGNOSE_SUBST_TEMP -eq 'true') {
      $tempDriveOutputPath = Join-Path $env:RUNNER_TEMP 'tabs-temp-drive.txt'
    }
    & ./tabs-main/scripts/close-windows-install-processes.ps1 $installDir -TempDriveOutputPath $tempDriveOutputPath
    if ($LASTEXITCODE -ne 0) { throw "Process closer returned $LASTEXITCODE." }
    $holder.Refresh()
    if (-not $holder.HasExited) { throw "Process closer did not stop the lock holder." }

    $oldUninstaller = Join-Path $env:RUNNER_TEMP 'old-uninstaller.exe'
    Copy-Item (Join-Path $installDir 'Uninstall Tabs.exe') $oldUninstaller
    $uninstallArgs = @('/S', '/KEEP_APP_DATA', '/currentuser', '--keep-shortcuts', '--updated', "_?=$installDir")
    if ($env:TABS_SMOKE_DIAGNOSE_SHORT_TEMP -eq 'true') {
      $env:TEMP = $env:RUNNER_TEMP
      $env:TMP = $env:RUNNER_TEMP
      Write-Host "Using short old-uninstaller temp path: $env:TEMP"
    }
    $tempDrive = $null
    if ($tempDriveOutputPath) {
      $tempDrive = Get-Content $tempDriveOutputPath -Raw
      $env:TEMP = $tempDrive
      $env:TMP = $tempDrive
      Write-Host "Using mapped old-uninstaller temp path: $tempDrive"
    }
    Write-Host "Running the previous version's uninstaller directly: $oldUninstaller $($uninstallArgs -join ' ')"
    try {
      $old = Start-Process $oldUninstaller -ArgumentList $uninstallArgs -PassThru
      if (-not $old.WaitForExit(300000)) {
        Stop-Process -Id $old.Id -Force -ErrorAction SilentlyContinue
        throw "Old uninstaller did not exit within 300 seconds."
      }
      $old.Refresh()
    } finally {
      if ($tempDrive) {
        & ./tabs-main/scripts/close-windows-install-processes.ps1 $installDir -CleanupTempDrive $tempDrive.Substring(0, 2)
      }
    }
    Write-Host "Old uninstaller exit code: $($old.ExitCode)"
    if ($old.ExitCode -ne 0) { throw "Old uninstaller failed with exit code $($old.ExitCode)." }
    if (Test-Path $installDir) {
      $remaining = @(Get-ChildItem $installDir -Recurse -ErrorAction SilentlyContinue)
      Write-Host "Old uninstall left $($remaining.Count) entries in the install directory."
      $remaining | Select-Object -First 30 FullName | Format-Table | Out-String | Write-Host
    }
    Write-Host "Direct old-version uninstall passed."
    return
  }
  Invoke-SilentInstaller -Path $installer -InstallDir $installDir -Label "NSIS upgrade" -LockHolder $holder -TimeoutSeconds 1200
  $holder.Refresh()
  $unrelated.Refresh()
  if (-not $holder.HasExited) { throw "Installer did not close a process running from its installation." }
  if ($unrelated.HasExited) { throw "Installer killed an unrelated rg.exe process." }
  if (-not (Test-Path (Join-Path $installDir "Tabs.exe"))) { throw "Tabs.exe is missing after upgrade." }
  if (-not (Test-Path (Join-Path $installDir "resources/tabs-code-main/out/vs/code/electron-browser/workbench/workbench-dev.html") -PathType Leaf)) { throw "Upgrade is missing the bundled editor." }
  if (-not (Test-Path (Join-Path $installDir "resources/tabs-code-main/node_modules/minimist/index.js") -PathType Leaf)) { throw "Upgrade is missing editor runtime dependencies." }
  Write-Host "Windows legacy upgrade and process-scope checks passed."

  $smokeHome = Join-Path $env:RUNNER_TEMP "TabsLaunchSmoke"
  $desktopLog = Join-Path $smokeHome "userdata/logs/desktop-main.log"
  $env:TABS_HOME = $smokeHome
  $env:TABS_DESKTOP_USER_DATA_DIR = Join-Path $smokeHome "electron-profile"
  $env:TABS_DISABLE_AUTO_UPDATE = "1"
  Write-Host "Launching upgraded Tabs with isolated state..."
  $installedApp = Start-Process (Join-Path $installDir "Tabs.exe") -PassThru
  $ready = $false
  for ($attempt = 1; $attempt -le 24; $attempt++) {
    Start-Sleep -Seconds 5
    $installedApp.Refresh()
    if ($installedApp.HasExited) { break }
    if ((Test-Path $desktopLog) -and (Select-String $desktopLog -Pattern "bootstrap native Code-OSS main-process backend started" -Quiet)) {
      $ready = $true
      break
    }
  }
  if (-not $ready) {
    if (Test-Path $desktopLog) { Get-Content $desktopLog -Tail 100 | Write-Host }
    throw "The upgraded app did not start its bundled editor backend within 120 seconds."
  }
  Write-Host "Upgraded Tabs launched with its bundled editor backend."
} finally {
  foreach ($process in @($holder, $unrelated, $installedApp)) {
    if ($process -and -not $process.HasExited) {
      & taskkill.exe /F /T /PID $process.Id 2>$null | Out-Null
    }
  }
}

# Close processes launched from this installation before NSIS replaces files.
!macro customCheckAppRunning
  InitPluginsDir
  File /oname=$PLUGINSDIR\close-tabs-processes.ps1 "${PROJECT_DIR}\build\close-windows-install-processes.ps1"
  !ifdef BUILD_UNINSTALLER
    nsExec::ExecToLog /TIMEOUT=60000 `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\close-tabs-processes.ps1" "$INSTDIR"`
  !else
    nsExec::ExecToLog /TIMEOUT=60000 `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\close-tabs-processes.ps1" "$INSTDIR" -TempDriveOutputPath "$PLUGINSDIR\tabs-temp-drive.txt"`
  !endif
  Pop $0
  StrCmp $0 0 checkDone
  DetailPrint "Process close command returned $0"
  IfSilent cancelInstall 0
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY retryClose IDCANCEL cancelInstall
  retryClose:
    !ifdef BUILD_UNINSTALLER
    nsExec::ExecToLog /TIMEOUT=60000 `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\close-tabs-processes.ps1" "$INSTDIR"`
    !else
    nsExec::ExecToLog /TIMEOUT=60000 `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\close-tabs-processes.ps1" "$INSTDIR" -TempDriveOutputPath "$PLUGINSDIR\tabs-temp-drive.txt"`
    !endif
    Pop $0
    StrCmp $0 0 checkDone
  cancelInstall:
    SetErrorLevel 1
    Quit
  checkDone:
    !ifndef BUILD_UNINSTALLER
      IfFileExists "$PLUGINSDIR\tabs-temp-drive.txt" 0 noTempDrive
      FileOpen $1 "$PLUGINSDIR\tabs-temp-drive.txt" r
      FileRead $1 $2
      FileClose $1
      StrCpy $2 $2 3
      System::Call 'kernel32::SetEnvironmentVariableW(w "TMP", w r2)i.r1'
      StrCmp $1 0 cancelInstall
      System::Call 'kernel32::SetEnvironmentVariableW(w "TEMP", w r2)i.r1'
      StrCmp $1 0 cancelInstall
      DetailPrint "Using $2 as temporary directory for old uninstall."
      noTempDrive:
    !endif
!macroend

!ifndef BUILD_UNINSTALLER
Function cleanupOldUninstallTempDrive
  IfFileExists "$PLUGINSDIR\tabs-temp-drive.txt" 0 cleanupDone
  FileOpen $1 "$PLUGINSDIR\tabs-temp-drive.txt" r
  FileRead $1 $2
  FileClose $1
  StrCpy $2 $2 2
  nsExec::ExecToLog /TIMEOUT=60000 `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\close-tabs-processes.ps1" "$INSTDIR" -CleanupTempDrive "$2"`
  Pop $1
  Delete "$PLUGINSDIR\tabs-temp-drive.txt"
  cleanupDone:
FunctionEnd

!macro customUnInstallCheck
  IfErrors uninstallLaunchFailed
  ${if} $R0 != 0
    DetailPrint "Previous Tabs uninstaller failed with exit code $R0."
    Call cleanupOldUninstallTempDrive
    SetErrorLevel $R0
    Quit
  ${endif}
  Call cleanupOldUninstallTempDrive
  Goto uninstallCheckDone
  uninstallLaunchFailed:
    DetailPrint "Previous Tabs uninstaller could not be launched."
    Call cleanupOldUninstallTempDrive
    SetErrorLevel 2
    Quit
  uninstallCheckDone:
!macroend
!endif

import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function replaceOnce(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) {
    throw new Error(`Unsupported electron-builder NSIS template: ${before}`);
  }
  return source.replace(before, after);
}

export function windowsNsisTemplateDirectory(): string {
  const builderRequire = createRequire(require.resolve("electron-builder/package.json"));
  const root = dirname(builderRequire.resolve("app-builder-lib/package.json"));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
  if (pkg.version !== "26.15.3")
    throw new Error(`Unreviewed NSIS template version: ${pkg.version}`);
  return join(root, "templates", "nsis");
}

const phaseMacro = String.raw`
!macro tabsInstallPhase NAME
  Push $R7
  Push $R8
  Push $0
  ReadEnvStr $R7 "TABS_INSTALLER_PHASE_LOG"
  StrCmp $R7 "" +6
  FileOpen $R8 "$R7" a
  FileSeek $R8 0 END
  System::Call 'kernel32::GetTickCount()i.r0'
  FileWrite $R8 "$0 ${"${NAME}"}$\r$\n"
  FileClose $R8
  Pop $0
  Pop $R8
  Pop $R7
!macroend
`;

const moveExtractedDirectory = String.raw`
    !insertmacro tabsInstallPhase "commit-start"
    ${"${if}"} $R1 == 1
      Push $R2
      StrCpy $R2 $OUTDIR
      # Release NSIS' working-directory handle before removing the empty target.
      SetOutPath "$PLUGINSDIR"
      # installSection may have written this installer-owned icon before extraction.
      Rename "$INSTDIR\uninstallerIcon.ico" "$PLUGINSDIR\7z-out\uninstallerIcon.ico"
      ClearErrors
      # Never recursively delete an existing destination. Unknown remaining files
      # or a different volume select the stock copy/retry path below instead.
      RMDir "$INSTDIR"
      ${"${ifNot}"} ${"${Errors}"}
        ClearErrors
        Rename "$PLUGINSDIR\7z-out" "$INSTDIR"
        ${"${ifNot}"} ${"${Errors}"}
          SetOutPath "$R2"
          Pop $R2
          !insertmacro tabsInstallPhase "directory-move-complete"
          Goto DoneExtract7za
        ${"${endif}"}
      ${"${endif}"}
      SetOutPath "$R2"
      Pop $R2
    ${"${endif}"}
    ClearErrors
    !insertmacro tabsInstallPhase "copy-fallback"
    CopyFiles /SILENT "$PLUGINSDIR\7z-out\*" $OUTDIR`;

export function writeWindowsNsisScripts(outputDirectory: string): string {
  const templates = windowsNsisTemplateDirectory();
  const load = (name: string) => readFileSync(join(templates, name), "utf8");
  const include = (name: string) => `"${"${PROJECT_DIR}"}\\build\\${name}"`;
  const files: Record<string, string> = {
    "windows-installer.nsi": replaceOnce(
      load("installer.nsi"),
      '!include "installSection.nsh"',
      `!include ${include("windows-install-section.nsh")}`,
    ),
    "windows-install-section.nsh": replaceOnce(
      load("installSection.nsh"),
      "!include installer.nsh",
      `!include ${include("windows-installer-functions.nsh")}`,
    ),
    "windows-installer-functions.nsh": replaceOnce(
      load("include/installer.nsh"),
      '!include "extractAppPackage.nsh"',
      `!include ${include("windows-extract.nsh")}`,
    ),
  };
  files["windows-installer-functions.nsh"] = replaceOnce(
    files["windows-installer-functions.nsh"]!,
    '      !insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA\\${APP_INSTALLER_STORE_FILE}"',
    String.raw`      !insertmacro tabsInstallPhase "installer-cache-start"
      !insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA${"\\"}${"${APP_INSTALLER_STORE_FILE}"}"
      !insertmacro tabsInstallPhase "installer-cache-complete"`,
  );
  let extraction = load("include/extractAppPackage.nsh");
  extraction = replaceOnce(
    extraction,
    '\n  Nsis7z::Extract "${FILE}"\n',
    String.raw`
  !insertmacro tabsInstallPhase "extract-start"
  Nsis7z::Extract "${"${FILE}"}"
  !insertmacro tabsInstallPhase "extract-complete"
`,
  );
  extraction = replaceOnce(
    extraction,
    '    CopyFiles /SILENT "$PLUGINSDIR\\7z-out\\*" $OUTDIR',
    moveExtractedDirectory,
  );
  // The pinned plugin has no dependable exit-status result. Validate the staged
  // full-fat runtime before replacing the destination, including its file count.
  extraction = replaceOnce(
    extraction,
    "  # Retry counter",
    String.raw`  File /oname=$PLUGINSDIR\verify-staged-runtime.ps1 "${"${PROJECT_DIR}"}\build\verify-staged-runtime.ps1"
  nsExec::ExecToLog /TIMEOUT=60000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\verify-staged-runtime.ps1" "$PLUGINSDIR\7z-out"'
  Pop $R1
  StrCmp $R1 0 +3
    SetErrorLevel 2
    Goto AbortExtract7za

  # Retry counter`,
  );
  files["windows-extract.nsh"] = phaseMacro + extraction;
  mkdirSync(outputDirectory, { recursive: true });
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(outputDirectory, name), content);
  return join(outputDirectory, "windows-installer.nsi");
}

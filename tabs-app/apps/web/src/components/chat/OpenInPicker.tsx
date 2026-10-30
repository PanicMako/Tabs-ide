import { EditorId, type ResolvedKeybindingsConfig } from "@tabs/contracts";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { isOpenFavoriteEditorShortcut, shortcutLabelForCommand } from "../../keybindings";
import { usePreferredEditor } from "../../editorPreferences";
import { ChevronDownIcon, FolderClosedIcon, CheckIcon } from "lucide-react";
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  AntigravityIcon,
  CursorIcon,
  FileExplorerIcon,
  FinderIcon,
  Icon,
  KiroIcon,
  TraeIcon,
  VisualStudioCode,
  VisualStudioCodeInsiders,
  VSCodium,
  Zed,
} from "../Icons";
import {
  AquaIcon,
  CLionIcon,
  DataGripIcon,
  DataSpellIcon,
  GoLandIcon,
  IntelliJIdeaIcon,
  PhpStormIcon,
  PyCharmIcon,
  RiderIcon,
  RubyMineIcon,
  RustRoverIcon,
  WebStormIcon,
} from "../JetBrainsIcons";
import { isMacPlatform, isWindowsPlatform } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";

const resolveOptions = (platform: string, availableEditors: ReadonlyArray<EditorId>) => {
  const baseOptions: ReadonlyArray<{ label: string; Icon: Icon; value: EditorId }> = [
    { label: "Cursor", Icon: CursorIcon, value: "cursor" },
    { label: "Trae", Icon: TraeIcon, value: "trae" },
    { label: "Kiro", Icon: KiroIcon, value: "kiro" },
    { label: "VS Code", Icon: VisualStudioCode, value: "vscode" },
    { label: "VS Code Insiders", Icon: VisualStudioCodeInsiders, value: "vscode-insiders" },
    { label: "VSCodium", Icon: VSCodium, value: "vscodium" },
    { label: "Zed", Icon: Zed, value: "zed" },
    { label: "Antigravity", Icon: AntigravityIcon, value: "antigravity" },
    { label: "IntelliJ IDEA", Icon: IntelliJIdeaIcon, value: "idea" },
    { label: "WebStorm", Icon: WebStormIcon, value: "webstorm" },
    { label: "PyCharm", Icon: PyCharmIcon, value: "pycharm" },
    { label: "GoLand", Icon: GoLandIcon, value: "goland" },
    { label: "CLion", Icon: CLionIcon, value: "clion" },
    { label: "Rider", Icon: RiderIcon, value: "rider" },
    { label: "RustRover", Icon: RustRoverIcon, value: "rustrover" },
    { label: "PhpStorm", Icon: PhpStormIcon, value: "phpstorm" },
    { label: "DataGrip", Icon: DataGripIcon, value: "datagrip" },
    { label: "DataSpell", Icon: DataSpellIcon, value: "dataspell" },
    { label: "Aqua", Icon: AquaIcon, value: "aqua" },
    { label: "RubyMine", Icon: RubyMineIcon, value: "rubymine" },
    {
      label: isMacPlatform(platform)
        ? "Finder"
        : isWindowsPlatform(platform)
          ? "Explorer"
          : "Files",
      Icon: isMacPlatform(platform)
        ? FinderIcon
        : isWindowsPlatform(platform)
          ? FileExplorerIcon
          : (FolderClosedIcon as unknown as Icon),
      value: "file-manager",
    },
  ];
  const availableSet = new Set(availableEditors);
  return baseOptions.filter((option) => availableSet.has(option.value));
};

export const OpenInPicker = memo(function OpenInPicker({
  keybindings,
  availableEditors,
  openInCwd,
  showEditorName = false,
  displayMode = "toolbar",
}: {
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
  showEditorName?: boolean;
  displayMode?: "toolbar" | "panel";
}) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [preferredEditor, setPreferredEditor] = usePreferredEditor(availableEditors);
  const options = useMemo(
    () => resolveOptions(navigator.platform, availableEditors),
    [availableEditors],
  );
  const primaryOption = options.find(({ value }) => value === preferredEditor) ?? null;

  const openInEditor = useCallback(
    (editorId: EditorId | null) => {
      const api = readNativeApi();
      if (!api || !openInCwd) return;
      const editor = editorId ?? preferredEditor;
      if (!editor) return;
      void api.shell.openInEditor(openInCwd, editor);
      setPreferredEditor(editor);
    },
    [preferredEditor, openInCwd, setPreferredEditor],
  );

  const openFavoriteEditorShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "editor.openFavorite"),
    [keybindings],
  );

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const api = readNativeApi();
      if (!isOpenFavoriteEditorShortcut(e, keybindings)) return;
      if (!api || !openInCwd) return;
      if (!preferredEditor) return;

      e.preventDefault();
      void api.shell.openInEditor(openInCwd, preferredEditor);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [preferredEditor, keybindings, openInCwd]);

  return (
    <div
      data-slot="joined-control"
      ref={anchorRef}
      role="group"
      aria-label="Editor actions"
      className={
        displayMode === "panel"
          ? "workspace-editor-row flex h-9 w-full min-w-0 items-center rounded-lg text-foreground hover:bg-muted/60 transition-colors"
          : "flex h-9 w-full items-center rounded-xl border border-border/80 bg-muted/20 hover:bg-accent/30 hover:border-border transition-colors shadow-2xs text-foreground"
      }
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={!preferredEditor || !openInCwd}
              onClick={() => openInEditor(preferredEditor)}
              aria-label={primaryOption ? `Open in ${primaryOption.label}` : "Open in editor"}
              className="flex h-full flex-1 items-center justify-start gap-2 rounded-l-lg px-2.5 text-xs font-medium text-foreground hover:bg-accent/50 transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-w-0"
            />
          }
        >
          {primaryOption?.Icon && (
            <primaryOption.Icon aria-hidden="true" className="size-3.5 shrink-0" />
          )}
          <span className="truncate text-xs font-medium">
            {showEditorName && primaryOption ? `Open in ${primaryOption.label}` : "Open in editor"}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {primaryOption
            ? openFavoriteEditorShortcutLabel
              ? `Open in ${primaryOption.label} (${openFavoriteEditorShortcutLabel})`
              : `Open in ${primaryOption.label}`
            : "Open in editor"}
        </TooltipPopup>
      </Tooltip>
      <div className="h-4 w-px bg-border/80 shrink-0" aria-hidden="true" />
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label="Choose editor"
              className="flex h-full w-8 shrink-0 items-center justify-center rounded-r-lg text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[popup-open]:bg-accent/50 data-[popup-open]:text-foreground"
            />
          }
        >
          <ChevronDownIcon
            aria-hidden="true"
            className="size-3 transition-transform duration-150"
          />
        </MenuTrigger>
        <MenuPopup anchor={anchorRef} align="start" className="w-(--anchor-width)">
          {options.length === 0 && <MenuItem disabled>No installed editors found</MenuItem>}
          {options.map(({ label, Icon, value }) => (
            <MenuItem key={value} onClick={() => openInEditor(value)} className="gap-2">
              <Icon aria-hidden="true" className="size-4 shrink-0 text-foreground" />
              <span className="truncate flex-1 text-left">{label}</span>
              {value === preferredEditor ? (
                <CheckIcon className="size-3.5 shrink-0 text-primary" />
              ) : value === preferredEditor && openFavoriteEditorShortcutLabel ? (
                <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
              ) : null}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
});

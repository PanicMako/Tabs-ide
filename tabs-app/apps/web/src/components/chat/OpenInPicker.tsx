import { EditorId, type ResolvedKeybindingsConfig } from "@tabs/contracts";
import { memo, useCallback, useEffect, useMemo } from "react";
import { isOpenFavoriteEditorShortcut, shortcutLabelForCommand } from "../../keybindings";
import { usePreferredEditor } from "../../editorPreferences";
import { ChevronDownIcon, FolderClosedIcon } from "lucide-react";
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
}: {
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
}) {
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
      role="group"
      aria-label="Editor actions"
      className="inline-flex h-7 items-center rounded-lg border border-border/80 bg-background hover:bg-accent/40 hover:border-border transition-colors shadow-2xs shrink-0 text-foreground"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={!preferredEditor || !openInCwd}
              onClick={() => openInEditor(preferredEditor)}
              aria-label={primaryOption ? `Open in ${primaryOption.label}` : "Open in editor"}
              className="flex h-full items-center justify-center gap-1.5 rounded-l-[7px] px-2 text-xs font-medium text-foreground hover:bg-accent/60 transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          }
        >
          {primaryOption?.Icon && (
            <primaryOption.Icon aria-hidden="true" className="size-3.5 shrink-0" />
          )}
          <span className="text-xs font-medium">Open</span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {primaryOption
            ? openFavoriteEditorShortcutLabel
              ? `Open in ${primaryOption.label} (${openFavoriteEditorShortcutLabel})`
              : `Open in ${primaryOption.label}`
            : "Open in editor"}
        </TooltipPopup>
      </Tooltip>
      <div className="h-3.5 w-px bg-border/80 shrink-0" aria-hidden="true" />
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label="Choose editor"
              className="flex h-full w-5 items-center justify-center rounded-r-[7px] text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[popup-open]:bg-accent/60 data-[popup-open]:text-foreground"
            />
          }
        >
          <ChevronDownIcon
            aria-hidden="true"
            className="size-3 transition-transform duration-150"
          />
        </MenuTrigger>
        <MenuPopup align="end" className="w-52">
          {options.length === 0 && <MenuItem disabled>No installed editors found</MenuItem>}
          {options.map(({ label, Icon, value }) => (
            <MenuItem key={value} onClick={() => openInEditor(value)} className="gap-2">
              <Icon aria-hidden="true" className="size-4 shrink-0 text-foreground" />
              <span className="truncate flex-1 text-left">{label}</span>
              {value === preferredEditor && openFavoriteEditorShortcutLabel && (
                <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
              )}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
});

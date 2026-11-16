import type {
  ProjectScript,
  ProjectScriptIcon,
  ResolvedKeybindingsConfig,
  T3ProjectFileScript,
} from "@tabs/contracts";
import {
  BugIcon,
  ChevronDownIcon,
  DownloadIcon,
  FlaskConicalIcon,
  HammerIcon,
  ListChecksIcon,
  PlayIcon,
  PlusIcon,
  SettingsIcon,
  WrenchIcon,
} from "lucide-react";
import React, { type FormEvent, type KeyboardEvent, useCallback, useMemo, useState } from "react";

import {
  keybindingValueForCommand,
  decodeProjectScriptKeybindingRule,
} from "~/lib/projectScriptKeybindings";
import {
  commandForProjectScript,
  nextProjectScriptId,
  primaryProjectScript,
  projectScriptMenuLabel,
  type ProjectScriptInput,
} from "~/projectScripts";
import { shortcutLabelForCommand } from "~/keybindings";
import { isMacPlatform } from "~/lib/utils";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { SettingsSubheading } from "./settings/SettingsLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Group, GroupSeparator } from "./ui/group";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "./ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

const SCRIPT_ICONS: Array<{ id: ProjectScriptIcon; label: string }> = [
  { id: "play", label: "Play" },
  { id: "test", label: "Test" },
  { id: "lint", label: "Lint" },
  { id: "configure", label: "Configure" },
  { id: "build", label: "Build" },
  { id: "debug", label: "Debug" },
];

function ScriptIcon({
  icon,
  className = "size-3.5",
}: {
  icon: ProjectScriptIcon;
  className?: string;
}) {
  if (icon === "test") return <FlaskConicalIcon className={className} />;
  if (icon === "lint") return <ListChecksIcon className={className} />;
  if (icon === "configure") return <WrenchIcon className={className} />;
  if (icon === "build") return <HammerIcon className={className} />;
  if (icon === "debug") return <BugIcon className={className} />;
  return <PlayIcon className={className} />;
}

function ScriptOptionSwitch(props: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="min-w-0">
        <span className="block">{props.label}</span>
        {props.description && (
          <span className="block text-xs text-muted-foreground">{props.description}</span>
        )}
      </span>
      <Switch
        checked={props.checked}
        onCheckedChange={(checked) => props.onCheckedChange(Boolean(checked))}
      />
    </label>
  );
}

export interface NewProjectScriptInput extends ProjectScriptInput {
  readonly keybinding: string | null;
}

function fileScriptInput(fileScript: T3ProjectFileScript): NewProjectScriptInput {
  return {
    name: fileScript.name,
    command: fileScript.command,
    icon: fileScript.icon ?? "play",
    runOnWorktreeCreate: fileScript.runOnWorktreeCreate ?? false,
    waitForSetup: fileScript.async === false,
    runOnSettle: fileScript.runOnSettle ?? false,
    stopOnSettle: fileScript.stopOnSettle ?? false,
    previewUrl: fileScript.previewUrl ?? null,
    autoOpenPreview: fileScript.autoOpenPreview ?? false,
    keybinding: null,
  };
}

interface ProjectScriptsControlProps {
  /** "list" renders a settings-style list with an Edit button per action. */
  displayMode?: "toolbar" | "panel" | "list";
  scripts: ProjectScript[];
  fileScripts?: ReadonlyArray<T3ProjectFileScript>;
  keybindings: ResolvedKeybindingsConfig;
  preferredScriptId?: string | null;
  onRunScript: (script: ProjectScript) => void;
  onAddScript: (input: NewProjectScriptInput) => Promise<void> | void;
  onUpdateScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void> | void;
  onDeleteScript: (scriptId: string) => Promise<void> | void;
}

function normalizeShortcutKeyToken(key: string): string | null {
  const normalized = key.toLowerCase();
  if (
    normalized === "meta" ||
    normalized === "control" ||
    normalized === "ctrl" ||
    normalized === "shift" ||
    normalized === "alt" ||
    normalized === "option"
  ) {
    return null;
  }
  if (normalized === " ") return "space";
  if (normalized === "escape") return "esc";
  if (normalized === "arrowup") return "arrowup";
  if (normalized === "arrowdown") return "arrowdown";
  if (normalized === "arrowleft") return "arrowleft";
  if (normalized === "arrowright") return "arrowright";
  if (normalized.length === 1) return normalized;
  if (normalized.startsWith("f") && normalized.length <= 3) return normalized;
  if (normalized === "enter" || normalized === "tab" || normalized === "backspace") {
    return normalized;
  }
  if (normalized === "delete" || normalized === "home" || normalized === "end") {
    return normalized;
  }
  if (normalized === "pageup" || normalized === "pagedown") return normalized;
  return null;
}

function keybindingFromEvent(event: KeyboardEvent<HTMLInputElement>): string | null {
  const keyToken = normalizeShortcutKeyToken(event.key);
  if (!keyToken) return null;

  const parts: string[] = [];
  if (isMacPlatform(navigator.platform)) {
    if (event.metaKey) parts.push("mod");
    if (event.ctrlKey) parts.push("ctrl");
  } else {
    if (event.ctrlKey) parts.push("mod");
    if (event.metaKey) parts.push("meta");
  }
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (parts.length === 0) {
    return null;
  }
  parts.push(keyToken);
  return parts.join("+");
}

export default function ProjectScriptsControl({
  displayMode = "toolbar",
  scripts,
  fileScripts = [],
  keybindings,
  preferredScriptId = null,
  onRunScript,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
}: ProjectScriptsControlProps) {
  const addScriptFormId = React.useId();
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [icon, setIcon] = useState<ProjectScriptIcon>("play");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [runOnWorktreeCreate, setRunOnWorktreeCreate] = useState(false);
  const [waitForSetup, setWaitForSetup] = useState(false);
  const [runOnSettle, setRunOnSettle] = useState(false);
  const [stopOnSettle, setStopOnSettle] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [autoOpenPreview, setAutoOpenPreview] = useState(false);
  const [keybinding, setKeybinding] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const importableScripts = useMemo(
    () =>
      (fileScripts ?? []).filter(
        (fileScript) =>
          !scripts.some(
            (script) =>
              script.command === fileScript.command ||
              script.name.toLowerCase() === fileScript.name.toLowerCase(),
          ),
      ),
    [fileScripts, scripts],
  );

  const primaryScript = useMemo(() => {
    if (preferredScriptId) {
      const preferred = scripts.find((script) => script.id === preferredScriptId);
      if (preferred) return preferred;
    }
    return primaryProjectScript(scripts);
  }, [preferredScriptId, scripts]);
  const isEditing = editingScriptId !== null;
  const dropdownItemClassName =
    "data-highlighted:bg-transparent data-highlighted:text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground data-highlighted:hover:bg-accent data-highlighted:hover:text-accent-foreground data-highlighted:focus-visible:bg-accent data-highlighted:focus-visible:text-accent-foreground";

  const captureKeybinding = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Backspace" || event.key === "Delete") {
      setKeybinding("");
      return;
    }
    const next = keybindingFromEvent(event);
    if (!next) return;
    setKeybinding(next);
  };

  const submitAddScript = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (trimmedName.length === 0) {
      setValidationError("Name is required.");
      return;
    }
    if (trimmedCommand.length === 0) {
      setValidationError("Command is required.");
      return;
    }

    setValidationError(null);
    try {
      const scriptIdForValidation =
        editingScriptId ??
        nextProjectScriptId(
          trimmedName,
          scripts.map((script) => script.id),
        );
      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding,
        command: commandForProjectScript(scriptIdForValidation),
      });
      const payload = {
        name: trimmedName,
        command: trimmedCommand,
        icon,
        runOnWorktreeCreate,
        waitForSetup,
        runOnSettle,
        stopOnSettle,
        previewUrl: previewUrl.trim() === "" ? null : previewUrl.trim(),
        autoOpenPreview,
        keybinding: keybindingRule?.key ?? null,
      } satisfies NewProjectScriptInput;
      if (editingScriptId) {
        await onUpdateScript(editingScriptId, payload);
      } else {
        await onAddScript(payload);
      }
      setDialogOpen(false);
      setIconPickerOpen(false);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Failed to save action.");
    }
  };

  const openAddDialog = () => {
    setEditingScriptId(null);
    setName("");
    setCommand("");
    setIcon("play");
    setIconPickerOpen(false);
    setRunOnWorktreeCreate(false);
    setWaitForSetup(false);
    setRunOnSettle(false);
    setStopOnSettle(false);
    setPreviewUrl("");
    setAutoOpenPreview(false);
    setKeybinding("");
    setValidationError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (script: ProjectScript) => {
    setEditingScriptId(script.id);
    setName(script.name);
    setCommand(script.command);
    setIcon(script.icon);
    setIconPickerOpen(false);
    setRunOnWorktreeCreate(script.runOnWorktreeCreate);
    setWaitForSetup(script.async === false);
    setRunOnSettle(script.runOnSettle ?? false);
    setStopOnSettle(script.stopOnSettle ?? false);
    setPreviewUrl(script.previewUrl ?? "");
    setAutoOpenPreview(script.autoOpenPreview ?? false);
    setKeybinding(keybindingValueForCommand(keybindings, commandForProjectScript(script.id)) ?? "");
    setValidationError(null);
    setDialogOpen(true);
  };

  const confirmDeleteScript = useCallback(() => {
    if (!editingScriptId) return;
    setDeleteConfirmOpen(false);
    void Promise.resolve(onDeleteScript(editingScriptId))
      .then(() => {
        setDialogOpen(false);
      })
      .catch((error) => {
        setValidationError(error instanceof Error ? error.message : "Failed to delete action.");
      });
  }, [editingScriptId, onDeleteScript]);

  const roleLabels = (script: ProjectScript) => [
    ...(script.runOnWorktreeCreate
      ? [script.async === false ? "Setup · holds agent" : "Setup"]
      : []),
    ...(script.runOnSettle ? ["When done"] : []),
    ...(script.stopOnSettle ? ["Stops when done"] : []),
    ...(script.previewUrl ? [script.autoOpenPreview ? "Opens preview" : "Preview"] : []),
  ];

  return (
    <>
      {displayMode === "list" ? (
        <div className="space-y-3">
          <SettingsSubheading
            title="Actions"
            description="Commands you can run from the chat header, at worktree setup, or when a thread settles."
          />
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>Project Actions</CardTitle>
                <CardDescription>
                  Add, edit and assign shortcuts to this project's commands.
                </CardDescription>
              </div>
              <Button size="sm" onClick={openAddDialog}>
                <PlusIcon className="size-3.5" />
                Add action
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {scripts.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                    No actions yet. Add one to run a command from the chat header, at worktree
                    setup, or when a thread settles.
                  </p>
                )}
                {scripts.map((script) => {
                  const shortcutLabel = shortcutLabelForCommand(
                    keybindings,
                    commandForProjectScript(script.id),
                  );
                  return (
                    <div
                      key={script.id}
                      className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/20 px-3.5 py-2.5"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
                        <ScriptIcon icon={script.icon} className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{script.name}</span>
                          {roleLabels(script).map((label) => (
                            <span
                              key={label}
                              className="rounded-full border border-border/70 px-1.5 text-[10.5px] leading-4 text-muted-foreground"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                        <code className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                          {script.command}
                        </code>
                      </div>
                      {shortcutLabel && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {shortcutLabel}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Edit ${script.name}`}
                        onClick={() => openEditDialog(script)}
                      >
                        Edit
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : primaryScript ? (
        <Group aria-label="Project scripts" className={displayMode === "panel" ? "w-full" : ""}>
          <Button
            size="xs"
            variant="outline"
            onClick={() => onRunScript(primaryScript)}
            title={`Run ${primaryScript.name}`}
            className={displayMode === "panel" ? "min-w-0 flex-1 justify-start" : undefined}
          >
            <ScriptIcon icon={primaryScript.icon} />
            <span
              className={
                displayMode === "panel"
                  ? "truncate text-left"
                  : "sr-only @sm/header-actions:not-sr-only @sm/header-actions:ml-0.5"
              }
            >
              {primaryScript.name}
            </span>
          </Button>
          <GroupSeparator className="hidden @sm/header-actions:block" />
          <Menu highlightItemOnHover={false}>
            <MenuTrigger
              render={<Button size="icon-xs" variant="outline" aria-label="Script actions" />}
            >
              <ChevronDownIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              {scripts.map((script) => {
                const shortcutLabel = shortcutLabelForCommand(
                  keybindings,
                  commandForProjectScript(script.id),
                );
                return (
                  <MenuItem
                    key={script.id}
                    className={`group ${dropdownItemClassName}`}
                    onClick={() => onRunScript(script)}
                  >
                    <ScriptIcon icon={script.icon} className="size-4" />
                    <span className="truncate">{projectScriptMenuLabel(script)}</span>
                    <span className="relative ms-auto flex h-6 min-w-6 items-center justify-end">
                      {shortcutLabel && (
                        <MenuShortcut className="ms-0 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                          {shortcutLabel}
                        </MenuShortcut>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute right-0 top-1/2 size-6 -translate-y-1/2 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-visible:opacity-100 group-focus-visible:pointer-events-auto"
                        aria-label={`Edit ${script.name}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openEditDialog(script);
                        }}
                      >
                        <SettingsIcon className="size-3.5" />
                      </Button>
                    </span>
                  </MenuItem>
                );
              })}
              {importableScripts.length > 0 && (
                <>
                  {scripts.length > 0 && <MenuSeparator />}
                  <MenuGroup>
                    <MenuGroupLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      From t3.json
                    </MenuGroupLabel>
                    {importableScripts.map((fileScript) => (
                      <MenuItem
                        key={`${fileScript.name} ${fileScript.command}`}
                        className={`group ${dropdownItemClassName}`}
                        onClick={async () => {
                          try {
                            await onAddScript(fileScriptInput(fileScript));
                          } catch (error) {
                            setValidationError(
                              error instanceof Error ? error.message : "Failed to import action.",
                            );
                            setDialogOpen(true);
                          }
                        }}
                      >
                        <ScriptIcon icon={fileScript.icon ?? "play"} className="size-4" />
                        <span className="truncate">{fileScript.name}</span>
                        <MenuShortcut className="ms-auto">
                          <DownloadIcon className="size-3.5" aria-label="Import" />
                        </MenuShortcut>
                      </MenuItem>
                    ))}
                  </MenuGroup>
                </>
              )}
              <MenuItem className={dropdownItemClassName} onClick={openAddDialog}>
                <PlusIcon className="size-4" />
                Add project script
              </MenuItem>
            </MenuPopup>
          </Menu>
        </Group>
      ) : importableScripts.length > 0 ? (
        <Group aria-label="Project scripts" className={displayMode === "panel" ? "w-full" : ""}>
          <Menu highlightItemOnHover={false}>
            <MenuTrigger
              render={
                <Button
                  size="xs"
                  variant="outline"
                  className={displayMode === "panel" ? "w-full justify-between" : undefined}
                  aria-label="Script actions"
                />
              }
            >
              <span className="flex items-center gap-1.5 truncate">
                <PlayIcon className="size-3.5" />
                <span>Project scripts</span>
              </span>
              <ChevronDownIcon className="size-4 ml-1 shrink-0" />
            </MenuTrigger>
            <MenuPopup align={displayMode === "panel" ? "start" : "end"}>
              <MenuGroup>
                <MenuGroupLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  From t3.json
                </MenuGroupLabel>
                {importableScripts.map((fileScript) => (
                  <MenuItem
                    key={`${fileScript.name} ${fileScript.command}`}
                    className={`group ${dropdownItemClassName}`}
                    onClick={async () => {
                      try {
                        await onAddScript(fileScriptInput(fileScript));
                      } catch (error) {
                        setValidationError(
                          error instanceof Error ? error.message : "Failed to import action.",
                        );
                        setDialogOpen(true);
                      }
                    }}
                  >
                    <ScriptIcon icon={fileScript.icon ?? "play"} className="size-4" />
                    <span className="truncate">{fileScript.name}</span>
                    <MenuShortcut className="ms-auto">
                      <DownloadIcon className="size-3.5" aria-label="Import" />
                    </MenuShortcut>
                  </MenuItem>
                ))}
              </MenuGroup>
              <MenuSeparator />
              <MenuItem className={dropdownItemClassName} onClick={openAddDialog}>
                <PlusIcon className="size-4" />
                Add project script
              </MenuItem>
            </MenuPopup>
          </Menu>
        </Group>
      ) : (
        <Button
          size="xs"
          variant="ghost"
          onClick={openAddDialog}
          title="Add project script"
          className={displayMode === "panel" ? "w-full justify-start" : undefined}
        >
          <PlusIcon className="size-3.5" />
          <span
            className={
              displayMode === "panel"
                ? "truncate text-left"
                : "sr-only @sm/header-actions:not-sr-only @sm/header-actions:ml-0.5"
            }
          >
            Add project script
          </span>
        </Button>
      )}

      <Dialog
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setIconPickerOpen(false);
          }
        }}
        onOpenChangeComplete={(open) => {
          if (open) return;
          setEditingScriptId(null);
          setName("");
          setCommand("");
          setIcon("play");
          setRunOnWorktreeCreate(false);
          setKeybinding("");
          setValidationError(null);
        }}
        open={dialogOpen}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Action" : "Add Action"}</DialogTitle>
            <DialogDescription>
              Run this project command from the toolbar or a shortcut.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form id={addScriptFormId} className="space-y-4" onSubmit={submitAddScript}>
              <div className="space-y-1.5">
                <Label htmlFor="script-name">Name</Label>
                <div className="flex items-center gap-2">
                  <Popover onOpenChange={setIconPickerOpen} open={iconPickerOpen}>
                    <PopoverTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          className="size-9 shrink-0 hover:bg-popover active:bg-popover data-pressed:bg-popover data-pressed:shadow-xs/5 data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)]"
                          aria-label="Choose icon"
                        />
                      }
                    >
                      <ScriptIcon icon={icon} className="size-4.5" />
                    </PopoverTrigger>
                    <PopoverPopup align="start">
                      <div className="grid grid-cols-3 gap-2">
                        {SCRIPT_ICONS.map((entry) => {
                          const isSelected = entry.id === icon;
                          return (
                            <button
                              key={entry.id}
                              type="button"
                              className={`relative flex flex-col items-center gap-2 rounded-md border px-2 py-2 text-xs ${
                                isSelected
                                  ? "border-primary/70 bg-primary/10"
                                  : "border-border/70 hover:bg-accent/60"
                              }`}
                              onClick={() => {
                                setIcon(entry.id);
                                setIconPickerOpen(false);
                              }}
                            >
                              <ScriptIcon icon={entry.id} className="size-4" />
                              <span>{entry.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </PopoverPopup>
                  </Popover>
                  <Input
                    id="script-name"
                    autoFocus
                    placeholder="Test"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="script-keybinding">Keybinding</Label>
                <Input
                  id="script-keybinding"
                  placeholder="Press shortcut"
                  value={keybinding}
                  readOnly
                  onKeyDown={captureKeybinding}
                />
                <p className="text-xs text-muted-foreground">
                  Press a shortcut. Use <code>Backspace</code> to clear.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="script-command">Command</Label>
                <Textarea
                  id="script-command"
                  placeholder="bun test"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="script-preview-url">Preview URL</Label>
                <Input
                  id="script-preview-url"
                  placeholder="http://localhost:3000"
                  value={previewUrl}
                  onChange={(event) => setPreviewUrl(event.target.value)}
                />
              </div>
              <div className="divide-y divide-border/70 rounded-md border border-border/70 text-sm">
                <ScriptOptionSwitch
                  label="Run automatically on worktree creation"
                  checked={runOnWorktreeCreate}
                  onCheckedChange={setRunOnWorktreeCreate}
                />
                {runOnWorktreeCreate && (
                  <ScriptOptionSwitch
                    label="Hold the agent until setup finishes"
                    description="Otherwise the agent starts while setup is still running."
                    checked={waitForSetup}
                    onCheckedChange={setWaitForSetup}
                  />
                )}
                <ScriptOptionSwitch
                  label="Run when the thread is marked done"
                  description="Runs in the thread's own worktree, for cleanup like deleting build output."
                  checked={runOnSettle}
                  onCheckedChange={setRunOnSettle}
                />
                <ScriptOptionSwitch
                  label="Stop when the thread is marked done"
                  description="Closes this action's terminal and its processes, such as a dev server."
                  checked={stopOnSettle}
                  onCheckedChange={setStopOnSettle}
                />
                {previewUrl.trim() !== "" && (
                  <ScriptOptionSwitch
                    label="Open the preview when the action starts"
                    checked={autoOpenPreview}
                    onCheckedChange={setAutoOpenPreview}
                  />
                )}
              </div>
              {validationError && <p className="text-sm text-destructive">{validationError}</p>}
            </form>
          </DialogPanel>
          <DialogFooter>
            {isEditing && (
              <Button
                type="button"
                variant="destructive-outline"
                className="mr-auto"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                Delete
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button form={addScriptFormId} type="submit">
              {isEditing ? "Save changes" : "Save action"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete action "{name}"?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" onClick={confirmDeleteScript}>
              Delete action
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

import re

file_path = "apps/web/src/components/ProjectWorkspaceSettingsSection.tsx"

with open(file_path, "r") as f:
    content = f.read()


# Rename createServerProcessDrafts -> createTerminalProcessDrafts
old_create_drafts = """function createServerProcessDrafts(settings: ProjectWorkspaceSettings): ServerProcessDraft[] {
  return settings.serverProcesses.map((process) => {
    const tool = settings.tools.find(
      (entry) => entry.kind === "custom_process" && entry.serverProcessId === process.id,
    );
    return {
      id: process.id,
      label: process.label,
      commands: process.commands.length > 0 ? [...process.commands] : [""],
      cwd: process.cwd,
      autoStart: process.autoStart,
      visible: tool?.visible ?? true,
      isNew: false,
      originalLabel: process.label,
      originalCommands: process.commands.length > 0 ? [...process.commands] : [""],
      originalCwd: process.cwd,
      originalAutoStart: process.autoStart,
      originalVisible: tool?.visible ?? true,
    };
  });
}"""

new_create_drafts = """function createTerminalProcessDrafts(settings: ProjectWorkspaceSettings): ServerProcessDraft[] {
  return settings.terminalProcesses.map((process) => {
    const tool = settings.tools.find(
      (entry) => entry.kind === "custom_process" && entry.terminalProcessId === process.id,
    );
    return {
      id: process.id,
      label: process.label,
      commands: process.commands.length > 0 ? [...process.commands] : [""],
      cwd: process.cwd,
      autoStart: process.autoStart,
      visible: tool?.visible ?? true,
      isNew: false,
      originalLabel: process.label,
      originalCommands: process.commands.length > 0 ? [...process.commands] : [""],
      originalCwd: process.cwd,
      originalAutoStart: process.autoStart,
      originalVisible: tool?.visible ?? true,
    };
  });
}

function createServerPresetDrafts(settings: ProjectWorkspaceSettings): ServerProcessDraft[] {
  return settings.serverPresets.map((process) => {
    return {
      id: process.id,
      label: process.label,
      commands: process.commands.length > 0 ? [...process.commands] : [""],
      cwd: process.cwd,
      autoStart: process.autoStart,
      visible: true, // Server presets don't have tools, visibility is n/a
      isNew: false,
      originalLabel: process.label,
      originalCommands: process.commands.length > 0 ? [...process.commands] : [""],
      originalCwd: process.cwd,
      originalAutoStart: process.autoStart,
      originalVisible: true,
    };
  });
}"""
content = content.replace(old_create_drafts, new_create_drafts)


# Find the component state
old_state = """  const [customEmbedDrafts, setCustomEmbedDrafts] = useState<CustomEmbedDraft[]>([]);
  const [serverProcessDrafts, setServerProcessDrafts] = useState<ServerProcessDraft[]>([]);"""

new_state = """  const [customEmbedDrafts, setCustomEmbedDrafts] = useState<CustomEmbedDraft[]>([]);
  const [terminalProcessDrafts, setTerminalProcessDrafts] = useState<ServerProcessDraft[]>([]);
  const [serverPresetDrafts, setServerPresetDrafts] = useState<ServerProcessDraft[]>([]);"""
content = content.replace(old_state, new_state)

# Replace useEffect assignments
old_effect = """    setCustomEmbedDrafts(createCustomEmbedDrafts(projectSettings));
    setServerProcessDrafts(createServerProcessDrafts(projectSettings));"""

new_effect = """    setCustomEmbedDrafts(createCustomEmbedDrafts(projectSettings));
    setTerminalProcessDrafts(createTerminalProcessDrafts(projectSettings));
    setServerPresetDrafts(createServerPresetDrafts(projectSettings));"""
content = content.replace(old_effect, new_effect)


# Fix the empty state clears
old_empty = """      setCustomEmbedDrafts([]);
      setServerProcessDrafts([]);"""
new_empty = """      setCustomEmbedDrafts([]);
      setTerminalProcessDrafts([]);
      setServerPresetDrafts([]);"""
content = content.replace(old_empty, new_empty)


# Rename updateServerProcessDraft and removeServerProcessDraft
old_update_remove = """  const updateServerProcessDraft = (draftId: string, updates: Partial<ServerProcessDraft>) => {
    setServerProcessDrafts((current) =>
      current.map((draft) => (draft.id === draftId ? { ...draft, ...updates } : draft)),
    );
  };

  const removeServerProcessDraft = (processId: string) => {
    setServerProcessDrafts((current) => current.filter((entry) => entry.id !== processId));
  };"""

new_update_remove = """  const updateTerminalProcessDraft = (draftId: string, updates: Partial<ServerProcessDraft>) => {
    setTerminalProcessDrafts((current) =>
      current.map((draft) => (draft.id === draftId ? { ...draft, ...updates } : draft)),
    );
  };

  const removeTerminalProcessDraft = (processId: string) => {
    setTerminalProcessDrafts((current) => current.filter((entry) => entry.id !== processId));
  };

  const updateServerPresetDraft = (draftId: string, updates: Partial<ServerProcessDraft>) => {
    setServerPresetDrafts((current) =>
      current.map((draft) => (draft.id === draftId ? { ...draft, ...updates } : draft)),
    );
  };

  const removeServerPresetDraft = (processId: string) => {
    setServerPresetDrafts((current) => current.filter((entry) => entry.id !== processId));
  };"""

content = content.replace(old_update_remove, new_update_remove)


# Dirty state logic
old_dirty = """  const serverProcessesDirty = useMemo(
    () => {
      if (!projectSettings) return false;
      const originalCount = projectSettings.serverProcesses.filter((process) =>
        projectSettings.tools.some(
          (t) => t.kind === "custom_process" && t.serverProcessId === process.id,
        ),
      ).length;

      return (
        serverProcessDrafts.length !== originalCount ||
        serverProcessDrafts.some(isServerProcessDraftDirty)
      );
    },
    [serverProcessDrafts, projectSettings],
  );"""

new_dirty = """  const terminalProcessesDirty = useMemo(
    () => {
      if (!projectSettings) return false;
      return (
        terminalProcessDrafts.length !== projectSettings.terminalProcesses.length ||
        terminalProcessDrafts.some(isServerProcessDraftDirty)
      );
    },
    [terminalProcessDrafts, projectSettings],
  );

  const serverPresetsDirty = useMemo(
    () => {
      if (!projectSettings) return false;
      return (
        serverPresetDrafts.length !== projectSettings.serverPresets.length ||
        serverPresetDrafts.some(isServerProcessDraftDirty)
      );
    },
    [serverPresetDrafts, projectSettings],
  );"""

content = content.replace(old_dirty, new_dirty)


# Update dirty check warning
old_dirty_check = """    if (serverProcessesDirty) {
      if (!window.confirm("You have unsaved terminal tab changes. Discard?")) {
        return false;
      }
    }"""
new_dirty_check = """    if (terminalProcessesDirty) {
      if (!window.confirm("You have unsaved terminal tab changes. Discard?")) {
        return false;
      }
    }
    if (serverPresetsDirty) {
      if (!window.confirm("You have unsaved server preset changes. Discard?")) {
        return false;
      }
    }"""
content = content.replace(old_dirty_check, new_dirty_check)

content = content.replace("serverProcessesDirty,", "terminalProcessesDirty, serverPresetsDirty,")


# saveServerProcesses -> saveTerminalProcesses
old_save_server = """  const saveServerProcesses = () => {
    upsertProjectSettings(projectId, (current) => {
      // Keep server presets (the ones made in the Server tab, not in Workspace settings)
      const customProcessIds = new Set(
        current.tools.flatMap((tool) =>
          tool.kind === "custom_process" && tool.serverProcessId != null
            ? [tool.serverProcessId]
            : [],
        ),
      );
      const serverPresets = current.serverProcesses.filter(
        (process) => !customProcessIds.has(process.id),
      );

      const validDrafts = serverProcessDrafts.filter(
        (draft) =>
          draft.label.trim().length > 0 || draft.commands.some((c) => c.trim().length > 0),
      );

      const nextServerProcesses = validDrafts.map((draft) => ({
        id: draft.id,
        label: draft.label.trim().length > 0 ? draft.label.trim() : "Untitled terminal",
        commands: draft.commands.map((c) => c.trim()).filter((c) => c.length > 0),
        cwd: draft.cwd.trim().length > 0 ? draft.cwd.trim() : current.cwd,
        env: {},
        autoStart: draft.autoStart,
      }));

      const nextServerProcessTools = validDrafts.map((draft, index) => ({
        id: createServerProcessToolId(draft.id),
        kind: "custom_process" as const,
        label:
          nextServerProcesses[index]?.label ??
          (draft.label.trim().length > 0 ? draft.label.trim() : "Untitled terminal"),
        visible: draft.visible,
        serverProcessId: draft.id,
      }));

      return {
        ...current,
        serverProcesses: [...serverPresets, ...nextServerProcesses],
        tools: mergeToolGroup(current.tools, nextServerProcessTools, "custom_process", "server"),
      };
    });
  };"""

new_save_server = """  const saveTerminalProcesses = () => {
    upsertProjectSettings(projectId, (current) => {
      const validDrafts = terminalProcessDrafts.filter(
        (draft) =>
          draft.label.trim().length > 0 || draft.commands.some((c) => c.trim().length > 0),
      );

      const nextTerminalProcesses = validDrafts.map((draft) => ({
        id: draft.id,
        label: draft.label.trim().length > 0 ? draft.label.trim() : "Untitled terminal",
        commands: draft.commands.map((c) => c.trim()).filter((c) => c.length > 0),
        cwd: draft.cwd.trim().length > 0 ? draft.cwd.trim() : current.cwd,
        env: {},
        autoStart: draft.autoStart,
      }));

      const nextTerminalProcessTools = validDrafts.map((draft, index) => ({
        id: createServerProcessToolId(draft.id),
        kind: "custom_process" as const,
        label:
          nextTerminalProcesses[index]?.label ??
          (draft.label.trim().length > 0 ? draft.label.trim() : "Untitled terminal"),
        visible: draft.visible,
        terminalProcessId: draft.id,
      }));

      return {
        ...current,
        terminalProcesses: nextTerminalProcesses,
        tools: mergeToolGroup(current.tools, nextTerminalProcessTools, "custom_process", "server"),
      };
    });
  };

  const saveServerPresets = () => {
    upsertProjectSettings(projectId, (current) => {
      const validDrafts = serverPresetDrafts.filter(
        (draft) =>
          draft.label.trim().length > 0 || draft.commands.some((c) => c.trim().length > 0),
      );

      const nextServerPresets = validDrafts.map((draft) => ({
        id: draft.id,
        label: draft.label.trim().length > 0 ? draft.label.trim() : "Untitled preset",
        commands: draft.commands.map((c) => c.trim()).filter((c) => c.length > 0),
        cwd: draft.cwd.trim().length > 0 ? draft.cwd.trim() : current.cwd,
        env: {},
        autoStart: draft.autoStart,
      }));

      return {
        ...current,
        serverPresets: nextServerPresets,
      };
    });
  };"""

content = content.replace(old_save_server, new_save_server)

# Finally, we must duplicate the Terminal Tabs UI section for Server Presets.
# The UI for Terminal Tabs looks like this:
old_terminal_ui = """        {/* Terminal Tabs */}
        <div className="flex flex-col gap-6 pt-10 border-t border-border/60">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-medium tracking-tight flex items-center gap-2">
                <TerminalIcon className="size-4 text-muted-foreground" />
                Terminal Tabs
              </h2>
              <p className="text-sm text-muted-foreground">
                Run specific commands or background processes in their own dedicated tabs.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                onClick={() => {
                  setServerProcessDrafts((current) => [
                    ...current,
                    {
                      id: createServerProcessId(),
                      label: "",
                      commands: [""],
                      cwd: projectSettings?.browser?.defaultUrl ?? "",
                      autoStart: false,
                      visible: true,
                      isNew: true,
                      originalLabel: "",
                      originalCommands: [""],
                      originalCwd: projectSettings?.browser?.defaultUrl ?? "",
                      originalAutoStart: false,
                      originalVisible: true,
                    },
                  ]);
                }}
                size="sm"
                variant="outline"
              >
                <PlusIcon className="size-3.5" />
                Add Tab
              </Button>
              <Button onClick={saveServerProcesses} disabled={!serverProcessesDirty}>
                Save Tabs
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 relative">
            {serverProcessDrafts.length > 0 ? (
              serverProcessDrafts.map((draft, index) => (
                <div
                  key={draft.id}
                  className={cn(
                    "flex flex-col gap-4 p-4 rounded-xl border",
                    draft.isNew ? "border-primary/40 bg-primary/5" : "border-border/80 bg-card",
                  )}
                >
                  {/* Top row: Label & Visibility */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-1 items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted/50 border border-border/40 text-muted-foreground shrink-0">
                        {index + 1}
                      </div>
                      <div className="flex-1 max-w-sm">
                        <Input
                          value={draft.label}
                          onChange={(event) =>
                            updateServerProcessDraft(draft.id, { label: event.target.value })
                          }
                          placeholder="Tab Name (e.g., Frontend Server)"
                          className={cn(
                            "h-9 font-medium",
                            draft.label.trim().length === 0
                              ? "border-destructive focus-visible:ring-destructive"
                              : "",
                          )}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
                        <Switch
                          checked={draft.autoStart}
                          onCheckedChange={(checked) =>
                            updateServerProcessDraft(draft.id, { autoStart: checked })
                          }
                        />
                        <span className="text-sm font-medium select-none whitespace-nowrap">
                          Auto-start
                        </span>
                      </label>
                      <div className="w-px h-5 bg-border/80" />
                      <label className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
                        <Switch
                          checked={draft.visible}
                          onCheckedChange={(checked) =>
                            updateServerProcessDraft(draft.id, { visible: checked })
                          }
                        />
                        <span className="text-sm font-medium select-none whitespace-nowrap">
                          Show in Toolbar
                        </span>
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive shrink-0 -mr-2"
                        onClick={() => removeServerProcessDraft(draft.id)}
                      >
                        <TrashIcon className="size-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Commands */}
                  <div className="flex flex-col gap-2 pl-11">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Commands
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs -mr-2"
                        onClick={() => {
                          updateServerProcessDraft(draft.id, {
                            commands: [...draft.commands, ""],
                          });
                        }}
                      >
                        <PlusIcon className="size-3 mr-1" />
                        Add Command
                      </Button>
                    </div>
                    <div className="flex flex-col gap-2">
                      {draft.commands.map((command, cmdIndex) => (
                        <div key={cmdIndex} className="flex gap-2">
                          <div className="relative flex-1">
                            <div className="absolute left-3 top-2.5 text-muted-foreground">
                              <TerminalSquareIcon className="size-4" />
                            </div>
                            <Input
                              value={command}
                              onChange={(event) => {
                                const newCommands = [...draft.commands];
                                newCommands[cmdIndex] = event.target.value;
                                updateServerProcessDraft(draft.id, { commands: newCommands });
                              }}
                              placeholder="npm run dev"
                              className={cn(
                                "pl-9 font-mono text-sm",
                                draft.commands.length === 1 && command.trim().length === 0
                                  ? "border-destructive focus-visible:ring-destructive"
                                  : "",
                              )}
                            />
                          </div>
                          {draft.commands.length > 1 && (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="shrink-0 text-muted-foreground"
                              onClick={() => {
                                const newCommands = [...draft.commands];
                                newCommands.splice(cmdIndex, 1);
                                updateServerProcessDraft(draft.id, { commands: newCommands });
                              }}
                            >
                              <XIcon className="size-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-border/70 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                No custom terminal tabs configured yet
              </div>
            )}
            
            {/* Dirty warning floating action */}
            {serverProcessesDirty && (
              <div className="absolute -bottom-16 left-0 right-0 flex justify-center animate-in slide-in-from-top-2 fade-in duration-200">
                <div className="flex items-center gap-3 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-medium text-primary shadow-sm backdrop-blur-sm">
                  <div className="size-2 rounded-full bg-primary animate-pulse" />
                  You have unsaved changes
                </div>
              </div>
            )}
          </div>
        </div>"""

new_terminal_ui = old_terminal_ui.replace("setServerProcessDrafts", "setTerminalProcessDrafts").replace("serverProcessDrafts", "terminalProcessDrafts").replace("updateServerProcessDraft", "updateTerminalProcessDraft").replace("removeServerProcessDraft", "removeTerminalProcessDraft").replace("saveServerProcesses", "saveTerminalProcesses").replace("serverProcessesDirty", "terminalProcessesDirty")

# Now generate the server presets UI identically
new_server_presets_ui = old_terminal_ui.replace("Terminal Tabs", "Server Presets").replace("TerminalIcon", "ServerIcon").replace("Run specific commands or background processes in their own dedicated tabs.", "One-click launch configurations that you can run from the Server menu.").replace("setServerProcessDrafts", "setServerPresetDrafts").replace("serverProcessDrafts", "serverPresetDrafts").replace("updateServerProcessDraft", "updateServerPresetDraft").replace("removeServerProcessDraft", "removeServerPresetDraft").replace("saveServerProcesses", "saveServerPresets").replace("serverProcessesDirty", "serverPresetsDirty").replace("Save Tabs", "Save Presets").replace("Add Tab", "Add Preset").replace("No custom terminal tabs configured yet", "No server presets configured yet").replace("terminal tab changes", "server preset changes")

# Add the new UI after the terminal UI
content = content.replace(old_terminal_ui, new_terminal_ui + "\n\n" + new_server_presets_ui)

with open(file_path, "w") as f:
    f.write(content)

print("ProjectWorkspaceSettingsSection.tsx updated successfully.")

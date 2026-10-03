import re

file_path = "apps/web/src/components/ProjectWorkspaceSettingsSection.tsx"

with open(file_path, "r") as f:
    content = f.read()

# 1. Draft Creators
old_draft_creators = """function createServerProcessDrafts(settings: ProjectWorkspaceSettings): ServerProcessDraft[] {
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

new_draft_creators = """function createTerminalProcessDrafts(settings: ProjectWorkspaceSettings): ServerProcessDraft[] {
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
      visible: true,
      isNew: false,
      originalLabel: process.label,
      originalCommands: process.commands.length > 0 ? [...process.commands] : [""],
      originalCwd: process.cwd,
      originalAutoStart: process.autoStart,
      originalVisible: true,
    };
  });
}"""

content = content.replace(old_draft_creators, new_draft_creators)

# 2. State Hooks
content = content.replace(
    "const [serverProcessDrafts, setServerProcessDrafts] = useState<ServerProcessDraft[]>([]);",
    "const [terminalProcessDrafts, setTerminalProcessDrafts] = useState<ServerProcessDraft[]>([]);\n  const [serverPresetDrafts, setServerPresetDrafts] = useState<ServerProcessDraft[]>([]);"
)

# 3. confirmToggle
old_confirm_toggle = """    } else if (toolKind === "custom_process") {
      setServerProcessDrafts((current) =>
        current.map((entry) =>
          createServerProcessToolId(entry.id) === toolId
            ? { ...entry, visible: nextVisible, originalVisible: nextVisible }
            : entry,
        ),
      );
    }"""
new_confirm_toggle = """    } else if (toolKind === "custom_process") {
      setTerminalProcessDrafts((current) =>
        current.map((entry) =>
          createServerProcessToolId(entry.id) === toolId
            ? { ...entry, visible: nextVisible, originalVisible: nextVisible }
            : entry,
        ),
      );
    }"""
content = content.replace(old_confirm_toggle, new_confirm_toggle)

# 4. useEffect synchronization
old_use_effect = """    setCustomEmbedDrafts(createCustomEmbedDrafts(projectSettings));
    setServerProcessDrafts(createServerProcessDrafts(projectSettings));
  }, [projectSettings]);"""
new_use_effect = """    setCustomEmbedDrafts(createCustomEmbedDrafts(projectSettings));
    setTerminalProcessDrafts(createTerminalProcessDrafts(projectSettings));
    setServerPresetDrafts(createServerPresetDrafts(projectSettings));
  }, [projectSettings]);"""
content = content.replace(old_use_effect, new_use_effect)

old_empty_effect = """      setCustomEmbedDrafts([]);
      setServerProcessDrafts([]);
    };"""
new_empty_effect = """      setCustomEmbedDrafts([]);
      setTerminalProcessDrafts([]);
      setServerPresetDrafts([]);
    };"""
content = content.replace(old_empty_effect, new_empty_effect)

# 5. Dirty tracking
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

# 6. Dirty checks (Router)
old_router_dirty = """    if (serverProcessesDirty) {
      if (!window.confirm("You have unsaved terminal tab changes. Discard?")) {
        return false;
      }
    }"""
new_router_dirty = """    if (terminalProcessesDirty) {
      if (!window.confirm("You have unsaved terminal tab changes. Discard?")) {
        return false;
      }
    }
    if (serverPresetsDirty) {
      if (!window.confirm("You have unsaved server preset changes. Discard?")) {
        return false;
      }
    }"""
content = content.replace(old_router_dirty, new_router_dirty)

content = content.replace("customEmbedsDirty, serverProcessesDirty,", "customEmbedsDirty, terminalProcessesDirty, serverPresetsDirty,")

# 7. Handlers & buildCustomProcessToolsFromDrafts
old_save_handlers = """  const updateServerProcessDraft = (draftId: string, updates: Partial<ServerProcessDraft>) => {
    setServerProcessDrafts((current) =>
      current.map((draft) => (draft.id === draftId ? { ...draft, ...updates } : draft)),
    );
  };

  const removeServerProcessDraft = (processId: string) => {
    setServerProcessDrafts((current) => current.filter((entry) => entry.id !== processId));
  };

  const buildCustomProcessToolsFromDrafts = (
    drafts: ServerProcessDraft[],
  ): ProjectToolDefinition[] => {
    const validDrafts = drafts.filter(
      (draft) => draft.label.trim().length > 0 || draft.commands.some((c) => c.trim().length > 0),
    );

    return validDrafts.map((draft) => ({
      id: createServerProcessToolId(draft.id),
      kind: "custom_process" as const,
      label: draft.label.trim().length > 0 ? draft.label.trim() : "Untitled terminal",
      visible: draft.visible,
      serverProcessId: draft.id,
    }));
  };

  const saveServerProcesses = () => {
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

      return {
        ...current,
        serverProcesses: [...serverPresets, ...nextServerProcesses],
        tools: mergeToolGroup(
          current.tools,
          buildCustomProcessToolsFromDrafts(serverProcessDrafts),
          "custom_process",
          "server",
        ),
      };
    });
  };"""

new_save_handlers = """  const updateTerminalProcessDraft = (draftId: string, updates: Partial<ServerProcessDraft>) => {
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
  };

  const buildCustomProcessToolsFromDrafts = (
    drafts: ServerProcessDraft[],
  ): ProjectToolDefinition[] => {
    const validDrafts = drafts.filter(
      (draft) => draft.label.trim().length > 0 || draft.commands.some((c) => c.trim().length > 0),
    );

    return validDrafts.map((draft) => ({
      id: createServerProcessToolId(draft.id),
      kind: "custom_process" as const,
      label: draft.label.trim().length > 0 ? draft.label.trim() : "Untitled terminal",
      visible: draft.visible,
      terminalProcessId: draft.id,
    }));
  };

  const saveTerminalProcesses = () => {
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

      return {
        ...current,
        terminalProcesses: nextTerminalProcesses,
        tools: mergeToolGroup(
          current.tools,
          buildCustomProcessToolsFromDrafts(terminalProcessDrafts),
          "custom_process",
          "server",
        ),
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
content = content.replace(old_save_handlers, new_save_handlers)

# 8. UI Section duplication
# We find the string <TerminalIcon className="size-4 text-muted-foreground" />
# It starts from {/* Terminal Tabs */} up to the end of that block.
# Since the block is very large, we can use a regex to capture it.
terminal_ui_pattern = r'\{\/\* Terminal Tabs \*\/\}.*?(?=\{\/\* Browser Tabs \*\/\})'
match = re.search(terminal_ui_pattern, content, re.DOTALL)
if match:
    old_terminal_ui = match.group(0)
    
    new_terminal_ui = old_terminal_ui.replace("setServerProcessDrafts", "setTerminalProcessDrafts").replace("serverProcessDrafts", "terminalProcessDrafts").replace("updateServerProcessDraft", "updateTerminalProcessDraft").replace("removeServerProcessDraft", "removeTerminalProcessDraft").replace("saveServerProcesses", "saveTerminalProcesses").replace("serverProcessesDirty", "terminalProcessesDirty")
    
    new_server_presets_ui = old_terminal_ui.replace("Terminal Tabs", "Server Presets").replace("TerminalIcon", "ServerIcon").replace("Run specific commands or background processes in their own dedicated tabs.", "One-click launch configurations that you can run from the Server menu.").replace("setServerProcessDrafts", "setServerPresetDrafts").replace("serverProcessDrafts", "serverPresetDrafts").replace("updateServerProcessDraft", "updateServerPresetDraft").replace("removeServerProcessDraft", "removeServerPresetDraft").replace("saveServerProcesses", "saveServerPresets").replace("serverProcessesDirty", "serverPresetsDirty").replace("Save Tabs", "Save Presets").replace("Add Tab", "Add Preset").replace("No custom terminal tabs configured yet", "No server presets configured yet").replace("terminal tab changes", "server preset changes")

    # In server presets UI, there is no "Show in Toolbar" switch. We should remove it.
    # The block is:
    show_in_toolbar_pattern = r'<div className="w-px h-5 bg-border/80" />.*?<label className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">.*?<Switch.*?checked=\{draft\.visible\}.*?/>.*?<span className="text-sm font-medium select-none whitespace-nowrap">.*?Show in Toolbar.*?</span>.*?</label>'
    new_server_presets_ui = re.sub(show_in_toolbar_pattern, '', new_server_presets_ui, flags=re.DOTALL)

    content = content.replace(old_terminal_ui, new_terminal_ui + "\n\n        " + new_server_presets_ui)

with open(file_path, "w") as f:
    f.write(content)

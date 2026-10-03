import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectId, ThreadId } from "@tabs/contracts";
import { PanelRightCloseIcon, PlayIcon, SaveIcon, TerminalIcon } from "lucide-react";
import ThreadTerminalDrawer from "~/components/ThreadTerminalDrawer";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ensureNativeApi } from "~/nativeApi";

type TestingTerminalPreset = "single" | "all" | "report";
type TestingTerminalCommands = Record<TestingTerminalPreset, string>;

const DEFAULT_COMMANDS: TestingTerminalCommands = {
  single: "npx playwright test --grep {id}",
  all: "npx playwright test",
  report: "npx playwright show-report",
};

function storageKey(projectId: ProjectId) {
  return `tabs.testing.terminal.commands.${projectId}`;
}

export function TestingTerminalDock(props: {
  projectId: ProjectId;
  projectPath: string;
  onClose: () => void;
}) {
  const threadId = `testing:${props.projectId}` as ThreadId;
  const terminalId = "testing-shell";
  const [focusRequestId, setFocusRequestId] = useState(0);
  const [caseId, setCaseId] = useState("");
  const [showConfiguration, setShowConfiguration] = useState(false);
  const [commands, setCommands] = useState<TestingTerminalCommands>(DEFAULT_COMMANDS);
  const [announcement, setAnnouncement] = useState("Testing terminal opened.");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey(props.projectId));
      if (stored) setCommands({ ...DEFAULT_COMMANDS, ...JSON.parse(stored) });
    } catch {
      setCommands(DEFAULT_COMMANDS);
    }
  }, [props.projectId]);

  const terminalGroups = useMemo(
    () => [{ id: "testing-terminal-group", terminalIds: [terminalId] }],
    [],
  );

  const runCommand = useCallback(
    async (preset: TestingTerminalPreset) => {
      const command = commands[preset].replaceAll("{id}", caseId.trim());
      if (preset === "single" && !caseId.trim()) {
        setAnnouncement("Enter a test case ID before running one test.");
        return;
      }
      const api = ensureNativeApi();
      await api.terminal.open({
        threadId,
        terminalId,
        cwd: props.projectPath,
        cols: 100,
        rows: 24,
      });
      await api.terminal.write({ threadId, terminalId, data: `${command}\r` });
      setFocusRequestId((value) => value + 1);
      setAnnouncement(`Running: ${command}`);
    },
    [caseId, commands, props.projectPath, terminalId, threadId],
  );

  const saveCommands = () => {
    window.localStorage.setItem(storageKey(props.projectId), JSON.stringify(commands));
    setShowConfiguration(false);
    setAnnouncement("Testing terminal presets saved for this project.");
  };

  return (
    <section
      id="testing-terminal-dock"
      className="absolute inset-y-0 right-0 z-40 flex w-[min(42rem,calc(100%-1rem))] min-w-0 flex-col overflow-hidden border-l border-border/80 bg-background shadow-[-18px_0_44px_rgba(0,0,0,0.18)] sm:w-[min(42rem,72vw)] lg:w-[min(42rem,48vw)]"
      aria-labelledby="testing-terminal-heading"
    >
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-3 py-2.5">
        <div className="mr-auto flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md border border-border/70 bg-background">
            <TerminalIcon aria-hidden="true" className="size-3.5" />
          </span>
          <div className="min-w-0">
            <h2 id="testing-terminal-heading" className="text-sm font-semibold leading-tight">
              Testing terminal
            </h2>
            <p
              className="max-w-72 truncate text-[11px] text-muted-foreground"
              title={props.projectPath}
            >
              {props.projectPath}
            </p>
          </div>
        </div>
        <label htmlFor="testing-terminal-case-id" className="sr-only">
          Test case ID
        </label>
        <Input
          id="testing-terminal-case-id"
          value={caseId}
          onChange={(event) => setCaseId(event.target.value)}
          placeholder="Test ID, for example TC-0001"
          className="h-8 w-56"
        />
        <Button type="button" size="sm" variant="outline" onClick={() => void runCommand("single")}>
          <PlayIcon aria-hidden="true" />
          Run ID
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void runCommand("all")}>
          Run all
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void runCommand("report")}>
          Open report
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setShowConfiguration((value) => !value)}
          aria-expanded={showConfiguration}
          aria-controls="testing-terminal-preset-settings"
        >
          Configure presets
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={props.onClose}
          aria-label="Collapse testing terminal"
        >
          <PanelRightCloseIcon aria-hidden="true" />
        </Button>
      </div>
      {showConfiguration ? (
        <div
          id="testing-terminal-preset-settings"
          className="grid gap-3 border-b border-border bg-muted/10 p-3 xl:grid-cols-3"
        >
          {(["single", "all", "report"] as const).map((preset) => (
            <div key={preset} className="space-y-1">
              <label
                htmlFor={`testing-command-${preset}`}
                className="text-xs font-medium capitalize"
              >
                {preset === "single"
                  ? "Run one test"
                  : preset === "all"
                    ? "Run all tests"
                    : "View report"}
              </label>
              <Input
                id={`testing-command-${preset}`}
                value={commands[preset]}
                onChange={(event) =>
                  setCommands((current) => ({ ...current, [preset]: event.target.value }))
                }
                className="h-8 font-mono text-xs"
              />
            </div>
          ))}
          <div className="flex items-end xl:col-span-3">
            <p className="mr-auto text-xs text-muted-foreground">
              Use <code>{"{id}"}</code> where the entered test ID should be inserted.
            </p>
            <Button type="button" size="sm" onClick={saveCommands}>
              <SaveIcon aria-hidden="true" />
              Save presets
            </Button>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 p-1.5">
        <div className="h-full overflow-hidden rounded-lg border border-border/70 bg-background">
          <ThreadTerminalDrawer
            variant="embedded"
            showControls={false}
            threadId={threadId}
            cwd={props.projectPath}
            height={400}
            terminalIds={[terminalId]}
            activeTerminalId={terminalId}
            terminalGroups={terminalGroups}
            activeTerminalGroupId="testing-terminal-group"
            focusRequestId={focusRequestId}
            terminalLabels={{ [terminalId]: "Testing" }}
            onSplitTerminal={() => {}}
            onNewTerminal={() => {}}
            onActiveTerminalChange={() => {}}
            onCloseTerminal={props.onClose}
            onHeightChange={() => {}}
            onAddTerminalContext={() => {}}
          />
        </div>
      </div>
    </section>
  );
}

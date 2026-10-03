import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { useDebouncedValue } from "@tanstack/react-pacer";

import { useActiveProjectTarget, type ActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useTheme } from "~/hooks/useTheme";
import { useWorkspaceShellStore } from "~/workspaceShellStore";
import { useKeybindings } from "~/state/settings";
import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";

import { VscodeEntryIcon } from "../chat/VscodeEntryIcon";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { type CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteResults } from "../CommandPaletteResults";
import {
  getProjectFilePickerMatches,
  PROJECT_FILE_PICKER_RESULT_LIMIT,
} from "./ProjectFilePicker.logic";

interface ProjectFilePickerProps {
  readonly setOpen: (open: boolean) => void;
}

function HighlightedFuzzyText(props: {
  readonly active: boolean;
  readonly indices: ReadonlyArray<number>;
  readonly value: string;
}) {
  if (!props.active) return props.value;

  const parts: ReactNode[] = [];
  let start = 0;
  for (const index of props.indices) {
    if (start < index) parts.push(props.value.slice(start, index));
    parts.push(
      <strong className="font-semibold text-foreground" key={index}>
        {props.value[index]}
      </strong>,
    );
    start = index + 1;
  }
  if (start < props.value.length) parts.push(props.value.slice(start));

  return <span className="text-muted-foreground">{parts}</span>;
}

function getEmptyStateMessage(query: string, error: string | null, isPending: boolean): string {
  if (error) return error;
  const isSearching = query.trim().length > 0;
  if (isPending) return isSearching ? "Searching workspace files…" : "Indexing workspace files…";
  return isSearching ? "No matching files." : "No files found.";
}

function EmptyProjectFilePicker() {
  return (
    <CommandPaletteContent
      aria-label="File picker"
      escapeLabel="Back"
      footerActionLabel="Open file"
      inputProps={{ disabled: true, placeholder: "Search files…" }}
      mode="none"
      testId="project-file-picker"
      value=""
    >
      <div className="py-10 text-center text-sm text-muted-foreground">
        Open a project to search its files.
      </div>
    </CommandPaletteContent>
  );
}

const FILE_PICKER_DEBOUNCE_MS = 80;

function OpenProjectFilePicker(props: ProjectFilePickerProps & { target: ActiveProjectTarget }) {
  const { target } = props;
  const [query, setQuery] = useState("");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);

  const [debouncedQuery, debouncer] = useDebouncedValue(
    query,
    { wait: FILE_PICKER_DEBOUNCE_MS },
    (state) => ({ isPending: state.isPending }),
  );

  const searchResult = useQuery(
    projectSearchEntriesQueryOptions({
      environmentId: target.environmentId,
      cwd: target.cwd,
      query: debouncedQuery,
      limit: PROJECT_FILE_PICKER_RESULT_LIMIT,
      kind: "file",
      enabled: true,
    }),
  );

  const { resolvedTheme } = useTheme();
  const keybindings = useKeybindings();
  const entries = searchResult.data?.entries ?? [];
  const matches = useMemo(
    () => getProjectFilePickerMatches(entries, debouncedQuery),
    [entries, debouncedQuery],
  );
  const hasMatchedQuery = /\S/.test(debouncedQuery);

  const items = useMemo<CommandPaletteActionItem[]>(
    () =>
      matches.map((match) => ({
        kind: "action",
        value: `file:${match.path}`,
        searchTerms: [match.name, match.path],
        title: (
          <HighlightedFuzzyText
            active={hasMatchedQuery}
            value={match.name}
            indices={match.nameMatchIndices}
          />
        ),
        description: (
          <HighlightedFuzzyText
            active={hasMatchedQuery}
            value={match.path}
            indices={match.pathMatchIndices}
          />
        ),
        icon: <VscodeEntryIcon pathValue={match.path} kind="file" theme={resolvedTheme} />,
        run: async () => {
          useWorkspaceShellStore.getState().setActiveTool(target.projectId, "code");
          useWorkspaceShellStore.getState().setCodeFocusedPath(target.projectId, match.path);
          if (window.desktopBridge?.openCodeFile) {
            void window.desktopBridge
              .openCodeFile({
                projectId: target.projectId,
                relativePath: match.path,
                navigationNonce: Date.now(),
              })
              .catch(() => undefined);
          }
        },
      })),
    [hasMatchedQuery, matches, resolvedTheme, target.projectId],
  );

  const isPending = debouncer.state.isPending || searchResult.isFetching;
  const errorMessage = searchResult.error
    ? ((searchResult.error as Error).message ?? "Search failed")
    : null;
  const emptyStateMessage = getEmptyStateMessage(query, errorMessage, isPending);

  return (
    <CommandPaletteContent
      aria-label="File picker"
      autoHighlight="always"
      escapeLabel="Back"
      footerActionLabel="Open file"
      inputProps={{ placeholder: "Search files…" }}
      mode="none"
      onItemHighlighted={(value) => {
        setHighlightedItemValue(typeof value === "string" ? value : null);
      }}
      onValueChange={(value) => {
        setHighlightedItemValue(null);
        setQuery(value);
      }}
      panelClassName="max-h-[min(34rem,76vh)]"
      testId="project-file-picker"
      value={query}
    >
      <CommandPaletteResults
        groups={
          items.length > 0 ? [{ value: "project-files", label: target.projectName, items }] : []
        }
        highlightedItemValue={highlightedItemValue}
        isActionsOnly={false}
        keybindings={keybindings}
        onExecuteItem={(item) => {
          if (item.kind !== "action") return;
          props.setOpen(false);
          void item.run();
        }}
        emptyStateMessage={emptyStateMessage}
      />
    </CommandPaletteContent>
  );
}

export function ProjectFilePicker(props: ProjectFilePickerProps) {
  const target = useActiveProjectTarget();

  if (!target) {
    return <EmptyProjectFilePicker />;
  }

  return (
    <OpenProjectFilePicker
      key={`${target.environmentId}:${target.cwd}`}
      target={target}
      setOpen={props.setOpen}
    />
  );
}

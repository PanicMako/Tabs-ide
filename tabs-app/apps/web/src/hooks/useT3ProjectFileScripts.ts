import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  T3_PROJECT_FILE_NAME,
  type T3ProjectFile,
  type T3ProjectFileScript,
} from "@tabs/contracts";
import { parseT3ProjectFile } from "@tabs/shared/t3ProjectFile";
import { projectReadFileQueryOptions } from "../lib/projectReactQuery";

const NO_SCRIPTS: ReadonlyArray<T3ProjectFileScript> = [];

export interface T3ProjectFileState {
  status: "loading" | "missing" | "invalid" | "valid";
  file: T3ProjectFile | null;
  scripts: ReadonlyArray<T3ProjectFileScript>;
}

export function useT3ProjectFileState(
  environmentId: string | undefined,
  cwd: string | null,
): T3ProjectFileState {
  const query = useQuery({
    ...projectReadFileQueryOptions({
      environmentId,
      cwd,
      relativePath: T3_PROJECT_FILE_NAME,
      staleTime: 5_000,
    }),
    // Script definitions must never use the previous machine/worktree as placeholder data.
    placeholderData: () => undefined,
    retry: false,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const file = useMemo(
    () => (query.data && !query.data.truncated ? parseT3ProjectFile(query.data.contents) : null),
    [query.data],
  );
  if (!cwd || query.isError) return { status: "missing", file: null, scripts: NO_SCRIPTS };
  if (query.isPending) return { status: "loading", file: null, scripts: NO_SCRIPTS };
  if (!file) return { status: "invalid", file: null, scripts: NO_SCRIPTS };
  return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS };
}

export function useT3ProjectFileScripts(
  environmentId: string | undefined,
  cwd: string | null,
): ReadonlyArray<T3ProjectFileScript> {
  return useT3ProjectFileState(environmentId, cwd).scripts;
}

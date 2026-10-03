import type {
  ProjectReadFileResult,
  ProjectSearchContentsResult,
  ProjectSearchEntriesResult,
} from "@tabs/contracts";
import { queryOptions } from "@tanstack/react-query";
import { environmentApi } from "~/connection/environmentApiRegistry";

export const projectQueryKeys = {
  all: ["projects"] as const,
  searchEntries: (environmentId: string | null, cwd: string | null, query: string, limit: number) =>
    ["projects", environmentId, "search-entries", cwd, query, limit] as const,
  searchContents: (
    environmentId: string | null,
    cwd: string | null,
    query: string,
    caseSensitive: boolean,
    wholeWord: boolean,
    useRegex: boolean,
    limit: number,
  ) =>
    [
      "projects",
      environmentId,
      "search-contents",
      cwd,
      query,
      caseSensitive,
      wholeWord,
      useRegex,
      limit,
    ] as const,
  readFile: (environmentId: string | null, cwd: string | null, relativePath: string | null) =>
    ["projects", environmentId, "read-file", cwd, relativePath] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const DEFAULT_SEARCH_CONTENTS_LIMIT = 500;
const DEFAULT_SEARCH_CONTENTS_STALE_TIME = 15_000;
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};
const EMPTY_SEARCH_CONTENTS_RESULT: ProjectSearchContentsResult = {
  matches: [],
  truncated: false,
};
const EMPTY_READ_FILE_RESULT: ProjectReadFileResult = {
  relativePath: "",
  contents: "",
  byteLength: 0,
  truncated: false,
};

export function projectSearchEntriesQueryOptions(input: {
  cwd: string | null;
  query: string;
  kind?: "file" | "directory" | undefined;
  imageOnly?: boolean | undefined;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
  environmentId?: string | null | undefined;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: [
      ...projectQueryKeys.searchEntries(input.environmentId ?? null, input.cwd, input.query, limit),
      input.kind ?? null,
      input.imageOnly ?? null,
    ] as const,
    queryFn: async () => {
      const api = await environmentApi(input.environmentId);
      if (!input.cwd) {
        throw new Error("Workspace entry search is unavailable.");
      }
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.query,
        limit,
        ...(input.kind ? { kind: input.kind } : {}),
        ...(input.imageOnly !== undefined ? { imageOnly: input.imageOnly } : {}),
      });
    },
    enabled: (input.enabled ?? input.query.length > 0) && input.cwd !== null,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}

export function projectReadFileQueryOptions(input: {
  cwd: string | null;
  relativePath: string | null;
  enabled?: boolean;
  staleTime?: number;
  environmentId?: string | null | undefined;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.readFile(input.environmentId ?? null, input.cwd, input.relativePath),
    queryFn: async () => {
      const api = await environmentApi(input.environmentId);
      if (!input.cwd || !input.relativePath) {
        throw new Error("Workspace file read is unavailable.");
      }
      return api.projects.readFile({
        cwd: input.cwd,
        relativePath: input.relativePath,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.relativePath !== null,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_READ_FILE_RESULT,
  });
}

export function projectSearchContentsQueryOptions(input: {
  cwd: string | null;
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  useRegex?: boolean;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
  environmentId?: string | null | undefined;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_CONTENTS_LIMIT;
  const caseSensitive = input.caseSensitive ?? false;
  const wholeWord = input.wholeWord ?? false;
  const useRegex = input.useRegex ?? false;
  return queryOptions({
    queryKey: projectQueryKeys.searchContents(
      input.environmentId ?? null,
      input.cwd,
      input.query,
      caseSensitive,
      wholeWord,
      useRegex,
      limit,
    ),
    queryFn: async () => {
      const api = await environmentApi(input.environmentId);
      if (!input.cwd) {
        throw new Error("Workspace content search is unavailable.");
      }
      return api.projects.searchContents({
        cwd: input.cwd,
        query: input.query,
        caseSensitive,
        wholeWord,
        useRegex,
        limit,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.query.trim().length > 0,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_CONTENTS_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_CONTENTS_RESULT,
  });
}

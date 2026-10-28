import { useEffect, useState } from "react";
import {
  T3_PROJECT_FILE_NAME,
  type T3ProjectFile,
  type T3ProjectFileScript,
} from "@tabs/contracts";
import { parseT3ProjectFile } from "@tabs/shared/t3ProjectFile";
import { environmentApi } from "../connection/environmentApiRegistry";

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
  const [entry, setEntry] = useState<{ key: string; state: T3ProjectFileState }>({
    key: "",
    state: { status: "missing", file: null, scripts: NO_SCRIPTS },
  });
  const key = JSON.stringify([environmentId, cwd]);

  useEffect(() => {
    const setState = (state: T3ProjectFileState) => setEntry({ key, state });
    if (!cwd) {
      setState({ status: "missing", file: null, scripts: NO_SCRIPTS });
      return;
    }

    let cancelled = false;
    setState({ status: "loading", file: null, scripts: NO_SCRIPTS });

    environmentApi(environmentId)
      .then((api) => api.projects.readFile({ cwd, relativePath: T3_PROJECT_FILE_NAME }))
      .then((res) => {
        if (cancelled) return;
        if (res.truncated) {
          setState({ status: "invalid", file: null, scripts: NO_SCRIPTS });
          return;
        }
        const parsed = parseT3ProjectFile(res.contents);
        if (!parsed) {
          setState({ status: "invalid", file: null, scripts: NO_SCRIPTS });
        } else {
          setState({
            status: "valid",
            file: parsed,
            scripts: parsed.scripts ?? NO_SCRIPTS,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "missing", file: null, scripts: NO_SCRIPTS });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [environmentId, cwd, key]);

  return entry.key === key ? entry.state : { status: "loading", file: null, scripts: NO_SCRIPTS };
}

export function useT3ProjectFileScripts(
  environmentId: string | undefined,
  cwd: string | null,
): ReadonlyArray<T3ProjectFileScript> {
  return useT3ProjectFileState(environmentId, cwd).scripts;
}

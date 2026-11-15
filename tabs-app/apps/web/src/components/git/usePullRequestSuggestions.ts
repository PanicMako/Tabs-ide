import type { NativeApi, ProjectId } from "@tabs/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

interface Target {
  readonly api: NativeApi | null;
  readonly projectId: ProjectId | null;
  /** `owner/name`, as the host names it. */
  readonly repository: string;
  readonly host?: string | undefined;
}

/**
 * Names the host offers for the reviewer, label and author fields. Each list is read the first
 * time its field asks and again only when the pull request or query changes, and a failure leaves
 * the field a plain text box, since typing a name is never limited to what was offered.
 */
export function usePullRequestSuggestions(target: Target, number: number | null) {
  const [reviewers, setReviewers] = useState<ReadonlyArray<string>>([]);
  const [labels, setLabels] = useState<ReadonlyArray<string>>([]);
  const [authors, setAuthors] = useState<ReadonlyArray<string>>([]);
  const asked = useRef(new Set<string>());
  const key = `${target.repository}#${number ?? ""}`;

  // A different pull request starts with nothing offered and nothing asked.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears suggestions when the pull request changes
  useEffect(() => {
    asked.current = new Set();
    setReviewers([]);
    setLabels([]);
  }, [key]);

  const ref = useCallback(
    () =>
      target.api && target.projectId && target.repository && number !== null
        ? {
            api: target.api,
            input: {
              projectId: target.projectId,
              repository: target.repository,
              ...(target.host ? { host: target.host } : {}),
              number,
            },
          }
        : null,
    [target.api, target.projectId, target.repository, target.host, number],
  );

  const requestReviewers = useCallback(() => {
    const resolved = ref();
    if (!resolved || asked.current.has("reviewers")) return;
    asked.current.add("reviewers");
    void resolved.api.pullRequests
      .reviewerCandidates(resolved.input)
      .then((list) =>
        setReviewers(
          list.candidates.filter((candidate) => !candidate.isRequested).map((c) => c.login),
        ),
      )
      .catch(() => asked.current.delete("reviewers"));
  }, [ref]);

  const requestLabels = useCallback(() => {
    const resolved = ref();
    if (!resolved || asked.current.has("labels")) return;
    asked.current.add("labels");
    void resolved.api.pullRequests
      .labelCandidates(resolved.input)
      .then((list) =>
        setLabels(list.candidates.filter((candidate) => !candidate.isApplied).map((c) => c.name)),
      )
      .catch(() => asked.current.delete("labels"));
  }, [ref]);

  const requestAuthors = useCallback(
    (query: string) => {
      if (!target.api || !target.projectId || !target.repository) return;
      void target.api.pullRequests
        .authorCandidates({
          projectId: target.projectId,
          repository: target.repository,
          ...(target.host ? { host: target.host } : {}),
          query,
        })
        .then((list) => setAuthors(list.candidates.map((candidate) => candidate.login)))
        .catch(() => setAuthors([]));
    },
    [target.api, target.projectId, target.repository, target.host],
  );

  return { reviewers, labels, authors, requestReviewers, requestLabels, requestAuthors };
}

import type {
  NativeApi,
  ProjectId,
  PullRequestAction,
  PullRequestListEntry,
  PullRequestMergeMethod,
  PullRequestReviewCommentDraft,
  PullRequestReviewThread,
  PullRequestReviewVerdict,
} from "@tabs/contracts";
import { toastManager } from "../ui/toast";
import ChatMarkdown from "../ChatMarkdown";
import { PullRequestComposerTextarea } from "./PullRequestComposerTextarea";
import { patchLineNumbers, splitPatchByFile, type PatchFile } from "./hostPatch";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { SimpleSelect } from "../ui/simple-select";
import { Details, Summary } from "../ui/disclosure";

type StateFilter = "open" | "merged" | "closed" | "all";

const FILTERS: ReadonlyArray<{ value: StateFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "merged", label: "Merged" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

/** Hosts whose pull requests the git layer cannot read, and so are listed through the server. */
export const HOST_PULL_REQUEST_PROVIDERS: ReadonlySet<string> = new Set([
  "forgejo",
  "gitcafe",
  "cursor-origin",
]);

export function isHostPullRequestProvider(provider: string | null | undefined): boolean {
  return provider !== null && provider !== undefined && HOST_PULL_REQUEST_PROVIDERS.has(provider);
}

function hostLabel(provider: string): string {
  return provider === "gitcafe"
    ? "GitCafe"
    : provider === "cursor-origin"
      ? "Cursor Origin"
      : "Forgejo";
}

/**
 * The pull requests of a project on a host the git layer has no support for. Rows come from the
 * server's own pull-request service and open on the host; actions stay on the host's pages until
 * this surface can drive them.
 */
export function HostPullRequestsPanel({
  api,
  projectId,
  provider,
  branchName,
}: {
  api: NativeApi | null;
  projectId: ProjectId | null;
  provider: string;
  branchName: string;
}) {
  const [state, setState] = useState<StateFilter>("open");
  const [openNumber, setOpenNumber] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["host-pull-requests", projectId, state],
    enabled: api !== null && projectId !== null,
    queryFn: () => api!.pullRequests.list({ state, projectId: projectId!, limit: 50 }),
    staleTime: 15_000,
  });

  const entries: ReadonlyArray<PullRequestListEntry> = query.data?.entries ?? [];
  const failure = query.data?.errors[0]?.message ?? query.data?.providers[0]?.detail ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Pull request state" className="flex items-center gap-1">
          {FILTERS.map((filter) => (
            <Button
              key={filter.value}
              size="sm"
              variant={state === filter.value ? "secondary" : "ghost"}
              aria-pressed={state === filter.value}
              onClick={() => setState(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{hostLabel(provider)}</span>
      </div>

      {query.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading pull requests…</p>
      ) : query.isError ? (
        <p className="text-xs text-destructive-foreground">
          {query.error instanceof Error ? query.error.message : "Could not read pull requests."}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {failure ?? `No ${state === "all" ? "" : `${state} `}pull requests in this repository.`}
        </p>
      ) : (
        <ul className="space-y-1.5" aria-label="Pull requests">
          {entries.map((entry) => (
            <li
              key={`${entry.host}/${entry.repository}#${entry.number}`}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/70 bg-card p-3"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-sm font-medium text-foreground">
                  <span className="text-muted-foreground">#{entry.number}</span> {entry.title}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {entry.headBranch} → {entry.baseBranch}
                  {entry.headBranch === branchName ? " · this branch" : ""}
                  {entry.author ? ` · @${entry.author.login}` : ""}
                  {entry.isDraft ? " · draft" : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs capitalize text-muted-foreground">{entry.state}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={openNumber === entry.number}
                  onClick={() => setOpenNumber(openNumber === entry.number ? null : entry.number)}
                >
                  {openNumber === entry.number ? "Hide" : "Details"}
                </Button>
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open pull request ${entry.number} on ${hostLabel(provider)}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ExternalLinkIcon className="size-3.5" />
                </a>
              </div>
              {openNumber === entry.number && api !== null && projectId !== null ? (
                <div className="basis-full pt-2">
                  <HostPullRequestDetail
                    api={api}
                    projectId={projectId}
                    repository={entry.repository}
                    host={entry.host}
                    number={entry.number}
                    onChanged={() =>
                      void queryClient.invalidateQueries({ queryKey: ["host-pull-requests"] })
                    }
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ACTION_LABELS: Partial<Record<PullRequestAction, string>> = {
  merge: "Merge",
  close: "Close",
  reopen: "Reopen",
  ready: "Mark ready",
  draft: "Convert to draft",
  "update-branch": "Update branch",
};

/** One pull request on a host the git layer cannot read: description, conversation and actions. */
function HostPullRequestDetail({
  api,
  projectId,
  repository,
  host,
  number,
  onChanged,
}: {
  api: NativeApi;
  projectId: ProjectId;
  repository: string;
  host: string;
  number: number;
  onChanged: () => void;
}) {
  const ref = { projectId, repository, host, number };
  const detailQuery = useQuery({
    queryKey: ["host-pull-request", projectId, repository, number],
    queryFn: () => api.pullRequests.detail(ref),
  });
  const activityQuery = useQuery({
    queryKey: ["host-pull-request-activity", projectId, repository, number],
    queryFn: () => api.pullRequests.activity(ref),
  });
  const [body, setBody] = useState("");
  const [mergeMethod, setMergeMethod] = useState<PullRequestMergeMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [tab, setTab] = useState<"overview" | "files" | "checks">("overview");
  const [drafts, setDrafts] = useState<ReadonlyArray<PullRequestReviewCommentDraft>>([]);
  const [verdict, setVerdict] = useState<PullRequestReviewVerdict>("comment");
  const [reviewBody, setReviewBody] = useState("");

  const detail = detailQuery.data;
  const activity = activityQuery.data;

  const attempt = async (title: string, work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      await Promise.all([detailQuery.refetch(), activityQuery.refetch()]);
      onChanged();
      return true;
    } catch (error) {
      toastManager.add({
        type: "error",
        title,
        description: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (detailQuery.isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (detail === undefined)
    return (
      <p className="text-xs text-destructive-foreground">
        {detailQuery.error instanceof Error
          ? detailQuery.error.message
          : "Could not read this pull request."}
      </p>
    );

  const permissions = detail.viewerPermissions;
  const methods = (["merge", "squash", "rebase"] as const).filter(
    (method) => detail.mergeCapabilities[method],
  );
  const method = mergeMethod ?? methods[0] ?? undefined;
  const actions = permissions.actions.filter((action) => ACTION_LABELS[action] !== undefined);

  const tabs = (
    <div role="tablist" aria-label="Pull request sections" className="flex items-center gap-1">
      {(
        [
          ["overview", "Overview"],
          ["files", `Files (${detail.changedFiles})`],
          ["checks", `Checks (${detail.checks.length})`],
        ] as const
      ).map(([value, label]) => (
        <Button
          key={value}
          role="tab"
          aria-selected={tab === value}
          size="sm"
          variant={tab === value ? "secondary" : "ghost"}
          onClick={() => setTab(value)}
        >
          {label}
        </Button>
      ))}
    </div>
  );

  if (tab === "files")
    return (
      <div className="space-y-3 border-t border-border/60 pt-3 text-xs">
        {tabs}
        {detail.capabilities.diff ? (
          <HostPullRequestFiles
            api={api}
            refInput={ref}
            canInline={detail.capabilities.review.inlineComment && permissions.comment}
            drafts={drafts}
            onDraft={(draft) => setDrafts((current) => [...current, draft])}
            onRemoveDraft={(index) =>
              setDrafts((current) => current.filter((_, position) => position !== index))
            }
          />
        ) : (
          <p className="text-muted-foreground">This host does not provide a diff.</p>
        )}
      </div>
    );
  if (tab === "checks")
    return (
      <div className="space-y-3 border-t border-border/60 pt-3 text-xs">
        {tabs}
        {detail.checks.length === 0 ? (
          <p className="text-muted-foreground">No checks reported.</p>
        ) : (
          <ul className="space-y-1" aria-label="Checks">
            {detail.checks.map((check) => (
              <li
                key={check.name}
                className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-2 py-1.5"
              >
                <span className="truncate font-medium">
                  {check.url ? (
                    <a
                      href={check.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {check.name}
                    </a>
                  ) : (
                    check.name
                  )}
                  {check.required ? (
                    <span className="ml-1.5 text-muted-foreground">required</span>
                  ) : null}
                </span>
                <span className="shrink-0 capitalize text-muted-foreground">
                  {check.status.replaceAll("-", " ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );

  return (
    <div className="space-y-3 border-t border-border/60 pt-3 text-xs">
      {tabs}
      {detail.body ? (
        <ChatMarkdown text={detail.body} cwd={detail.workspaceRoot} />
      ) : (
        <p className="text-muted-foreground">No description provided.</p>
      )}

      {detail.labels.length > 0 || detail.reviewers.length > 0 ? (
        <p className="text-muted-foreground">
          {detail.reviewers.length > 0
            ? `Reviewers: ${detail.reviewers.map((reviewer) => `@${reviewer.login}`).join(", ")}`
            : null}
          {detail.reviewers.length > 0 && detail.labels.length > 0 ? " · " : null}
          {detail.labels.length > 0
            ? `Labels: ${detail.labels.map((label) => label.name).join(", ")}`
            : null}
        </p>
      ) : null}

      {actions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Actions">
          {methods.length > 1 && actions.includes("merge") ? (
            <SimpleSelect
              aria-label="Merge method"
              size="xs"
              value={method ?? ""}
              onValueChange={(next) => setMergeMethod(next as PullRequestMergeMethod)}
              options={methods.map((candidate) => ({ value: candidate, label: candidate }))}
            />
          ) : null}
          {actions.map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === "merge" ? "secondary" : "outline"}
              disabled={busy}
              onClick={() =>
                void attempt(`Could not ${action.replace("-", " ")}`, () =>
                  api.pullRequests.runAction({
                    ...ref,
                    action,
                    ...(action === "merge" && method ? { mergeMethod: method } : {}),
                  }),
                )
              }
            >
              {ACTION_LABELS[action]}
            </Button>
          ))}
        </div>
      ) : null}

      {(activity?.reviewThreads ?? []).length > 0 ? (
        <div className="space-y-2">
          <h4 className="font-semibold uppercase tracking-wider text-muted-foreground">
            Review threads ({activity?.reviewThreads.length})
          </h4>
          {(activity?.reviewThreads ?? []).map((thread) => (
            <HostReviewThread
              key={thread.id}
              thread={thread}
              canReply={detail.capabilities.review.reply && permissions.comment}
              canResolve={detail.capabilities.review.resolve && permissions.resolve}
              busy={busy}
              onReply={(text) =>
                attempt("Could not reply", () =>
                  api.pullRequests.replyToThread({ ...ref, threadId: thread.id, body: text }),
                )
              }
              onResolve={() =>
                void attempt("Could not change the thread", () =>
                  api.pullRequests.setThreadResolution({
                    ...ref,
                    threadId: thread.id,
                    resolved: !thread.isResolved,
                  }),
                )
              }
            />
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        <h4 className="font-semibold uppercase tracking-wider text-muted-foreground">
          Conversation ({activity?.commentCount ?? 0})
        </h4>
        {(activity?.comments ?? []).map((comment) => {
          const own =
            detail.viewer !== undefined &&
            comment.author?.login === detail.viewer &&
            comment.kind === "issue-comment" &&
            detail.capabilities.edit?.comment === true;
          return (
            <div key={comment.id} className="rounded-lg border border-border/70 bg-background p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">@{comment.author?.login ?? "unknown"}</span>
                {own && editing?.id !== comment.id ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Edit comment by ${comment.author?.login}`}
                    onClick={() => setEditing({ id: comment.id, body: comment.body })}
                  >
                    Edit
                  </button>
                ) : null}
              </div>
              {editing?.id === comment.id ? (
                <div className="mt-1 space-y-1.5">
                  <textarea
                    aria-label="Edit comment"
                    value={editing.body}
                    onChange={(event) => setEditing({ id: comment.id, body: event.target.value })}
                    rows={4}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                  />
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      disabled={busy || editing.body.trim().length === 0}
                      onClick={() =>
                        void attempt("Could not edit the comment", () =>
                          api.pullRequests.updateComment({
                            ...ref,
                            commentId: comment.id,
                            kind: "issue-comment",
                            body: editing.body,
                          }),
                        ).then((ok) => (ok ? setEditing(null) : undefined))
                      }
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-1 text-foreground/90">
                  <ChatMarkdown text={comment.body} cwd={detail.workspaceRoot} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {permissions.verdicts.length > 0 && detail.state === "open" ? (
        <div className="space-y-1.5 rounded-lg border border-border/70 p-2">
          <h4 className="font-semibold uppercase tracking-wider text-muted-foreground">
            Submit a review
          </h4>
          {drafts.length > 0 ? (
            <p className="text-muted-foreground">
              {drafts.length} pending line comment{drafts.length === 1 ? "" : "s"} from the Files
              tab will be sent with this review.
            </p>
          ) : null}
          <textarea
            aria-label="Review summary"
            value={reviewBody}
            onChange={(event) => setReviewBody(event.target.value)}
            rows={3}
            placeholder="Summary (optional for an approval)"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5"
          />
          <div className="flex items-center gap-2">
            <SimpleSelect
              aria-label="Review verdict"
              size="xs"
              value={verdict}
              onValueChange={(next) => setVerdict(next as PullRequestReviewVerdict)}
              options={permissions.verdicts.map((candidate) => ({
                value: candidate,
                label: candidate.replace("-", " "),
              }))}
            />
            <Button
              size="sm"
              disabled={
                busy ||
                (verdict !== "approve" && reviewBody.trim().length === 0 && drafts.length === 0)
              }
              onClick={() =>
                void attempt("Could not submit the review", () =>
                  api.pullRequests.submitReview({
                    ...ref,
                    verdict,
                    body: reviewBody,
                    comments: drafts,
                  }),
                ).then((ok) => {
                  if (ok) {
                    setReviewBody("");
                    setDrafts([]);
                  }
                })
              }
            >
              Submit review
            </Button>
          </div>
        </div>
      ) : null}

      {permissions.comment ? (
        <div className="space-y-1.5">
          <PullRequestComposerTextarea
            value={body}
            onValueChange={setBody}
            placeholder="Write a comment…"
            className="min-h-16 w-full rounded-lg border border-border bg-background p-2 text-xs"
            support={{
              mentions: detail.capabilities.mentions === true,
              referenceSigils: detail.capabilities.referenceSigils ?? [],
            }}
            searchMentions={(query) =>
              api.pullRequests
                .authorCandidates({ projectId, repository, host, query })
                .then((list) => list.candidates)
            }
            searchReferences={(query, sigil) =>
              api.pullRequests
                .referenceCandidates({ projectId, repository, host, query, sigil })
                .then((list) => list.candidates)
            }
          />
          <Button
            size="sm"
            disabled={busy || body.trim().length === 0}
            onClick={() =>
              void attempt("Could not post the comment", () =>
                api.pullRequests.comment({ ...ref, body }),
              ).then((ok) => (ok ? setBody("") : undefined))
            }
          >
            Comment
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The patch of one pull request, a slice at a time and a file at a time. */
function HostPullRequestFiles({
  api,
  refInput,
  canInline,
  drafts,
  onDraft,
  onRemoveDraft,
}: {
  api: NativeApi;
  refInput: Parameters<NativeApi["pullRequests"]["diff"]>[0];
  canInline: boolean;
  drafts: ReadonlyArray<PullRequestReviewCommentDraft>;
  onDraft: (draft: PullRequestReviewCommentDraft) => void;
  onRemoveDraft: (index: number) => void;
}) {
  const [files, setFiles] = useState<ReadonlyArray<PatchFile>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const load = async (from: string | null) => {
    setLoading(true);
    setFailure(null);
    try {
      const slice = await api.pullRequests.diff({
        ...refInput,
        ...(from === null ? {} : { cursor: from }),
      });
      setFiles((current) => [...current, ...splitPatchByFile(slice.patch)]);
      setCursor(slice.nextCursor);
      setStarted(true);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not read the diff.");
    } finally {
      setLoading(false);
    }
  };

  if (!started)
    return (
      <div className="space-y-1.5">
        {failure ? <p className="text-destructive-foreground">{failure}</p> : null}
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(null)}>
          {loading ? "Loading…" : "Load changes"}
        </Button>
      </div>
    );

  return (
    <div className="space-y-2">
      {files.length === 0 ? <p className="text-muted-foreground">No changes reported.</p> : null}
      {files.map((file) => (
        <Details key={file.path} className="rounded-md border border-border/70">
          <Summary className="flex cursor-pointer items-center justify-between gap-3 px-2 py-1.5">
            <span className="truncate font-mono">{file.path}</span>
            <span className="shrink-0 text-muted-foreground">
              +{file.additions} −{file.deletions}
            </span>
          </Summary>
          <pre className="max-h-96 overflow-auto border-t border-border/70 p-2 font-mono text-[11px] leading-snug">
            {file.text.split("\n").map((line, index) => (
              <div
                key={index}
                className={
                  line.startsWith("+") && !line.startsWith("+++")
                    ? "text-emerald-600 dark:text-emerald-400"
                    : line.startsWith("-") && !line.startsWith("---")
                      ? "text-red-600 dark:text-red-400"
                      : line.startsWith("@@")
                        ? "text-muted-foreground"
                        : undefined
                }
              >
                {line || " "}
              </div>
            ))}
          </pre>
          {canInline ? (
            <InlineCommentForm
              path={file.path}
              shown={patchLineNumbers(file.text)}
              onDraft={onDraft}
              drafts={drafts.filter((draft) => draft.path === file.path)}
              allDrafts={drafts}
              onRemoveDraft={onRemoveDraft}
            />
          ) : null}
        </Details>
      ))}
      {failure ? <p className="text-destructive-foreground">{failure}</p> : null}
      {cursor !== null ? (
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(cursor)}>
          {loading ? "Loading…" : "Load more files"}
        </Button>
      ) : null}
    </div>
  );
}

/** A line comment held until the review is sent, so a half-written review is never visible. */
function InlineCommentForm({
  path,
  shown,
  onDraft,
  drafts,
  allDrafts,
  onRemoveDraft,
}: {
  path: string;
  shown: ReturnType<typeof patchLineNumbers>;
  onDraft: (draft: PullRequestReviewCommentDraft) => void;
  drafts: ReadonlyArray<PullRequestReviewCommentDraft>;
  allDrafts: ReadonlyArray<PullRequestReviewCommentDraft>;
  onRemoveDraft: (index: number) => void;
}) {
  const [line, setLine] = useState("");
  const [side, setSide] = useState<"new" | "old">("new");
  const [text, setText] = useState("");
  const lineNumber = Number(line);
  // A comment can only go on a line the patch shows, on the side it shows it.
  const onDiff =
    side === "new"
      ? shown.added.has(lineNumber) || shown.context.has(lineNumber)
      : shown.removed.has(lineNumber);
  const valid = Number.isInteger(lineNumber) && lineNumber > 0 && text.trim().length > 0 && onDiff;

  return (
    <div className="space-y-1.5 border-t border-border/70 p-2">
      {drafts.map((draft) => (
        <div
          key={`${draft.path}:${JSON.stringify(draft.position)}:${draft.body}`}
          className="flex gap-2"
        >
          <span className="text-muted-foreground">
            {draft.position.kind === "deleted"
              ? `old line ${draft.position.oldLine}`
              : draft.position.kind === "added"
                ? `line ${draft.position.newLine}`
                : `line ${draft.position.newLine}`}
          </span>
          <span className="min-w-0 flex-1 truncate">{draft.body}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onRemoveDraft(allDrafts.indexOf(draft))}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          aria-label={`Line number in ${path}`}
          inputMode="numeric"
          placeholder="Line"
          value={line}
          onChange={(event) => setLine(event.target.value)}
          className="h-7 w-16 rounded-md border border-border bg-background px-2"
        />
        <SimpleSelect
          aria-label="Side of the diff"
          size="xs"
          value={side}
          onValueChange={(next) => setSide(next as "new" | "old")}
          options={[
            { value: "new", label: "added / new" },
            { value: "old", label: "removed / old" },
          ]}
        />
        <input
          aria-label={`Comment on ${path}`}
          placeholder="Line comment"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="h-7 min-w-40 flex-1 rounded-md border border-border bg-background px-2"
        />
        {line !== "" && !onDiff ? (
          <span className="basis-full text-destructive-foreground">
            That line is not in this diff.
          </span>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={!valid}
          onClick={() => {
            onDraft({
              path,
              position:
                side === "new"
                  ? shown.added.has(lineNumber)
                    ? { kind: "added", newLine: lineNumber }
                    : {
                        kind: "context",
                        oldLine: shown.context.get(lineNumber) ?? lineNumber,
                        newLine: lineNumber,
                        side: "right",
                      }
                  : { kind: "deleted", oldLine: lineNumber },
              body: text,
            });
            setLine("");
            setText("");
          }}
        >
          Add to review
        </Button>
      </div>
    </div>
  );
}

/** One review conversation: its comments, a reply box, and resolve where the host allows it. */
function HostReviewThread({
  thread,
  canReply,
  canResolve,
  busy,
  onReply,
  onResolve,
}: {
  thread: PullRequestReviewThread;
  canReply: boolean;
  canResolve: boolean;
  busy: boolean;
  onReply: (body: string) => Promise<boolean>;
  onResolve: () => void;
}) {
  const [reply, setReply] = useState("");
  return (
    <div className="rounded-lg border border-border/70 bg-background p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono">
          {thread.path}
          {thread.line ? `:${thread.line}` : ""}
          {thread.isOutdated ? " · outdated" : ""}
          {thread.isResolved ? " · resolved" : ""}
        </span>
        {canResolve ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onResolve}>
            {thread.isResolved ? "Unresolve" : "Resolve"}
          </Button>
        ) : null}
      </div>
      <div className="mt-1 space-y-1.5">
        {thread.comments.map((comment) => (
          <div key={comment.id}>
            <span className="font-semibold">@{comment.author?.login ?? "unknown"}</span>
            <span className="ml-2 text-foreground/90">{comment.body}</span>
          </div>
        ))}
      </div>
      {canReply ? (
        <div className="mt-1.5 flex gap-1.5">
          <input
            aria-label={`Reply in ${thread.path}`}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            placeholder="Reply…"
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || reply.trim().length === 0}
            onClick={() => void onReply(reply).then((ok) => (ok ? setReply("") : undefined))}
          >
            Reply
          </Button>
        </div>
      ) : null}
    </div>
  );
}

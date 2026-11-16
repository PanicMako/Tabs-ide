import type { PullRequestRef } from "@tabs/contracts";
import { useQuery } from "@tanstack/react-query";
import { cloneElement, useState, type ReactElement } from "react";

import { useGitApi } from "./gitApiContext";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";

const STATE_LABEL = { open: "Open", closed: "Closed", merged: "Merged" } as const;

/**
 * A pull request link that shows a small card on hover: repository and number, title, state and
 * who opened it. The card reads the host only once the pointer has rested on the link, and a link
 * the host cannot answer for is left as the plain link it was. Ported from T3.
 */
export function PullRequestLinkPreview({
  link,
  reference,
}: {
  link: ReactElement;
  reference: PullRequestRef;
}) {
  const api = useGitApi();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: [
      "git",
      "pull-request-preview",
      reference.projectId,
      reference.host ?? null,
      reference.repository,
      reference.number,
    ],
    enabled: open && api !== null,
    queryFn: () => api!.pullRequests.preview(reference),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const preview = query.data;

  return (
    <PreviewCard open={open} onOpenChange={setOpen}>
      <PreviewCardTrigger render={cloneElement(link)} delay={350} closeDelay={120} />
      {preview ? (
        <PreviewCardPopup align="center" className="w-80 max-w-[calc(100vw-2rem)]">
          <div className="min-w-0 space-y-1 p-3">
            <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="min-w-0 truncate">{preview.repository}</span>
              <span className="shrink-0">#{preview.number}</span>
            </div>
            <p className="line-clamp-3 text-sm font-medium leading-snug text-foreground">
              {preview.title}
            </p>
            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
              <span>{preview.isDraft ? "Draft" : STATE_LABEL[preview.state]}</span>
              <span>{preview.author ? `by @${preview.author.login}` : "by a deleted account"}</span>
              <time dateTime={preview.createdAt}>
                {new Date(preview.createdAt).toLocaleDateString()}
              </time>
            </div>
          </div>
        </PreviewCardPopup>
      ) : null}
    </PreviewCard>
  );
}

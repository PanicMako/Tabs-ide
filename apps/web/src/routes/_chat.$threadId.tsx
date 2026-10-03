import { ThreadId } from "@tabs/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { threadsAtom } from "../state/threads";

function LegacyThreadRouteRedirect() {
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const environmentId = useAtomValue(
    threadsAtom,
    (threads) => threads.find((thread) => thread.id === threadId)?.environmentId ?? null,
  );

  useEffect(() => {
    if (!environmentId) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId },
      replace: true,
    });
  }, [environmentId, navigate, threadId]);

  return null;
}

/** Compatibility redirect for links created before routes became environment-scoped. */
export const Route = createFileRoute("/_chat/$threadId")({
  component: LegacyThreadRouteRedirect,
});

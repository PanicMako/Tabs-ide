import { ThreadId } from "@tabs/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { threadsAtom } from "../state/threads";
import { resolveRouteThread } from "../resolveRouteThread";
import { useDraftThread } from "../state/composerDrafts";
import { getPrimaryEnvironmentId } from "../connection/environmentApiRegistry";

function LegacyThreadRouteRedirect() {
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const routeThreads = useAtomValue(threadsAtom, (threads) =>
    threads.filter((thread) => thread.id === threadId),
  );
  const draft = useDraftThread(threadId);
  const serverEnvironmentId = resolveRouteThread(routeThreads, threadId, null)?.environmentId;
  const environmentId =
    serverEnvironmentId ?? (routeThreads.length === 0 && draft ? getPrimaryEnvironmentId() : null);

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

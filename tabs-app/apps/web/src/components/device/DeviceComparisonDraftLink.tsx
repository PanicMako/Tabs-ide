import { useEffect, useRef, useState } from "react";
import {
  BrowserProfileId,
  PreviewTabId,
  type DeviceComparisonResultRef,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@tabs/contracts";
import * as Schema from "effect/Schema";
import { isPrimaryEnvironment } from "~/connection/environmentApiRegistry";
import { revealSavedBrowserResult } from "~/lib/savedBrowserResult";
import { Button } from "../ui/button";
import { draftReceiptKind } from "./deviceComparisonShared";

const DraftTarget = Schema.Struct({
  tabId: PreviewTabId,
  profileId: BrowserProfileId,
  pending: Schema.optionalKey(Schema.Literal(true)),
});
const isDraftTarget = Schema.is(DraftTarget);

interface DeviceComparisonDraftLinkProps {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  threadId: ThreadId;
  reference: DeviceComparisonResultRef;
  workLog?: boolean;
}

export function DeviceComparisonDraftLink(props: DeviceComparisonDraftLinkProps) {
  const { environmentId, projectId, threadId, reference } = props;
  const key = JSON.stringify([environmentId, projectId, threadId, reference.runId, reference.step]);
  return <DraftLink key={key} {...props} />;
}

function DraftLink({
  environmentId,
  projectId,
  threadId,
  reference: { runId, step },
  workLog = false,
}: DeviceComparisonDraftLinkProps) {
  const bridge = isPrimaryEnvironment(environmentId) ? window.desktopBridge : undefined;
  const [target, setTarget] = useState<typeof DraftTarget.Type>();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const lifetime = useRef<object | undefined>(undefined);

  useEffect(() => {
    if (!bridge) return;
    const token = {};
    lifetime.current = token;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let found = false;
    let latestRequest = 0;
    const read = async () => {
      const request = ++latestRequest;
      try {
        const result = await bridge.runBrowserAutomation({
          source: "human",
          operation: "findDeviceComparisonDraft",
          projectId,
          taskId: threadId,
          input: { runId, step },
        });
        if (lifetime.current === token && request === latestRequest) {
          const target = isDraftTarget(result) ? result : undefined;
          found = target !== undefined && target.pending !== true;
          setTarget(target);
        }
      } catch {
        // A later state update can retry a lookup interrupted by the desktop.
      }
    };
    const unsubscribe = bridge.onBrowserSessionState((state) => {
      if (found || state.projectId !== projectId || state.assignedTaskId !== threadId) return;
      clearTimeout(timer);
      timer = setTimeout(() => void read(), 150);
    });
    void read();
    return () => {
      lifetime.current = undefined;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [bridge, projectId, refresh, runId, step, threadId]);

  const open = async () => {
    const token = lifetime.current;
    if (!bridge || !target || !token || opening) return;
    const isCurrent = () => lifetime.current === token;
    setOpening(true);
    setError(undefined);
    try {
      await revealSavedBrowserResult({
        bridge,
        environmentId,
        projectId,
        threadId,
        tabId: target.tabId,
        profileId: target.profileId,
        operation: "enterDeviceComparisonDraft",
        input: { runId, step, profileId: target.profileId },
        validateUrl: (url) => URL.canParse(url) && /^https?:\/\//i.test(url),
        invalidResultMessage: "The browser did not confirm the saved evidence draft.",
        isCurrent,
      });
      if (isCurrent() && target.pending) setRefresh((count) => count + 1);
    } catch (cause) {
      if (isCurrent())
        setError(
          cause instanceof Error ? cause.message : "Could not open the saved evidence draft.",
        );
    } finally {
      if (isCurrent()) setOpening(false);
    }
  };

  if (!target) return null;
  const status = target.pending
    ? "Checking the draft…"
    : draftReceiptStatus(draftReceiptKind(target));
  const onClick = () => void open();
  return (
    <>
      {workLog ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="mt-2"
          disabled={opening}
          onClick={onClick}
        >
          Open draft
        </Button>
      ) : (
        <button type="button" className="dv-link" disabled={opening} onClick={onClick}>
          Open draft
        </button>
      )}
      <p className="dv-muted" role="status">
        {status}
      </p>
      {error && (
        <p className="dv-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function draftReceiptStatus(kind: ReturnType<typeof draftReceiptKind>) {
  if (kind === "image") return "Both screenshots confirmed on the page";
  if (kind === "pageText")
    return "The page shows the screenshot fingerprints, but Tabs couldn't confirm the images";
  return "Screenshots not confirmed yet";
}

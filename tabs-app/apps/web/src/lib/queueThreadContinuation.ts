import { AGENT_HANDOFF_DESCRIPTIONS, AGENT_HANDOFF_LABELS } from "~/lib/agentHandoffLabels";
import { CommandId, MessageId, ThreadId } from "@tabs/contracts";
import { toastManager } from "~/components/ui/toast";
import { environmentApi } from "~/connection/environmentApiRegistry";

export function queueThreadContinuation({
  id,
  threadId,
  environmentId,
  text,
  failedTitle,
  verify,
}: {
  id: string;
  threadId: string;
  environmentId?: string | null | undefined;
  text: string;
  failedTitle: string;
  verify?: (() => Promise<boolean>) | undefined;
}) {
  const send = async () => {
    const api = await environmentApi(environmentId);
    if (verify && !(await verify())) {
      toastManager.add({ type: "warning", title: "The approved handoff has changed" });
      return;
    }
    await api.orchestration.dispatchCommand({
      type: "message.dispatch",
      commandId: CommandId.makeUnsafe(id),
      messageId: MessageId.makeUnsafe(id),
      threadId: ThreadId.makeUnsafe(threadId),
      text,
      attachments: [],
      dispatchMode: { type: "queue_after_active" },
    });
  };
  const retry = () =>
    void send().catch(() =>
      toastManager.add({
        type: "error",
        title: failedTitle,
        description: `${failedTitle}. ${AGENT_HANDOFF_DESCRIPTIONS.retryContinuation}`,
        actionProps: { children: AGENT_HANDOFF_LABELS.retryContinuation, onClick: retry },
      }),
    );
  retry();
}

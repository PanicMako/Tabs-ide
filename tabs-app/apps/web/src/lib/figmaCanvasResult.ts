import {
  type EnvironmentId,
  type FigmaCanvasReceipt,
  type FigmaCanvasResultRef,
  type ProjectId,
  type ThreadId,
} from "@tabs/contracts";
import { figmaDesignSelection } from "@tabs/shared/figmaUrl";

import { environmentApi, isPrimaryEnvironment } from "~/connection/environmentApiRegistry";
import { revealSavedBrowserResult } from "./savedBrowserResult";

export async function openSavedFigmaCanvasResult(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  projectId: ProjectId,
  { operationId }: FigmaCanvasResultRef,
  isCurrent: () => boolean,
) {
  const bridge = window.desktopBridge;
  if (!bridge || !isPrimaryEnvironment(environmentId))
    throw new Error("Open this result in the Tabs desktop app on its original machine.");
  const api = await environmentApi(environmentId);
  if (!isCurrent()) return;
  const receipt = await api.preview.getFigmaCanvasResult({ threadId, operationId });
  if (!isCurrent()) return;
  await revealSavedFigmaCanvasResult(
    bridge,
    environmentId,
    threadId,
    projectId,
    receipt,
    isCurrent,
  );
}

export async function revealSavedFigmaCanvasResult(
  bridge: NonNullable<Window["desktopBridge"]>,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  projectId: ProjectId,
  receipt: FigmaCanvasReceipt,
  isCurrent: () => boolean,
) {
  const { tabId, profileId, fileKey, mainFileKey } = receipt.target;
  if (!isCurrent()) return;
  if (receipt.target.projectId !== projectId)
    throw new Error("The original browser tab or profile is unavailable in this thread.");
  await revealSavedBrowserResult({
    bridge,
    environmentId,
    threadId,
    projectId,
    tabId,
    profileId,
    operation: "enterFigmaCanvasResult",
    input: receipt,
    restoreGuest: true,
    validateUrl: (url) => {
      const selection = URL.canParse(url) && figmaDesignSelection(new URL(url));
      return (
        !!selection &&
        selection.mainFileKey === mainFileKey &&
        selection.fileKey === fileKey &&
        selection.nodeId === receipt.frameNodeId
      );
    },
    invalidResultMessage: "The browser did not confirm the saved Figma frame.",
    isCurrent,
  });
}

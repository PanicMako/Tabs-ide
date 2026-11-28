import { isUserBrowserTab } from "@tabs/shared/preview";
import { isPrimaryEnvironment } from "~/connection/environmentApiRegistry";
import { appAtomRegistry } from "../state/atomRegistry";
import { clientSettingsAtom } from "../state/settings";
import type { SurfaceLocation } from "./threadSurfaceAttachment";

export const isSavedBrowserAttachmentId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value);

export async function revealSavedBrowserAttachment(
  location: SurfaceLocation,
  sessionId: string,
  profileId: string,
  attachment: string | { grantId: string; pageRef: string; pairedGrantId?: string },
  isCurrent: () => boolean,
  partition?: string,
): Promise<string | undefined> {
  const bridge = window.desktopBridge;
  if (
    !bridge ||
    !isPrimaryEnvironment(location.environmentId ?? undefined) ||
    !isUserBrowserTab(sessionId)
  )
    throw new Error("Open this page in its original Tabs desktop browser.");
  const checkProfile = () => {
    if (
      profileId !== "default" &&
      !appAtomRegistry.get(clientSettingsAtom).browserProfiles.some(({ id }) => id === profileId)
    )
      throw new Error("The original browser profile is no longer available.");
  };
  checkProfile();
  const target = { projectId: location.projectId, sessionId };
  const state = await bridge.getBrowserSessionState(target);
  if (!isCurrent()) return;
  checkProfile();
  if (!state.instanceId && !state.currentUrl) {
    await bridge.ensureBrowserSession({
      ...target,
      ...(partition === undefined ? { profileId } : { partition }),
      initialUrl: "",
    });
  }
  if (!isCurrent()) return;
  checkProfile();
  const draft = typeof attachment !== "string";
  const result = await bridge.runBrowserAutomation({
    ...target,
    source: "human",
    taskId: location.threadId,
    operation: draft ? "enterSavedScreenshotDraft" : "enterSavedAttachedPage",
    input: draft ? { ...attachment, profileId } : { attachmentId: attachment, profileId },
  });
  if (!isCurrent()) return;
  checkProfile();
  if (draft && result === null) return;
  if (
    typeof result !== "object" ||
    result === null ||
    !("url" in result) ||
    typeof result.url !== "string"
  )
    throw new Error("The browser could not restore the saved attachment.");
  return result.url;
}

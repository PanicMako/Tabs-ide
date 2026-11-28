import { appAtomRegistry } from "~/state/atomRegistry";
import { clientSettingsAtom } from "~/state/settings";
import {
  DeviceComparisonEvidenceDestination,
  DeviceComparisonFrame,
  DeviceId,
  DeviceHostId,
  DevicePlatform,
  type EnvironmentId,
  ThreadId,
  type NativeWindowGrant,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
} from "@tabs/contracts";
import { NativeWindowUnavailableError } from "./nativeWindowHandoff";
import * as Schema from "effect/Schema";
import { useComposerDraftStore } from "~/composerDraftStore";
import { scopedComposerThreadId } from "~/state/composerDrafts";
import { useCompanionSurfaceStore, type CompanionSurface } from "~/stores/companionSurfaceStore";
import { useRightPanelStore } from "~/stores/rightPanelStore";
import { showCustomConfirm } from "./customConfirm";
import { isUserBrowserTab } from "@tabs/shared/preview";
import { environmentApi, isPrimaryEnvironment } from "~/connection/environmentApiRegistry";
import type { DragEvent } from "react";
import {
  adoptProjectBrowserToolAttachment,
  readCurrentProjectBrowserTool,
  revealProjectToolAttachment,
  type ProjectToolAttachmentTarget,
} from "./projectToolAttachmentTargets";
import {
  terminalAttachmentIsCurrent,
  terminalAttachmentTarget,
  type TerminalAttachmentTarget,
} from "./terminalAttachmentTargets";
import { getThreadTerminalState, terminalActions } from "~/state/terminal";
import { isSavedBrowserAttachmentId, revealSavedBrowserAttachment } from "./savedBrowserAttachment";

export const SURFACE_ATTACHMENT_TYPE = "application/vnd.tabs.surface+json";

export interface SurfaceLocation {
  environmentId: EnvironmentId | null;
  projectId: string;
  threadId: ThreadId;
}

export function surfaceScope(location: SurfaceLocation) {
  return `${location.environmentId ?? "local"}:${location.threadId}`;
}

function browserOrigin(tab: CompanionSurface) {
  try {
    const url = new URL(tab.url ?? "");
    return ["https:", "http:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

function targetIdentity(tab: CompanionSurface) {
  if (tab.kind === "device" && tab.deviceId && tab.platform)
    return {
      kind: tab.kind,
      deviceId: tab.deviceId,
      hostId: tab.hostId ?? "local",
      platform: tab.platform,
    };
  if (tab.kind === "browser" && browserOrigin(tab))
    return {
      kind: tab.kind,
      tabId: `agents-surface-${tab.id}`,
      profileId: tab.profileId ?? "default",
      origin: browserOrigin(tab),
    };
  return null;
}

const isDeviceDrop = Schema.is(
  Schema.Struct({
    kind: Schema.Literal("device"),
    hostId: DeviceHostId,
    deviceId: DeviceId,
    platform: DevicePlatform,
  }),
);

export async function attachSharedDevice(
  location: SurfaceLocation,
  fromThreadId: ThreadId,
  target: unknown,
  label: string,
  canAttach = () => true,
) {
  if (!isDeviceDrop(target)) throw new Error("Select the original device in its Device tab.");
  const { device } = await environmentApi(location.environmentId);
  if (!device) throw new Error("The connected environment has no device controls.");
  if (!canAttach()) return null;
  const { hostId, deviceId, platform } = target;
  const session = await device.open({
    threadId: location.threadId,
    fromThreadId,
    hostId,
    deviceId,
    platform,
    boot: false,
  });
  if (
    session.hostId !== hostId ||
    session.deviceId !== deviceId ||
    session.platform !== platform ||
    session.threadId !== location.threadId
  )
    throw new Error("The original device view changed. Select it again.");
  if (!canAttach()) return null;

  const scope = surfaceScope(location);
  const store = useCompanionSurfaceStore.getState();
  const workspace = store.workspaces[scope];
  const existing = workspace?.tabs.find(
    (tab) =>
      tab.kind === "device" &&
      !tab.deviceComparisonResult &&
      (tab.hostId ?? "local") === hostId &&
      tab.deviceId === deviceId &&
      tab.platform === platform,
  );
  if (existing) return surfaceAttachmentFile(location, existing);
  const id = store.open(scope, "device", { hostId, deviceId, platform, title: label });
  if (workspace?.activeId) store.activate(scope, workspace.activeId);
  return surfaceAttachmentFile(location, {
    id,
    kind: "device",
    hostId,
    deviceId,
    platform,
    title: label,
  });
}

/**
 * What the browser page grant really covers: every page of the origin, unless
 * the desktop reports a narrower scope (for example a tenant path prefix).
 */
function profileLabel(profileId: string) {
  return (
    appAtomRegistry.get(clientSettingsAtom).browserProfiles.find(({ id }) => id === profileId)
      ?.label ?? profileId
  );
}

export function grantScopeQuestion(
  state: object,
  page: URL,
  profile: string,
  profileId = profile,
): string {
  const label = (state as { browserPageScopeLabel?: unknown }).browserPageScopeLabel;
  const described = typeof label === "string" && label.trim() ? label.trim() : undefined;
  if (!described)
    return `Allow this conversation to read and act on all pages of ${page.origin} in the ${profile} profile?`;
  // The desktop names the profile by id; show the name the user gave it.
  const suffix = ` in the ${profileId} profile`;
  const text = described.endsWith(suffix)
    ? `${described.slice(0, -suffix.length)} in the ${profile} profile`
    : described;
  return `Allow this conversation to read and act on ${text}?`;
}

export function surfaceAttachmentFile(
  location: SurfaceLocation,
  tab: CompanionSurface,
  transfer?: { grantId: string; hostId: string; deviceId: string; frame?: DeviceComparisonFrame },
): File | null {
  const target = targetIdentity(tab);
  if (!target) return null;
  const detail =
    target.kind === "device"
      ? [target.platform, target.hostId === "local" ? "" : target.hostId]
          .filter(Boolean)
          .join(" · ")
      : [
          target.origin ? new URL(target.origin).host : "",
          target.profileId === "default" ? "" : target.profileId,
        ]
          .filter(Boolean)
          .join(" · ");
  return attachmentFile([tab.title || tab.kind, detail], {
    version: 1,
    ...location,
    surfaceId: tab.id,
    target,
    ...(tab.kind === "browser" && tab.pageRef ? { pageRef: tab.pageRef } : {}),
    ...(tab.kind === "browser" && tab.browserInstanceId
      ? { browserInstanceId: tab.browserInstanceId }
      : {}),
    ...(transfer
      ? {
          screenshotTransfer: {
            tool: "device_attach_screenshot",
            ...transfer,
            tabId: `agents-surface-${tab.id}`,
            instructions: transfer.frame
              ? "Attach the approved frozen frame. Compare its digest on the saved draft before and after reloading that draft."
              : "Call device_open for this host and device. Inspect this tab for the input and attach the approved screen. Compare its digest on the saved draft before and after reloading that draft.",
          },
        }
      : {}),
  });
}

const ComparisonScreenshotGrant = Schema.Struct({
  grantId: Schema.String,
  hostId: Schema.String.check(Schema.isNonEmpty()),
  deviceId: Schema.String.check(Schema.isNonEmpty()),
  frame: DeviceComparisonFrame,
});
const isComparisonScreenshotPair = Schema.is(
  Schema.Struct({
    source: ComparisonScreenshotGrant,
    target: ComparisonScreenshotGrant,
  }),
);
const isComparisonEvidenceDestination = Schema.is(DeviceComparisonEvidenceDestination);
type ComparisonScreenshotPair = {
  source: typeof ComparisonScreenshotGrant.Type;
  target: typeof ComparisonScreenshotGrant.Type;
};

function matchesComparisonScreenshotPair(pair: unknown): pair is ComparisonScreenshotPair {
  if (!isComparisonScreenshotPair(pair)) return false;
  const { source, target } = pair;
  return (
    isSavedBrowserAttachmentId(source.grantId) &&
    isSavedBrowserAttachmentId(target.grantId) &&
    source.grantId !== target.grantId &&
    (source.hostId !== target.hostId || source.deviceId !== target.deviceId) &&
    source.frame.side === "source" &&
    target.frame.side === "target" &&
    source.frame.runId === target.frame.runId &&
    source.frame.step === target.frame.step
  );
}

export function comparisonScreenshotAttachmentFile(
  location: SurfaceLocation,
  tab: CompanionSurface,
  pair: ComparisonScreenshotPair,
): File | null {
  const target = targetIdentity(tab);
  if (
    target?.kind !== "browser" ||
    !tab.pageRef ||
    !tab.browserInstanceId ||
    !matchesComparisonScreenshotPair(pair)
  )
    return null;
  return attachmentFile([`First difference (step ${pair.source.frame.step})`, target.profileId], {
    version: 1,
    ...location,
    surfaceId: tab.id,
    target,
    pageRef: tab.pageRef,
    browserInstanceId: tab.browserInstanceId,
    comparisonScreenshotTransfer: {
      tool: "device_attach_screenshot",
      tabId: target.tabId,
      source: pair.source,
      target: pair.target,
      instructions:
        "Use the source and target grant IDs separately on the matching file inputs in this tab. Check both file selections before saving. Save once, then verify both receipt digests on the same saved draft before and after reload.",
    },
  });
}

export function browserExcerptAttachmentFile(
  location: SurfaceLocation,
  tab: CompanionSurface & { pageRef: string; browserInstanceId: string },
  text: string,
): File | null {
  const target = targetIdentity(tab);
  if (target?.kind !== "browser") return null;
  return attachmentFile(
    [
      "Browser excerpt",
      tab.title || (target.origin ? new URL(target.origin).host : ""),
      target.profileId === "default" ? "" : target.profileId,
    ].filter(Boolean),
    {
      version: 1,
      ...location,
      surfaceId: tab.id,
      // Reusing the excerpt must not enter the browser-access approval flow.
      target: { ...target, kind: "browser-excerpt" },
      pageRef: tab.pageRef,
      browserInstanceId: tab.browserInstanceId,
      text,
      instructions:
        "Use the reviewed text as evidence. Ask the user separately for browser access.",
    },
  );
}

function attachmentFile(parts: string[], value: object): File {
  const label = parts
    .join(" · ")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .slice(0, 200);
  return new File([JSON.stringify(value, null, 2)], `${label}.tabs.json`, {
    type: SURFACE_ATTACHMENT_TYPE,
  });
}

export function nativeWindowAttachmentFile(
  location: SurfaceLocation,
  grant: NativeWindowGrant,
): File {
  const { app, title, frame } = grant.window;
  return attachmentFile(
    [
      title || app,
      app,
      frame ? `${Math.round(frame.width)}×${Math.round(frame.height)}` : "",
    ].filter(Boolean),
    {
      version: 1,
      ...location,
      target: { kind: "native-window", app, title, selector: grant.selector },
      instructions:
        "Use target.selector as app in the computer tools. Start with computer_snapshot.",
    },
  );
}

export async function selectedNativeWindowAttachmentFile(
  location: SurfaceLocation,
  selector: string,
) {
  if (!isPrimaryEnvironment(location.environmentId ?? undefined))
    throw new Error("Select this window on its original desktop.");
  const { server } = await environmentApi(location.environmentId);
  const { grant } = await server.nativeComputer({ op: "status", threadId: location.threadId });
  if (!grant || grant.selector !== selector)
    throw new Error("This window attachment has expired. Select the window again.");
  return nativeWindowAttachmentFile(location, grant);
}

export function terminalSurfaceAttachmentFile(
  location: SurfaceLocation,
  terminalId: string,
  terminalLabel?: string,
): File | null {
  const target = terminalAttachmentTarget(location.environmentId, location.threadId, terminalId);
  // Activity titles can contain subprocess arguments. Share the PTY identity only.
  return target
    ? attachmentFile([terminalLabel ?? "Terminal"], {
        version: 1,
        ...location,
        target,
        instructions:
          "Use terminal_input to propose input with this exact terminalId and instanceId. Wait for the user's approval. Ask for a reviewed excerpt to verify what happened.",
      })
    : null;
}

export function selectedTerminalSurfaceAttachmentFile(location: SurfaceLocation, id?: string) {
  const state = getThreadTerminalState(location.threadId);
  const terminalId = id ?? state.activeTerminalId;
  if (!state.terminalIds.includes(terminalId)) return null;
  return terminalSurfaceAttachmentFile(location, terminalId);
}

export function projectToolSurfaceAttachmentFile(
  location: SurfaceLocation,
  attachment: { target: ProjectToolAttachmentTarget; label: string },
): File {
  const { target, label } = attachment;
  const id =
    target.resource && "instanceId" in target.resource
      ? target.resource.instanceId
      : target.instanceId;
  const parts =
    target.resource?.kind === "browser"
      ? [label, target.resource.profileId === "default" ? "" : target.resource.profileId].filter(
          Boolean,
        )
      : [label];
  return attachmentFile(parts, { version: 1, ...location, target });
}

export function writeSurfaceDrag(event: DragEvent, file: File | null) {
  if (!file) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.items.add(file);
}

export function requireSurfaceAttachmentSlot(location: SurfaceLocation) {
  const key = location.environmentId
    ? scopedComposerThreadId(location.environmentId, location.threadId)
    : location.threadId;
  const drafts = useComposerDraftStore.getState();
  const draft = drafts.draftsByThreadId[key];
  if (draft && draft.files.length + draft.images.length >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS)
    throw new Error("Remove an attachment before adding another target.");
  return key;
}

export function addSurfaceFileToDraft(location: SurfaceLocation, file: File) {
  useComposerDraftStore.getState().addFiles(requireSurfaceAttachmentSlot(location), [
    {
      type: "file",
      id: crypto.randomUUID(),
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      file,
    },
  ]);
}

function readSurfaceTarget(location: SurfaceLocation, value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("environmentId" in value) ||
    value.environmentId !== location.environmentId ||
    !("projectId" in value) ||
    value.projectId !== location.projectId ||
    !("threadId" in value) ||
    value.threadId !== location.threadId ||
    !("target" in value) ||
    !value.target ||
    typeof value.target !== "object"
  )
    throw new Error("Open this attachment in its original project and thread.");
  return value;
}

export async function validateSurfaceFileLocation(location: SurfaceLocation, file: File) {
  if (file.size > 8192) throw new Error("Invalid Tabs surface attachment.");
  readSurfaceTarget(location, JSON.parse(await file.text()));
}

/** A deliberate composer gesture can request a grant. Reading a sent file never does. */
export async function approveDroppedBrowserTab(
  location: SurfaceLocation,
  file: File,
  fromAnotherThread = false,
  canAttach = () => true,
  checkMove?: () => void,
) {
  if (file.size > 8192) throw new Error("Invalid Tabs surface attachment.");
  const reference = readSurfaceTarget(location, JSON.parse(await file.text()));
  const target = reference.target as Record<string, unknown>;
  const browser = target.kind === "project-tool" ? target.resource : target;
  if (!browser || typeof browser !== "object" || !("kind" in browser) || browser.kind !== "browser")
    return true;
  const attached = browser as Record<string, unknown>;
  const bridge = window.desktopBridge;
  if (!bridge || !isPrimaryEnvironment(location.environmentId ?? undefined))
    throw new Error("Open this browser attachment in its original desktop environment.");
  const sessionId = attached.tabId;
  if (typeof sessionId !== "string" || !isUserBrowserTab(sessionId))
    throw new Error("Select an open project browser tab.");
  const checkTool = () => {
    checkMove?.();
    if (target.kind !== "project-tool") return;
    const readTool = fromAnotherThread
      ? adoptProjectBrowserToolAttachment
      : readCurrentProjectBrowserTool;
    if (!readTool(location, target, sessionId))
      throw new Error("The attached project browser tool changed. Select it again.");
  };
  if (!canAttach()) return false;
  checkTool();
  const input = { projectId: location.projectId, sessionId };
  const state = await bridge.getBrowserSessionState(input);
  if (!canAttach()) return false;
  checkTool();
  const pageRef = "pageRef" in reference ? reference.pageRef : attached.pageRef;
  const instanceId =
    "browserInstanceId" in reference ? reference.browserInstanceId : attached.instanceId;
  if (typeof pageRef !== "string" || typeof instanceId !== "string")
    throw new Error("Open the exact page in Tabs before attaching it.");
  if (
    !state.currentUrl ||
    (state.profileId ?? "default") !== attached.profileId ||
    new URL(state.currentUrl).origin !== attached.origin ||
    state.instanceId !== instanceId ||
    pageRef !== state.pageRef
  )
    throw new Error("The attached page or account changed. Select it again.");
  if (state.assignedTaskId && (checkMove || state.assignedTaskId !== location.threadId))
    throw new Error("Stop browser access in the owning thread before attaching this tab here.");
  if (checkMove && (state.loading || !state.pageApprovalToken))
    throw new Error("Open the original browser tab and wait for the page to finish loading.");
  if (state.browserPageAuthorized && state.assignedTaskId === location.threadId) return true;
  const page = new URL(state.currentUrl);
  const accepted = await showCustomConfirm(
    checkMove
      ? `Move the open tab for ${page.origin}${page.pathname} in the ${attached.profileId} profile to this conversation and allow this thread to use the page?`
      : `${grantScopeQuestion(state, page, profileLabel(attached.profileId), attached.profileId)}`,
  );
  if (!accepted || !canAttach()) return false;
  checkTool();
  await bridge.runBrowserAutomation({
    ...input,
    taskId: location.threadId,
    source: "human",
    operation: "authorizeBrowserPage",
    input: {
      url: state.currentUrl,
      profileId: state.profileId ?? "default",
      instanceId: state.instanceId,
      ...(checkMove && { adoptOpenTab: true }),
      ...(state.pageApprovalToken !== undefined
        ? { pageApprovalToken: state.pageApprovalToken }
        : {}),
    },
  });
  return true;
}

export async function rememberBrowserAttachment(location: SurfaceLocation, file: File) {
  const reference = readSurfaceTarget(location, JSON.parse(await file.text()));
  const target = reference.target as Record<string, unknown>;
  if ("screenshotTransfer" in reference || "comparisonScreenshotTransfer" in reference) return file;
  const browser = target.kind === "project-tool" ? target.resource : target;
  if (!browser || typeof browser !== "object") return file;
  const { kind, tabId, profileId, pageRef, instanceId } = browser as Record<string, unknown>;
  const ref = "pageRef" in reference ? reference.pageRef : pageRef;
  const instance = "browserInstanceId" in reference ? reference.browserInstanceId : instanceId;
  const bridge = window.desktopBridge;
  if (
    (kind !== "browser" && kind !== "browser-excerpt") ||
    typeof tabId !== "string" ||
    typeof profileId !== "string" ||
    typeof ref !== "string" ||
    typeof instance !== "string" ||
    !bridge ||
    !isPrimaryEnvironment(location.environmentId ?? undefined)
  )
    return file;
  const result = await bridge.runBrowserAutomation({
    projectId: location.projectId,
    sessionId: tabId,
    source: "human",
    taskId: location.threadId,
    operation: "captureAttachedPage",
    input: { pageRef: ref, instanceId: instance, profileId },
  });
  const attachmentId =
    result &&
    typeof result === "object" &&
    "attachmentId" in result &&
    isSavedBrowserAttachmentId(result.attachmentId)
      ? result.attachmentId
      : undefined;
  const destination = { tabId, profileId, pageRef: ref, instanceId: instance };
  const evidenceDestination =
    kind === "browser" && isComparisonEvidenceDestination(destination) ? destination : undefined;
  if (!attachmentId && !evidenceDestination && !("evidenceDestination" in reference)) return file;
  return new File(
    [
      JSON.stringify(
        { ...reference, evidenceDestination, ...(attachmentId && { attachmentId }) },
        null,
        2,
      ),
    ],
    file.name,
    { type: file.type, lastModified: file.lastModified },
  );
}

const browserMoves = new Set<string>();

export async function prepareDroppedSurfaceAttachment(
  location: SurfaceLocation,
  file: File,
  canAttach = () => true,
) {
  if (file.size > 8192) throw new Error("Invalid Tabs surface attachment.");
  const value: unknown = JSON.parse(await file.text());
  const sourceThread =
    value && typeof value === "object" && "threadId" in value && typeof value.threadId === "string"
      ? value.threadId
      : undefined;
  const fromAnotherThread = sourceThread !== undefined && sourceThread !== location.threadId;
  if (fromAnotherThread) {
    const fromThreadId = ThreadId.makeUnsafe(sourceThread);
    const source = readSurfaceTarget({ ...location, threadId: fromThreadId }, value);
    const target = source.target as Record<string, unknown>;
    if (
      "attachmentId" in source ||
      "evidenceDestination" in source ||
      "screenshotTransfer" in source ||
      "comparisonScreenshotTransfer" in source
    )
      throw new Error("Open this attachment in its original project and thread.");
    if (target.kind === "device" && "surfaceId" in source && typeof source.surfaceId === "string")
      return attachSharedDevice(
        location,
        fromThreadId,
        target,
        file.name.split(" · ", 1)[0] || "Device",
        canAttach,
      );
    if (
      target.kind === "browser" &&
      "surfaceId" in source &&
      typeof source.surfaceId === "string"
    ) {
      const id = source.surfaceId;
      const sourceScope = surfaceScope({ ...location, threadId: fromThreadId });
      const destinationScope = surfaceScope(location);
      const checkSource = () => {
        const { workspaces } = useCompanionSurfaceStore.getState();
        const browser = workspaces[sourceScope]?.tabs.find((tab) => tab.id === id);
        if (
          browser?.kind !== "browser" ||
          target.tabId !== `agents-surface-${id}` ||
          target.profileId !== (browser.profileId ?? "default") ||
          target.origin !== browserOrigin(browser) ||
          !("pageRef" in source) ||
          typeof source.pageRef !== "string" ||
          source.pageRef !== browser.pageRef ||
          !("browserInstanceId" in source) ||
          typeof source.browserInstanceId !== "string" ||
          source.browserInstanceId !== browser.browserInstanceId ||
          workspaces[destinationScope]?.tabs.some((tab) => tab.id === id)
        )
          throw new Error("The original browser tab or page changed. Select it again.");
        return browser;
      };
      const browser = checkSource();
      if (browserMoves.has(id)) throw new Error("This browser tab already has a pending move.");
      const attachment = surfaceAttachmentFile(location, browser);
      if (!attachment) throw new Error("Open the original browser page before attaching it.");
      browserMoves.add(id);
      try {
        if (!(await approveDroppedBrowserTab(location, attachment, false, canAttach, checkSource)))
          return null;
        // Once the desktop accepts the confirmed grant, preserve its exact guest in
        // the receiving conversation even if the user navigated while IPC was settling.
        if (!useCompanionSurfaceStore.getState().moveBrowser(sourceScope, destinationScope, id))
          throw new Error("This browser tab closed or moved. Open it in the owning conversation.");
        return rememberBrowserAttachment(location, attachment);
      } finally {
        browserMoves.delete(id);
      }
    }
    if (target.kind !== "project-tool")
      throw new Error("Open this attachment in its original project and thread.");
    const browser = target.resource as Partial<Record<string, unknown>> | undefined;
    if (
      browser?.kind !== "browser" ||
      typeof browser.tabId !== "string" ||
      typeof browser.instanceId !== "string" ||
      typeof browser.profileId !== "string" ||
      typeof browser.origin !== "string" ||
      typeof browser.pageRef !== "string"
    )
      throw new Error("Select the open project browser tab again in this thread.");
    const tool = adoptProjectBrowserToolAttachment(location, target, browser.tabId);
    if (!tool) throw new Error("The attached project browser tool changed. Select it again.");
    file = projectToolSurfaceAttachmentFile(location, {
      label: tool.label,
      target: {
        kind: "project-tool",
        toolId: tool.id,
        toolKind: tool.kind,
        instanceId: tool.attachmentInstanceId,
        resource: {
          kind: "browser",
          tabId: browser.tabId,
          instanceId: browser.instanceId,
          profileId: browser.profileId,
          origin: browser.origin,
          pageRef: browser.pageRef,
        },
      },
    });
  }
  return (await approveDroppedBrowserTab(location, file, fromAnotherThread, canAttach))
    ? rememberBrowserAttachment(location, file)
    : null;
}

/** Reveal a surface or a desktop-verified page bookmark after the user clicks it. */
export function revealSurfaceReference(
  location: SurfaceLocation,
  reference: unknown,
  canReveal = () => true,
) {
  if (!canReveal()) return;
  const value = readSurfaceTarget(location, reference);
  const stored = value.target as Record<string, unknown>;
  const attachmentId = "attachmentId" in value ? value.attachmentId : undefined;
  if (attachmentId !== undefined && !isSavedBrowserAttachmentId(attachmentId))
    throw new Error("Invalid saved page attachment.");
  if (stored.kind === "native-window") {
    const selector = stored.selector;
    if (typeof selector !== "string" || !isPrimaryEnvironment(location.environmentId ?? undefined))
      throw new Error("Open this window attachment on its original desktop.");
    return environmentApi(location.environmentId).then(async (api) => {
      if (!canReveal()) return;
      try {
        await api.server.nativeComputer({ op: "reveal", threadId: location.threadId, selector });
      } catch {
        // A stale selector (restart, closed window, released grant) is expected here.
        throw new NativeWindowUnavailableError();
      }
    });
  }
  if (stored.kind === "terminal") return revealTerminalAttachment(location, stored, canReveal);
  if (stored.kind === "project-tool")
    return revealProjectToolAttachment(location, stored, canReveal, attachmentId);
  const scope = surfaceScope(location);
  const store = useCompanionSurfaceStore.getState();
  const surfaceId = "surfaceId" in value ? value.surfaceId : undefined;
  const tab = store.workspaces[scope]?.tabs.find((candidate) => candidate.id === surfaceId);
  const identity = tab && targetIdentity(tab);
  const pageRef = "pageRef" in value ? value.pageRef : undefined;
  const isBrowserExcerpt = stored.kind === "browser-excerpt";
  if (
    isBrowserExcerpt &&
    (typeof pageRef !== "string" ||
      !pageRef ||
      !("browserInstanceId" in value) ||
      typeof value.browserInstanceId !== "string" ||
      !value.browserInstanceId)
  )
    throw new Error("The attached browser excerpt has no original page reference.");
  const expected =
    isBrowserExcerpt && identity?.kind === "browser"
      ? { ...identity, kind: "browser-excerpt" }
      : identity;
  if (
    !tab ||
    !expected ||
    Object.entries(expected).some(([key, v]) => !(pageRef && key === "origin") && stored[key] !== v)
  )
    throw new Error("The attached target is closed or its identity has changed.");
  const reveal = () => {
    if (!canReveal()) return;
    store.activate(scope, tab.id);
    useRightPanelStore.getState().openPanel(tab.kind);
  };
  if (identity?.kind === "browser" && pageRef) {
    const stillSelected = () =>
      canReveal() &&
      useCompanionSurfaceStore
        .getState()
        .workspaces[scope]?.tabs.some(
          (candidate) =>
            candidate.id === tab.id &&
            candidate.kind === "browser" &&
            (candidate.profileId ?? "default") === identity.profileId,
        ) === true;
    const transfer =
      !isBrowserExcerpt && "screenshotTransfer" in value ? value.screenshotTransfer : undefined;
    const pair =
      !isBrowserExcerpt && "comparisonScreenshotTransfer" in value
        ? value.comparisonScreenshotTransfer
        : undefined;
    if (
      (attachmentId && (transfer || pair)) ||
      (transfer && pair) ||
      (pair !== undefined && !matchesComparisonScreenshotPair(pair))
    )
      throw new Error("Invalid screenshot draft attachment.");
    const grantId = pair
      ? pair.source.grantId
      : transfer && typeof transfer === "object" && "grantId" in transfer
        ? transfer.grantId
        : undefined;
    const pairedGrantId = pair?.target.grantId;
    const bridge = window.desktopBridge;
    if (
      typeof pageRef !== "string" ||
      !bridge ||
      !isPrimaryEnvironment(location.environmentId ?? undefined)
    )
      throw new Error("Open this page in the Tabs desktop browser.");
    return (async () => {
      const saved =
        attachmentId ??
        (isSavedBrowserAttachmentId(grantId)
          ? { grantId, pageRef, ...(pairedGrantId ? { pairedGrantId } : {}) }
          : undefined);
      if (saved) {
        const url = await revealSavedBrowserAttachment(
          location,
          identity.tabId,
          identity.profileId,
          saved,
          stillSelected,
        );
        if (!stillSelected()) return;
        if (url !== undefined) {
          store.update(scope, tab.id, { url });
          reveal();
          return;
        }
      }
      if ("browserInstanceId" in value) {
        const state = await bridge.getBrowserSessionState({
          projectId: location.projectId,
          sessionId: identity.tabId,
        });
        if (
          state.instanceId !== value.browserInstanceId ||
          (isBrowserExcerpt &&
            (state.projectId !== location.projectId ||
              state.sessionId !== identity.tabId ||
              (state.profileId ?? "default") !== identity.profileId))
        ) {
          throw new Error("The attached browser tab was replaced.");
        }
      }
      if (!stillSelected()) return;
      await bridge.runBrowserAutomation({
        projectId: location.projectId,
        sessionId: identity.tabId,
        source: "human",
        taskId: location.threadId,
        operation: "enterAttachedPage",
        input: {
          pageRef,
          profileId: identity.profileId,
          grantId,
          ...(pairedGrantId ? { pairedGrantId } : {}),
        },
      });
      if (stillSelected()) reveal();
    })();
  }
  reveal();
}

async function revealTerminalAttachment(
  location: SurfaceLocation,
  target: Record<string, unknown>,
  canReveal: () => boolean,
) {
  if (
    target.threadId !== location.threadId ||
    typeof target.terminalId !== "string" ||
    typeof target.instanceId !== "string" ||
    !(await terminalAttachmentIsCurrent(
      location.environmentId,
      target as unknown as TerminalAttachmentTarget,
    )) ||
    !getThreadTerminalState(location.threadId).terminalIds.includes(target.terminalId)
  ) {
    throw new Error("The attached terminal is closed or has been restarted.");
  }
  if (!canReveal()) return;
  terminalActions.setActive(location.threadId, target.terminalId);
  const scope = surfaceScope(location);
  const store = useCompanionSurfaceStore.getState();
  const workspace = store.workspaces[scope];
  const tab =
    workspace?.tabs.find((item) => item.kind === "terminal" && item.id === workspace.activeId) ??
    workspace?.tabs.find((item) => item.kind === "terminal");
  if (tab) store.activate(scope, tab.id);
  else store.open(scope, "terminal");
  useRightPanelStore.getState().openPanel("terminal");
}

export async function openSurfaceAttachment(
  location: SurfaceLocation,
  file: { id: string; name: string; mimeType: string; sizeBytes: number },
  canReveal?: () => boolean,
) {
  if (file.sizeBytes > 8192) throw new Error("Invalid Tabs surface attachment.");
  const api = await environmentApi(location.environmentId);
  const asset = await api.assets.createUrl({
    resource: {
      _tag: "attachment",
      attachmentId: file.id,
      fileName: file.name,
      mimeType: file.mimeType,
      disposition: "inline",
    },
  });
  const response = await fetch(asset.relativeUrl);
  if (!response.ok) throw new Error("The surface attachment could not be read.");
  await revealSurfaceReference(location, await response.json(), canReveal);
}

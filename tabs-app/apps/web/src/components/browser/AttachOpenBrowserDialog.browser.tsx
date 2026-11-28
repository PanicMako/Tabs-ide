import "../../index.css";
import { EnvironmentId, ThreadId } from "@tabs/contracts";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useComposerDraftStore } from "~/composerDraftStore";
import { setPrimaryEnvironmentIdForTesting } from "~/connection/environmentApiRegistry";
import { surfaceScope } from "~/lib/threadSurfaceAttachment";
import { scopedComposerThreadId } from "~/state/composerDrafts";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { GlobalConfirmDialog } from "../GlobalConfirmDialog";
import { LauncherSurface } from "../quick-actions/QuickActions";
import { QUICK_ACTIONS } from "../quick-actions/actions";
import { AttachOpenBrowserDialog } from "./AttachOpenBrowserDialog";

it("moves the selected Work browser and attaches it using the keyboard", async () => {
  const location = {
    environmentId: EnvironmentId.make("desktop"),
    threadId: ThreadId.make("checkout"),
    projectId: "project",
  };
  const source = { ...location, threadId: ThreadId.make("reports") };
  const url = "https://reports.example/draft/42?account=private";
  const pageRef = "b".repeat(64);
  const originalBridge = window.desktopBridge;
  const oldDrafts = useComposerDraftStore.getState().draftsByThreadId;
  const oldWorkspaces = useCompanionSurfaceStore.getState().workspaces;
  const store = useCompanionSurfaceStore.getState();
  const work = store.open(surfaceScope(source), "browser", {
    url,
    pageRef,
    browserInstanceId: "exact-guest",
    profileId: "Work",
    title: "QA checklist",
  });
  const personal = store.open(surfaceScope(source), "browser", {
    url,
    pageRef: "a".repeat(64),
    browserInstanceId: "other-guest",
    profileId: "Personal",
    title: "QA checklist",
  });
  const sessionId = `agents-surface-${work}`;
  const runBrowserAutomation = vi.fn(async () => ({
    approved: true,
    attachmentId: "aeb67fc2-e8f5-4633-9e0d-de619b5d0060",
  }));
  window.desktopBridge = {
    getBrowserSessionState: vi.fn(async () => ({
      projectId: location.projectId,
      sessionId,
      pageRef,
      currentUrl: url,
      profileId: "Work",
      instanceId: "exact-guest",
      assignedTaskId: null,
      pageApprovalToken: "page-token",
      loading: false,
    })),
    runBrowserAutomation,
  } as unknown as NonNullable<Window["desktopBridge"]>;
  setPrimaryEnvironmentIdForTesting(location.environmentId);

  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        {open ? (
          <AttachOpenBrowserDialog
            location={location}
            threads={new Map([[source.threadId, "Reports"]])}
            isCurrent={() => true}
            onClose={() => setOpen(false)}
          />
        ) : (
          <LauncherSurface
            design="compass"
            actions={QUICK_ACTIONS}
            execute={async (id) => {
              if (id === "attach-open-browser") setOpen(true);
            }}
            disabled={() => undefined}
            preview
          />
        )}
        <GlobalConfirmDialog />
      </>
    );
  }

  const view = await render(<Harness />);
  try {
    (page.getByRole("button", { name: "More actions" }).element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    const action = page.getByRole("button", { name: "Attach an open browser tab", exact: true });
    await expect.element(action).toBeVisible();
    (action.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    const dialog = page.getByRole("dialog", { name: "Attach an open browser tab" });
    const target = dialog.getByRole("button", { name: /QA checklist.*Work · Reports/ });
    await expect.element(target).toBeVisible();
    await expect.element(dialog.getByRole("button", { name: /Personal · Reports/ })).toBeVisible();
    (target.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    const review = page.getByRole("dialog", { name: "Confirm" });
    await expect
      .element(review)
      .toHaveTextContent("https://reports.example/draft/42 in the Work profile");
    expect(runBrowserAutomation).not.toHaveBeenCalled();
    const submit = review.getByRole("button", { name: "Confirm", exact: true });
    (submit.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(dialog).not.toBeInTheDocument();
    expect(runBrowserAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: location.threadId,
        sessionId,
        operation: "authorizeBrowserPage",
        input: expect.objectContaining({
          profileId: "Work",
          pageApprovalToken: "page-token",
          adoptOpenTab: true,
        }),
      }),
    );
    const draftKey = scopedComposerThreadId(location.environmentId, location.threadId);
    const file = useComposerDraftStore.getState().draftsByThreadId[draftKey]!.files[0]!.file!;
    expect(JSON.parse(await file.text())).toMatchObject({
      threadId: location.threadId,
      target: { kind: "browser", tabId: sessionId, profileId: "Work" },
    });
    expect(
      useCompanionSurfaceStore.getState().workspaces[surfaceScope(source)]?.tabs,
    ).toMatchObject([{ id: personal, profileId: "Personal" }]);
  } finally {
    await view.unmount();
    setPrimaryEnvironmentIdForTesting(null);
    useComposerDraftStore.setState({ draftsByThreadId: oldDrafts });
    useCompanionSurfaceStore.setState({ workspaces: oldWorkspaces });
    if (originalBridge) window.desktopBridge = originalBridge;
    else delete window.desktopBridge;
  }
});

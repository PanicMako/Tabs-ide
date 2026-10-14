import "../../../index.css";
import { ThreadId, EnvironmentId } from "@tabs/contracts";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useComposerDraftStore } from "~/composerDraftStore";
import { scopedComposerThreadId } from "~/state/composerDrafts";
import { CompanionTerminalPanel } from "./CompanionTerminalPanel";
import type { TerminalContextSelection } from "~/lib/terminalContext";

vi.mock("~/hooks/useActiveProjectTarget", () => ({
  useActiveProjectTarget: () => ({
    projectId: "project",
    projectName: "Project",
    cwd: "/workspace",
    environmentId: "environment",
    threadId: "thread",
  }),
}));
vi.mock("~/state/terminal", () => ({
  useThreadTerminalState: () => ({
    terminalIds: ["terminal"],
    activeTerminalId: "terminal",
    terminalGroups: [],
    activeTerminalGroupId: null,
  }),
  terminalActions: { split: vi.fn(), new: vi.fn(), setActive: vi.fn(), close: vi.fn() },
}));
vi.mock("~/components/ThreadTerminalDrawer", () => ({
  default: ({
    onAddTerminalContext,
  }: {
    onAddTerminalContext: (selection: TerminalContextSelection) => void;
  }) => (
    <button
      onClick={() =>
        onAddTerminalContext({
          terminalId: "terminal",
          terminalLabel: "Shell",
          lineStart: 1,
          lineEnd: 1,
          text: "build failed",
        })
      }
    >
      Add selection to composer
    </button>
  ),
}));

it("attaches terminal selections to the correct environment's composer", async () => {
  const thread = ThreadId.makeUnsafe("thread");
  const storageId = scopedComposerThreadId(EnvironmentId.makeUnsafe("environment"), thread);
  const view = await render(<CompanionTerminalPanel threadId={thread} />);
  try {
    await page.getByRole("button", { name: "Add selection to composer" }).click();
    const draft = useComposerDraftStore.getState().draftsByThreadId[storageId];
    expect(draft?.terminalContexts).toHaveLength(1);
    expect(draft?.terminalContexts[0]?.text).toBe("build failed");
    expect(draft?.prompt).toContain("\uFFFC");
    expect(useComposerDraftStore.getState().draftsByThreadId[thread]).toBeUndefined();
  } finally {
    await view.unmount();
  }
});

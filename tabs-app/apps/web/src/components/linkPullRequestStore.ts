import type { ThreadId } from "@tabs/contracts";
import { create } from "zustand";

interface LinkPullRequestState {
  readonly target: { readonly threadId: ThreadId; readonly title: string } | null;
  openFor: (target: { threadId: ThreadId; title: string }) => void;
  close: () => void;
}

/** The thread whose "Link pull request" dialog is open, if any. */
export const useLinkPullRequestStore = create<LinkPullRequestState>((set) => ({
  target: null,
  openFor: (target) => set({ target }),
  close: () => set({ target: null }),
}));

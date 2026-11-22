import { useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
import { toastManager } from "../ui/toast";
import { needsFromItems, type TeammatesCornerAvatarProps } from "./TeammatesCornerAvatar";
import { askTeammate, openHomeChat, openThread } from "./teammatesActions";
import { activityFor, badgeCount, openSuggestionCount } from "./teammates.logic";
import { useTeammatesUiStore } from "./teammatesStore";
import { useTeammatesData } from "./useTeammates";

/**
 * What the pinned teammate's avatar needs to draw itself and answer: its mood, what needs the
 * owner, and the actions in its card. Shared by the floating avatar and the minimised one in the
 * top bar, so both ask, open chats and switch teammates the same way.
 */
export function useAvatarProps(): Omit<TeammatesCornerAvatarProps, "visible" | "onExited"> | null {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const { teammates, pinned, snapshot } = useTeammatesData();
  const panelOpen = useTeammatesUiStore((state) => state.panelOpen);
  const setPanelOpen = useTeammatesUiStore((state) => state.setPanelOpen);
  const setPinned = useTeammatesUiStore((state) => state.setPinnedTeammateId);
  const setCornerHidden = useTeammatesUiStore((state) => state.setCornerHidden);
  const activity = pinned && snapshot ? activityFor(snapshot.activity, pinned.id) : null;
  return pinned && activity && snapshot
    ? {
        teammate: pinned,
        mood: activity.mood,
        label: activity.label,
        finish: pinned.finish,
        badge: badgeCount(activity, openSuggestionCount(snapshot.suggestions, pinned.id)),
        needs: needsFromItems(snapshot.items, pinned.id),
        teammates,
        open: panelOpen,
        onToggle: () => {
          const state = useTeammatesUiStore.getState();
          if (!state.panelOpen) state.setActiveTeammateId(pinned.id);
          setPanelOpen(!state.panelOpen);
        },
        onAsk: async (text: string) => {
          const threadId = await askTeammate(pinned.id, text, {
            busy: activity.mood === "thinking",
          });
          if (!threadId) return false;
          toastManager.add({
            type: "success",
            title: `Sent to ${pinned.name}`,
            actionProps: {
              children: "Open chat",
              onClick: () => void openThread(threadId, navigateRef.current),
            },
          });
          return true;
        },
        onOpenChat: () => void openHomeChat(pinned.id, navigateRef.current),
        onOpenSpace: () => {
          useTeammatesUiStore.getState().setActiveTeammateId(pinned.id);
          setPanelOpen(true);
        },
        onPin: setPinned,
        // Minimised: it tucks into the top bar, where its icon brings it back.
        onHide: () => setCornerHidden(true),
      }
    : null;
}

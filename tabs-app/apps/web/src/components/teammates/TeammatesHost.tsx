import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import type { ThreadId } from "@tabs/contracts";
import { toastManager } from "../ui/toast";
import { TeammatesCornerAvatar } from "./TeammatesCornerAvatar";
import { TeammatesPanel } from "./TeammatesPanel";
import { openHomeChat, openThread, teammatesApi, errorMessage } from "./teammatesActions";
import { createNoticeTracker, noticeToToast } from "./teammates.logic";
import { useTeammatesStore, useTeammatesUiStore } from "./teammatesStore";
import { useAvatarProps } from "./useAvatarProps";
import { useTeammatesData, useTeammatesEnabled } from "./useTeammates";

/**
 * Mounted once. Does nothing unless the Labs switch is on: then it subscribes to the teammates
 * stream, toasts new notices, answers "open home chat" requests and draws the corner avatar
 * and the panel.
 */
export function TeammatesHost() {
  const enabled = useTeammatesEnabled();
  if (!enabled) return null;
  return <EnabledHost />;
}

function EnabledHost() {
  const navigate = useNavigate();
  const { teammates, active, pinned, snapshot } = useTeammatesData();
  const setSnapshot = useTeammatesStore((state) => state.setSnapshot);
  const setError = useTeammatesStore((state) => state.setError);
  const cornerHidden = useTeammatesUiStore((state) => state.cornerHidden);
  const panelOpen = useTeammatesUiStore((state) => state.panelOpen);
  const setPanelOpen = useTeammatesUiStore((state) => state.setPanelOpen);
  const setPinned = useTeammatesUiStore((state) => state.setPinnedTeammateId);
  const setCornerHidden = useTeammatesUiStore((state) => state.setCornerHidden);
  const homeRequest = useTeammatesUiStore((state) => state.homeRequest);
  const tracker = useRef(createNoticeTracker());
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const teammatesRef = useRef(teammates);
  teammatesRef.current = teammates;

  useEffect(() => {
    const noticeTracker = tracker.current;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = teammatesApi().subscribe(
        (value) => {
          setSnapshot(value);
          for (const notice of noticeTracker.next(value.notices)) {
            const toast = noticeToToast(notice, value.teammates);
            const threadId = toast.threadId as ThreadId | null;
            toastManager.add({
              type: toast.type,
              title: toast.title,
              description: toast.description,
              actionProps: {
                children: "Open",
                onClick: () => {
                  if (threadId) void openThread(threadId, navigateRef.current);
                  else useTeammatesUiStore.getState().setPanelOpen(true);
                },
              },
            });
          }
        },
        (error) => setError(errorMessage(error)),
      );
    } catch (error) {
      setError(errorMessage(error));
    }
    return () => {
      unsubscribe?.();
      noticeTracker.reset();
      setSnapshot(null);
    };
  }, [setError, setSnapshot]);

  // Quick action / palette: open a teammate's home chat.
  const handled = useRef(homeRequest?.nonce ?? 0);
  useEffect(() => {
    if (!homeRequest || homeRequest.nonce === handled.current) return;
    handled.current = homeRequest.nonce;
    const target =
      teammatesRef.current.find((teammate) => teammate.id === homeRequest.teammateId) ??
      active ??
      pinned;
    if (target) void openHomeChat(target.id, navigateRef.current);
  }, [homeRequest, active, pinned]);

  const avatarProps = useAvatarProps();
  return (
    <>
      <AvatarPresence props={avatarProps} show={!cornerHidden} />
      <TeammatesPanel />
    </>
  );
}

/** Keeps the avatar mounted while its exit plays, then drops it. */
function AvatarPresence({
  props,
  show,
}: {
  props: Omit<ComponentProps<typeof TeammatesCornerAvatar>, "visible" | "onExited"> | null;
  show: boolean;
}) {
  const last = useRef(props);
  if (props) last.current = props;
  const visible = show && props !== null;
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  if (!mounted || !last.current) return null;
  return (
    <TeammatesCornerAvatar {...last.current} visible={visible} onExited={() => setMounted(false)} />
  );
}

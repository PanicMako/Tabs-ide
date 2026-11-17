import gsap from "gsap";
import { type RefObject, useLayoutEffect, useRef } from "react";
import { playLookEnter } from "../lib/motion";
import { MOTION_CLEAR_PROPS } from "../lib/motionProfiles";
import { useSurfaceMotionSettings } from "../panelAnimations";

/** Rail and panel widths of the Agents sidebar, matching its `w-[52px]` / `w-72` classes. */
export const AGENTS_SIDEBAR_COLLAPSED_PX = 52;
export const AGENTS_SIDEBAR_EXPANDED_PX = 288;

const WIDTH_DURATION_S = 0.22;
/** Content waits until the panel is nearly open, so it appears rather than unrolls. */
const CONTENT_DELAY_S = 0.15;

/** Inline styles the motion puts on the chat pane's content while the sidebar moves. */
const FROZEN_PROPS = "width,flexShrink,alignSelf";
/** Keeps the moving width from re-laying out anything outside the sidebar and the pane box. */
const CONTAIN_PROPS = "contain";

/**
 * Collapse/expand motion for the Agents sidebar.
 *
 * The panel changes width quickly while its content is hidden, then the content fades in once
 * the panel is (nearly) there. Revealing the full content through a growing width read as paper
 * unrolling; hiding it during the move reads as the panel opening and settling.
 *
 * The chat pane beside it is laid out once at its final width and pinned to the right edge, so
 * its markdown, composer and container queries do not re-wrap on every frame — the pane only
 * clips. Toggling again mid-way continues from wherever the sidebar is.
 */
export function useAgentsSidebarMotion(
  ref: RefObject<HTMLElement | null>,
  collapsed: boolean,
): void {
  const { active, seconds, profile } = useSurfaceMotionSettings();
  const previous = useRef(collapsed);
  /** The sidebar's on-screen width when an unfinished motion was interrupted. */
  const liveWidth = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || previous.current === collapsed) return;
    previous.current = collapsed;
    const interruptedAt = liveWidth.current;
    liveWidth.current = null;
    if (!active) return;

    const to = collapsed ? AGENTS_SIDEBAR_COLLAPSED_PX : AGENTS_SIDEBAR_EXPANDED_PX;
    const from =
      interruptedAt ?? (collapsed ? AGENTS_SIDEBAR_EXPANDED_PX : AGENTS_SIDEBAR_COLLAPSED_PX);
    const pane = element.nextElementSibling as HTMLElement | null;
    const paneContent = pane?.firstElementChild as HTMLElement | null;
    const content = Array.from(element.children);

    // The class already holds the final width, so this is the pane's final width.
    const paneFinalWidth = pane?.getBoundingClientRect().width ?? 0;
    if (paneContent && paneFinalWidth > 0) {
      gsap.set(paneContent, { width: paneFinalWidth, flexShrink: 0, alignSelf: "flex-end" });
    }

    gsap.set(element, { contain: "layout paint" });
    if (pane) gsap.set(pane, { contain: "layout paint" });
    const release = () => {
      if (paneContent) gsap.set(paneContent, { clearProps: FROZEN_PROPS });
      gsap.set(element, { clearProps: CONTAIN_PROPS });
      if (pane) gsap.set(pane, { clearProps: CONTAIN_PROPS });
    };
    const widthTween = gsap.fromTo(
      element,
      { width: from },
      {
        width: to,
        duration: seconds(WIDTH_DURATION_S),
        // No overshoot: the width lands on its mark; the content carries the style's character.
        ease: profile.ease,
        clearProps: "width",
        onComplete: release,
      },
    );
    const contentTween =
      content.length > 0
        ? playLookEnter(
            content,
            "sidebar",
            { seconds, profile },
            {
              stagger: 0.008,
              delay: CONTENT_DELAY_S,
              extra: collapsed ? {} : { x: -4 },
            },
          )
        : null;
    return () => {
      if (widthTween.isActive()) liveWidth.current = element.getBoundingClientRect().width;
      widthTween.kill();
      contentTween?.kill();
      gsap.set(element, { clearProps: "width" });
      if (content.length) gsap.set(content, { clearProps: MOTION_CLEAR_PROPS });
      release();
    };
  }, [active, collapsed, profile, ref, seconds]);
}

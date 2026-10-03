import type { AssistantCitation, MessageId, ScopedThreadRef } from "@tabs/contracts";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import {
  resolveAssistantCitationRange,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import { toastManager } from "../ui/toast";

const CITATION_PULSE_DURATION_MS = 650;
// The second pulse settles into a held highlight so late glances still find the quote.
const CITATION_HIGHLIGHT_HOLD_MS = 1575;
const CITATION_HIGHLIGHT_FADE_MS = 450;
const CITATION_HIGHLIGHT_TOTAL_MS =
  1.5 * CITATION_PULSE_DURATION_MS + CITATION_HIGHLIGHT_HOLD_MS + CITATION_HIGHLIGHT_FADE_MS;
const CITATION_HIGHLIGHT_OPACITY = "--assistant-citation-highlight-opacity";
// Matches the comment-editing highlight strength in index.css.
const CITATION_HIGHLIGHT_PEAK = 0.45;
const COMMENT_HIGHLIGHT_NAME = "tabs-assistant-citation-comment";
const ALT_COMMENT_HIGHLIGHT_NAME = "t3-assistant-citation-comment";
const CITATION_HIGHLIGHT_NAME = "tabs-assistant-citation";
const ALT_CITATION_HIGHLIGHT_NAME = "t3-assistant-citation";

/** Minimal duck-typed list interface compatible with virtual list and DOM scroll containers */
export interface AssistantCitationListHandle {
  getScrollableNode(): HTMLElement | null;
  getState(): {
    readonly scroll: number;
    readonly indexByKey: (key: string) => number | undefined;
    readonly sizeAtIndex: (index: number) => number | undefined;
    readonly listenToPosition: (key: string, callback: () => void) => () => void;
    readonly listen: (signal: string, callback: () => void) => () => void;
  };
  scrollToOffset(options: { offset: number; animated?: boolean }): Promise<void>;
}

export function createDomCitationListHandle(
  scrollContainer: HTMLElement,
): AssistantCitationListHandle {
  return {
    getScrollableNode: () => scrollContainer,
    getState: () => ({
      scroll: scrollContainer.scrollTop,
      indexByKey: () => 0,
      sizeAtIndex: () => 1,
      listenToPosition: () => () => {},
      listen: (signal: string, callback: () => void) => {
        if (signal === "scroll") {
          scrollContainer.addEventListener("scroll", callback, { passive: true });
          return () => scrollContainer.removeEventListener("scroll", callback);
        }
        return () => {};
      },
    }),
    scrollToOffset: async ({ offset, animated }) => {
      scrollContainer.scrollTo({
        top: offset,
        behavior: animated ? "smooth" : "auto",
      });
    },
  };
}

/** Keep source text marked while its comment editor is open, without changing native selection. */
export function observeAssistantCitationCommentSource({
  anchor,
  citation,
  onUnavailable,
}: {
  anchor: AssistantCitationSourceAnchor;
  citation: AssistantCitation;
  onUnavailable: () => void;
}): () => void {
  const { source, range, viewport } = anchor;
  const registry = typeof CSS !== "undefined" ? CSS.highlights : undefined;
  let highlight: Highlight | null = null;
  let stopped = false;
  const observer = new MutationObserver((records) => {
    if (stopped) return;
    const sourceChanged = records.some((record) => source.contains(record.target));
    validate(sourceChanged);
  });
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    if (!highlight) return;
    highlight.delete(range);
    if (highlight.size === 0) {
      if (registry?.get(COMMENT_HIGHLIGHT_NAME) === highlight) {
        registry.delete(COMMENT_HIGHLIGHT_NAME);
      }
      if (registry?.get(ALT_COMMENT_HIGHLIGHT_NAME) === highlight) {
        registry.delete(ALT_COMMENT_HIGHLIGHT_NAME);
      }
    }
  };
  const unavailable = () => {
    if (stopped) return;
    dispose();
    onUnavailable();
  };
  const validate = (sourceChanged: boolean): boolean => {
    if (!source.isConnected || !viewport.contains(source)) {
      unavailable();
      return false;
    }
    if (
      sourceChanged ||
      range.collapsed ||
      !source.contains(range.startContainer) ||
      !source.contains(range.endContainer)
    ) {
      const repaired = resolveAssistantCitationRange(source, citation);
      if (!repaired) {
        unavailable();
        return false;
      }
      range.setStart(repaired.startContainer, repaired.startOffset);
      range.setEnd(repaired.endContainer, repaired.endOffset);
    }
    return true;
  };

  if (!validate(false)) return dispose;
  if (typeof Highlight !== "undefined" && registry) {
    const existing =
      registry.get(COMMENT_HIGHLIGHT_NAME) ?? registry.get(ALT_COMMENT_HIGHLIGHT_NAME);
    highlight = existing ?? new Highlight();
    highlight.add(range);
    if (!existing) {
      registry.set(COMMENT_HIGHLIGHT_NAME, highlight);
      registry.set(ALT_COMMENT_HIGHLIGHT_NAME, highlight);
    }
  }
  observer.observe(viewport, { childList: true, subtree: true, characterData: true });
  return dispose;
}

export interface AssistantCitationRequest {
  citation: AssistantCitation;
  key: string;
}

/** Navigation owns the ref so virtual row remounts cannot replay an activation. */
export interface AssistantCitationTarget extends AssistantCitationRequest {
  activationRef: RefObject<{
    scrolled: boolean;
    dismissed: boolean;
    cancelScroll?: () => void;
    pulse?: { startedAt: number; reducedMotion: boolean };
  }>;
  onComplete: () => void;
}

/** Observe only the active source, including virtual containers moved above its root. */
export function observeAssistantCitationSource({
  root,
  itemKey,
  request,
  list,
}: {
  root: HTMLElement;
  itemKey: string;
  request: AssistantCitationTarget;
  list: AssistantCitationListHandle;
}) {
  const activation = request.activationRef.current;
  if (activation.dismissed) return;
  const scrollNode = list.getScrollableNode();
  if (!(scrollNode instanceof HTMLElement)) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let highlighted: Highlight | null = null;
  let ownedRange: Range | null = null;
  let selected: { range: Range; snapshot: Range } | null = null;
  let frame: number | null = null;
  let scrolling = false;
  let stopped = false;
  let pulseAnimation: Animation | null = null;
  let canReplaceSelection = !activation.scrolled;
  const ownsSelection = (selection: Selection | null) =>
    selected !== null &&
    selection?.rangeCount === 1 &&
    selection.getRangeAt(0) === selected.range &&
    selected.range.startContainer === selected.snapshot.startContainer &&
    selected.range.startOffset === selected.snapshot.startOffset &&
    selected.range.endContainer === selected.snapshot.endContainer &&
    selected.range.endOffset === selected.snapshot.endOffset;
  const clear = () => {
    if (highlighted) {
      if (CSS.highlights.get(CITATION_HIGHLIGHT_NAME) === highlighted) {
        CSS.highlights.delete(CITATION_HIGHLIGHT_NAME);
      }
      if (CSS.highlights.get(ALT_CITATION_HIGHLIGHT_NAME) === highlighted) {
        CSS.highlights.delete(ALT_CITATION_HIGHLIGHT_NAME);
      }
    }
    highlighted = null;
    ownedRange = null;
    const selection = selected ? root.ownerDocument.getSelection() : null;
    if (selected && ownsSelection(selection)) selection?.removeRange(selected.range);
    selected = null;
    delete root.dataset.citationHighlighted;
  };
  const finishHighlight = () => {
    if (stopped) return;
    activation.dismissed = true;
    dispose();
  };
  const highlight = () => {
    frame = null;
    if (stopped || activation.dismissed || !root.isConnected || !scrollNode.contains(root)) {
      clear();
      return;
    }
    if (
      activation.pulse &&
      performance.now() - activation.pulse.startedAt >= CITATION_HIGHLIGHT_TOTAL_MS
    ) {
      finishHighlight();
      return;
    }
    const state = list.getState();
    const index = state.indexByKey(itemKey);
    const size = index !== undefined ? state.sizeAtIndex(index) : undefined;
    if (index === undefined || size === undefined || !(size > 0)) return;
    const range = resolveAssistantCitationRange(root, request.citation);
    const rect = (range ?? root).getBoundingClientRect();
    if (rect.height <= 0 || scrollNode.clientHeight <= 0) {
      clear();
      return;
    }
    if (!activation.scrolled) {
      if (scrolling) return;
      const scrollRect = scrollNode.getBoundingClientRect();
      const offset = Math.max(
        0,
        Math.min(
          scrollNode.scrollHeight - scrollNode.clientHeight,
          state.scroll + rect.top - scrollRect.top - Math.min(120, scrollNode.clientHeight / 3),
        ),
      );
      if (Math.abs(offset - state.scroll) > 1) {
        scrolling = true;
        void list.scrollToOffset({ offset, animated: !reducedMotion }).then(
          () => {
            scrolling = false;
            if (!stopped && !activation.dismissed) schedule();
          },
          () => {
            scrolling = false;
            if (stopped || activation.dismissed) return;
            activation.dismissed = true;
            clear();
            request.onComplete();
            toastManager.add({
              type: "warning",
              title: "Could not open the cited response",
              description: "Click the citation to try again.",
            });
          },
        );
        return;
      }
      // A prepend or row measurement can still change geometry during the scroll promise.
      if (rect.bottom <= scrollRect.top || rect.top >= scrollRect.bottom) return;
      activation.scrolled = true;
      request.onComplete();
      if (!range) {
        toastManager.add({
          type: "warning",
          title: "The quoted text has changed",
          description: "Showing the source response. The saved quote is unchanged.",
        });
      }
    }
    if (!range) {
      finishHighlight();
      return;
    }
    if (typeof Highlight !== "undefined" && typeof CSS !== "undefined" && CSS.highlights) {
      highlighted = new Highlight(range);
      CSS.highlights.set(CITATION_HIGHLIGHT_NAME, highlighted);
      CSS.highlights.set(ALT_CITATION_HIGHLIGHT_NAME, highlighted);
      ownedRange = range;
      root.dataset.citationHighlighted = "true";
    } else {
      const selection = root.ownerDocument.getSelection();
      // Only a fresh activation may replace a selection we do not own.
      if (selection && (canReplaceSelection || ownsSelection(selection))) {
        selection.removeAllRanges();
        selection.addRange(range);
        selected = { range: selection.getRangeAt(0), snapshot: range.cloneRange() };
        canReplaceSelection = false;
        ownedRange = range;
        root.dataset.citationHighlighted = "true";
      } else {
        finishHighlight();
        return;
      }
    }
    if (!pulseAnimation) {
      // Preserve the original deadline through virtual remounts and range repairs.
      const pulse = (activation.pulse ??= {
        startedAt: performance.now(),
        reducedMotion,
      });
      const at = (milliseconds: number) => milliseconds / CITATION_HIGHLIGHT_TOTAL_MS;
      const holdEnd = at(CITATION_HIGHLIGHT_TOTAL_MS - CITATION_HIGHLIGHT_FADE_MS);
      pulseAnimation = root.animate(
        pulse.reducedMotion
          ? [
              { offset: 0, [CITATION_HIGHLIGHT_OPACITY]: CITATION_HIGHLIGHT_PEAK },
              { offset: holdEnd, [CITATION_HIGHLIGHT_OPACITY]: CITATION_HIGHLIGHT_PEAK },
              { offset: 1, [CITATION_HIGHLIGHT_OPACITY]: 0 },
            ]
          : [
              { offset: 0, [CITATION_HIGHLIGHT_OPACITY]: 0 },
              {
                offset: at(CITATION_PULSE_DURATION_MS * 0.5),
                [CITATION_HIGHLIGHT_OPACITY]: CITATION_HIGHLIGHT_PEAK,
              },
              { offset: at(CITATION_PULSE_DURATION_MS), [CITATION_HIGHLIGHT_OPACITY]: 0 },
              {
                offset: at(CITATION_PULSE_DURATION_MS * 1.5),
                [CITATION_HIGHLIGHT_OPACITY]: CITATION_HIGHLIGHT_PEAK,
              },
              { offset: holdEnd, [CITATION_HIGHLIGHT_OPACITY]: CITATION_HIGHLIGHT_PEAK },
              { offset: 1, [CITATION_HIGHLIGHT_OPACITY]: 0 },
            ],
        { duration: CITATION_HIGHLIGHT_TOTAL_MS, easing: "ease-in-out" },
      );
      pulseAnimation.id = "tabs-assistant-citation-pulse";
      pulseAnimation.currentTime = Math.max(0, performance.now() - pulse.startedAt);
      void pulseAnimation.finished.then(finishHighlight, () => {});
    }
  };
  const schedule = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(highlight);
  };
  const observer = new MutationObserver((records) => {
    const rangeMoved =
      ownedRange !== null &&
      (ownedRange.collapsed ||
        !root.contains(ownedRange.startContainer) ||
        !root.contains(ownedRange.endContainer));
    if (rangeMoved) {
      canReplaceSelection ||= selected !== null && ownsSelection(root.ownerDocument.getSelection());
      clear();
    }
    if (
      rangeMoved ||
      records.some(
        (record) =>
          root.contains(record.target) ||
          [...record.addedNodes, ...record.removedNodes].some((node) => node.contains(root)),
      )
    ) {
      schedule();
    }
  });
  observer.observe(scrollNode, { childList: true, characterData: true, subtree: true });
  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(root);
  resizeObserver.observe(scrollNode);
  const state = list.getState();
  const unsubscribe = [
    state.listenToPosition(itemKey, schedule),
    state.listen("totalSize", schedule),
    state.listen("headerSize", schedule),
  ];
  const cancelScroll = () => {
    if (scrolling) {
      scrolling = false;
      // Supersede a queued list scroll before the user's gesture or minimap action runs.
      void list.scrollToOffset({
        get offset() {
          return scrollNode.scrollTop;
        },
        animated: false,
      });
    }
  };
  activation.cancelScroll = cancelScroll;
  schedule();
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    cancelScroll();
    pulseAnimation?.cancel();
    if (frame !== null) cancelAnimationFrame(frame);
    observer.disconnect();
    resizeObserver.disconnect();
    for (const stop of unsubscribe) stop();
    if (activation.cancelScroll === cancelScroll) delete activation.cancelScroll;
    clear();
  };
  return dispose;
}

export function AssistantCitationSource({
  messageId,
  threadRef,
  itemKey,
  request,
  listRef,
  children,
}: {
  messageId: MessageId;
  threadRef?: ScopedThreadRef;
  itemKey: string;
  request: AssistantCitationTarget | null;
  listRef?: RefObject<AssistantCitationListHandle | null>;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !request || request.citation.messageId !== messageId) return;
    const scrollNode =
      root.closest<HTMLElement>("[data-assistant-citation-viewport]") ??
      (root.ownerDocument.scrollingElement as HTMLElement | null) ??
      root.ownerDocument.documentElement;
    const list = listRef?.current ?? createDomCitationListHandle(scrollNode);
    return observeAssistantCitationSource({ root, itemKey, request, list });
  }, [itemKey, listRef, messageId, request]);

  return (
    <div
      ref={rootRef}
      data-assistant-citation-source={messageId}
      data-assistant-citation-environment={threadRef?.environmentId}
      data-assistant-citation-thread={threadRef?.threadId}
    >
      {children}
    </div>
  );
}

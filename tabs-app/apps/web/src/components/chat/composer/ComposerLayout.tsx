import gsap from "gsap";
import { CalendarClockIcon, PaperclipIcon, PlusIcon } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cn } from "../../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { usePanelAnimationSettings } from "../../../panelAnimations";
import {
  type ComposerDraftsModel,
  type ComposerQueueModel,
  type ComposerSheetKind,
  ComposerSheet,
  DraftsButton,
  UpNextStrip,
} from "./composerSheets";
import "./composer-layout.css";

/**
 * The live controls the composer arranges. ChatView builds each one once,
 * wired to the real handlers; this layout only decides where they sit.
 */
export interface ComposerSlots {
  readonly banner: ReactNode;
  readonly model: ReactNode;
  readonly runtime: ReactNode;
  /** Build or plan and access in one control, used instead of the sentence when compact. */
  readonly modeAccess?: ReactNode;
  readonly planSidebar: ReactNode;
  readonly contextMeter: ReactNode;
  readonly pendingPanels: ReactNode;
  readonly attachments: ReactNode;
  readonly editor: ReactNode;
  readonly dictation: ReactNode;
  readonly primaryAction: ReactNode;
  readonly lengthValidation: ReactNode;
  readonly workspace: ReactNode;
}

export interface ComposerLayoutProps {
  readonly slots: ComposerSlots;
  readonly drafts: ComposerDraftsModel;
  readonly queue: ComposerQueueModel;
  readonly cardRef: RefObject<HTMLDivElement | null>;
  readonly controlsRef: RefObject<HTMLDivElement | null>;
  readonly isDragOver: boolean;
  /** A narrow composer: the setup sentence and the workspace row drop their filler words. */
  readonly compact?: boolean;
  /** Provider/Overmind frame classes for the card. */
  readonly frameClassName?: string | undefined;
  readonly interactionMode: "default" | "plan";
  readonly onToggleInteractionMode: () => void;
  /** Opens the file picker (images and files). */
  readonly onAttach: () => void;
  /** Opens the send-later picker; undefined while there is nothing to send. */
  readonly onSchedule?: (() => void) | undefined;
}

/** Build / Plan as a word in the setup sentence. */
function ModeWord(props: {
  readonly interactionMode: "default" | "plan";
  readonly onToggle: () => void;
}) {
  const plan = props.interactionMode === "plan";
  return (
    <button
      type="button"
      onClick={props.onToggle}
      className="composer-word"
      title={
        plan ? "Plans first — click to build directly" : "Builds directly — click to plan first"
      }
      aria-label={plan ? "Plan mode, switch to build" : "Build mode, switch to plan"}
    >
      {plan ? "plans" : "builds"}
    </button>
  );
}

/** Speak or send: dictation and send as one joined control, always in the same corner. */
function SpeakOrSend(props: { readonly slots: ComposerSlots }) {
  return (
    <div className="composer-send" role="group" aria-label="Speak or send">
      <span className="composer-send-mic">{props.slots.dictation}</span>
      {props.slots.primaryAction}
    </div>
  );
}

/** "+": attach and send later stay folded until asked for. Pressing anything else folds them. */
function FoldedTools(props: { readonly children: ReactNode; readonly reducedMotion: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const iconRef = useRef<SVGSVGElement | null>(null);
  const placedRef = useRef(false);

  // One thing open at a time: pressing anywhere else (the access picker, the model, the prompt)
  // folds the tools away, and the access picker closes the same way when "+" is pressed.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // The tray animates to the measured width of its contents, which never shrink, so labels like
  // "Send later" stay on one line the whole way open and closed.
  useLayoutEffect(() => {
    const tray = trayRef.current;
    const inner = innerRef.current;
    if (!tray || !inner) return;
    const width = open ? inner.scrollWidth : 0;
    if (!placedRef.current || props.reducedMotion) {
      placedRef.current = true;
      gsap.set(tray, { width, opacity: open ? 1 : 0 });
      gsap.set(iconRef.current, { rotate: open ? 45 : 0 });
      return;
    }
    const timeline = gsap.timeline({ defaults: { ease: "expo.out" } });
    timeline.to(iconRef.current, { rotate: open ? 45 : 0, duration: 0.4 }, 0);
    if (open) {
      timeline
        .to(tray, { width, opacity: 1, duration: 0.42 }, 0)
        .fromTo(
          Array.from(inner.children),
          { opacity: 0, x: -6 },
          { opacity: 1, x: 0, duration: 0.3, stagger: 0.04, ease: "power2.out" },
          0.06,
        );
    } else {
      timeline.to(tray, { width: 0, opacity: 0, duration: 0.3, ease: "power3.inOut" }, 0);
    }
    return () => {
      timeline.progress(1).kill();
    };
  }, [open, props.reducedMotion]);

  return (
    <div ref={rootRef} className="flex items-center">
      <div ref={trayRef} className="composer-fold-tray" aria-hidden={!open} inert={!open}>
        <div ref={innerRef} className="composer-fold-tray-inner">
          {props.children}
        </div>
      </div>
      <button
        type="button"
        className="composer-icon-button"
        aria-expanded={open}
        aria-label={open ? "Hide tools" : "More: attach, send later"}
        title={open ? "Hide tools" : "Attach or send later"}
        onClick={() => setOpen((value) => !value)}
      >
        <PlusIcon ref={iconRef} className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Where the agent works (branch, checkout or worktree), as a labelled row inside the card. */
function WorkspaceRow(props: { readonly slots: ComposerSlots }) {
  return (
    <div className="composer-workspace" data-composer-stagger>
      <span className="composer-eyebrow">Runs in</span>
      <div className="min-w-0 flex-1">{props.slots.workspace}</div>
    </div>
  );
}

/**
 * The composer: a full-width prompt, then one calm row that reads as a sentence —
 * "[model] builds with [Full access]" — with drafts, the folded tools and speak-or-send
 * beside it, and where the agent runs underneath. Everything lives in one card.
 */
export function ComposerLayout(props: ComposerLayoutProps) {
  const { slots } = props;
  const { reducedMotion } = usePanelAnimationSettings();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [sheet, setSheet] = useState<ComposerSheetKind | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const toggleSheet = (kind: ComposerSheetKind) =>
    setSheet((current) => (current === kind ? null : kind));

  // First paint: the card rises in and its controls follow one by one.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || reducedMotion) return;
    const items = root.querySelectorAll("[data-composer-stagger]");
    const timeline = gsap.timeline({ defaults: { ease: "expo.out" } });
    timeline.fromTo(
      root,
      { opacity: 0, y: 14, scale: 0.985 },
      { opacity: 1, y: 0, scale: 1, duration: 0.4, clearProps: "transform,opacity" },
      0,
    );
    if (items.length > 0) {
      timeline.fromTo(
        items,
        { opacity: 0, y: 5 },
        { opacity: 1, y: 0, duration: 0.32, stagger: 0.035, clearProps: "transform,opacity" },
        0.1,
      );
    }
    return () => {
      timeline.progress(1).kill();
    };
  }, [reducedMotion]);

  // Attach takes any file, not only images.
  const attachButton = (
    <button
      type="button"
      className="composer-icon-button"
      onClick={props.onAttach}
      aria-label="Attach files"
      title="Attach files or images — or drop them on the composer"
    >
      <PaperclipIcon className="size-4" aria-hidden="true" />
    </button>
  );
  // Send later stays hoverable while it can't be used, so the tooltip can say why, instead of
  // a dead disabled button that gives no feedback at all.
  const canSendLater = props.onSchedule !== undefined;
  const sendLaterButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="composer-textlink"
            aria-disabled={!canSendLater}
            aria-label={canSendLater ? "Send later" : "Send later — write a message first"}
            onClick={() => {
              if (canSendLater) props.onSchedule?.();
            }}
          />
        }
      >
        <CalendarClockIcon className="size-3.5" aria-hidden="true" />
        Send later
      </TooltipTrigger>
      <TooltipPopup side="top">
        {canSendLater
          ? "Pick when this message sends. It waits in the queue until then."
          : "Write a message first, then choose when it sends."}
      </TooltipPopup>
    </Tooltip>
  );

  return (
    <div ref={rootRef} className="composer">
      {sheet !== null && (
        <ComposerSheet
          kind={sheet}
          drafts={props.drafts}
          queue={props.queue}
          reducedMotion={reducedMotion}
          onClose={closeSheet}
        />
      )}
      {props.queue.items.length > 0 && sheet !== "queue" && (
        <UpNextStrip
          queue={props.queue}
          open={false}
          onToggle={() => toggleSheet("queue")}
          reducedMotion={reducedMotion}
        />
      )}
      <div
        ref={props.cardRef}
        data-chat-composer-card="true"
        data-shape="preview"
        data-compact={props.compact ? "true" : undefined}
        className={cn(
          "composer-card",
          props.isDragOver && "composer-card-drop",
          props.frameClassName,
        )}
      >
        {slots.banner}
        {slots.pendingPanels}
        <div className="composer-prompt">
          {slots.attachments}
          <div className="min-w-0">{slots.editor}</div>
        </div>
        <div ref={props.controlsRef} data-chat-composer-footer="true" className="composer-row">
          <div className="composer-essentials">
            <span data-composer-stagger>{slots.model}</span>
            {props.compact && slots.modeAccess ? (
              <span data-composer-stagger>{slots.modeAccess}</span>
            ) : (
              <>
                <span data-composer-stagger>
                  <ModeWord
                    interactionMode={props.interactionMode}
                    onToggle={props.onToggleInteractionMode}
                  />
                </span>
                <span className="composer-joiner" data-composer-stagger>
                  with
                </span>
                <span data-composer-stagger>{slots.runtime}</span>
              </>
            )}
            {slots.planSidebar}
          </div>
          <div className="composer-tools" data-composer-stagger>
            {slots.contextMeter}
            <DraftsButton
              drafts={props.drafts}
              open={sheet === "drafts"}
              onToggle={() => toggleSheet("drafts")}
            />
            <FoldedTools reducedMotion={reducedMotion}>
              {attachButton}
              {sendLaterButton}
            </FoldedTools>
            <SpeakOrSend slots={slots} />
          </div>
        </div>
        <WorkspaceRow slots={slots} />
        {slots.lengthValidation}
      </div>
    </div>
  );
}

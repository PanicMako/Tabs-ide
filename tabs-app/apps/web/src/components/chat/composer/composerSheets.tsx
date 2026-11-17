import gsap from "gsap";
import {
  ArrowUpRightIcon,
  BookmarkIcon,
  BookmarkPlusIcon,
  ClockIcon,
  CornerDownLeftIcon,
  ListOrderedIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "../../../lib/utils";

/** Saved drafts (the stash) as the composer layouts show them. */
export interface ComposerDraftsModel {
  readonly entries: ReadonlyArray<{
    readonly id: string;
    readonly prompt: string;
    readonly createdAt: string;
    readonly attachmentCount: number;
  }>;
  /** There is something in the composer worth saving. */
  readonly canSave: boolean;
  readonly saveShortcut: string;
  readonly onSave: () => void;
  readonly onRestore: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onOpenAll: () => void;
}

/** Messages waiting to send on this thread. */
export interface ComposerQueueModel {
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly text: string;
    readonly scheduledFor: string | null;
    readonly failed: boolean;
  }>;
  readonly onOpenAll: () => void;
}

export type ComposerSheetKind = "drafts" | "queue";

export function relativeAge(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function firstLine(text: string): string {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  return line.length > 0 ? line : "Untitled draft";
}

/** "in 5 min", "in 1 hr 20 min", "in 2 days" — how long until a scheduled send. */
export function timeUntil(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.round((time - now) / 60_000));
  if (minutes < 1) return "any moment";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `in ${hours} hr` : `in ${hours} hr ${rest} min`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/** When a queued message goes out, in plain words. */
export function queueWhen(
  item: ComposerQueueModel["items"][number],
  now: number = Date.now(),
): string {
  if (item.failed) return "Couldn't send";
  if (!item.scheduledFor) return "Sends when the agent is free";
  const time = Date.parse(item.scheduledFor);
  if (!Number.isFinite(time)) return "Scheduled";
  const clock = new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `Sends ${clock} · ${timeUntil(item.scheduledFor, now)}`;
}

/**
 * A sheet that rises out of the composer's top edge, the full width of the
 * prompt, for drafts or the queue. Escape or a click elsewhere folds it away.
 */
export function ComposerSheet(props: {
  readonly kind: ComposerSheetKind;
  readonly drafts: ComposerDraftsModel;
  readonly queue: ComposerQueueModel;
  readonly reducedMotion: boolean;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const onClose = props.onClose;

  useLayoutEffect(() => {
    const sheet = ref.current;
    if (!sheet || props.reducedMotion) return;
    const rows = sheet.querySelectorAll("[data-sheet-row]");
    const timeline = gsap.timeline({ defaults: { ease: "expo.out" } });
    timeline.fromTo(
      sheet,
      { opacity: 0, y: 14, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.38, clearProps: "transform,opacity" },
    );
    if (rows.length > 0) {
      timeline.fromTo(
        rows,
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.3, stagger: 0.03, clearProps: "transform,opacity" },
        0.06,
      );
    }
    return () => {
      timeline.progress(1).kill();
    };
  }, [props.kind, props.reducedMotion]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      // The button that opened the sheet toggles it itself.
      if (target.closest("[data-composer-sheet-trigger]")) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const drafts = props.drafts;
  const queue = props.queue;
  let header: ReactNode;
  let rows: ReactNode;
  let footer: ReactNode;

  if (props.kind === "drafts") {
    header = (
      <>
        <BookmarkIcon className="size-3.5" aria-hidden="true" />
        <span>Saved drafts</span>
        <span className="composer-sheet-count">{drafts.entries.length}</span>
      </>
    );
    rows =
      drafts.entries.length === 0 ? (
        <p className="composer-sheet-empty" data-sheet-row>
          Nothing saved yet. Press {drafts.saveShortcut} while writing to keep a prompt for later.
        </p>
      ) : (
        drafts.entries.slice(0, 8).map((entry) => (
          <div key={entry.id} className="composer-sheet-row" data-sheet-row>
            <button
              type="button"
              className="composer-sheet-row-main"
              onClick={() => {
                drafts.onRestore(entry.id);
                onClose();
              }}
              title="Put this draft back in the composer"
            >
              <span className="composer-sheet-row-title">{firstLine(entry.prompt)}</span>
              <span className="composer-sheet-row-meta">
                {relativeAge(entry.createdAt)}
                {entry.attachmentCount > 0
                  ? ` · ${entry.attachmentCount} attachment${entry.attachmentCount === 1 ? "" : "s"}`
                  : ""}
              </span>
            </button>
            <span className="composer-sheet-row-use" aria-hidden="true">
              <CornerDownLeftIcon className="size-3" /> Use
            </span>
            <button
              type="button"
              className="composer-sheet-row-delete"
              aria-label={`Delete draft "${firstLine(entry.prompt)}"`}
              onClick={() => drafts.onDelete(entry.id)}
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ))
      );
    footer = (
      <>
        <button
          type="button"
          className="composer-sheet-action"
          disabled={!drafts.canSave}
          onClick={() => {
            drafts.onSave();
            onClose();
          }}
        >
          <BookmarkPlusIcon className="size-3.5" aria-hidden="true" />
          Save this draft
          <kbd>{drafts.saveShortcut}</kbd>
        </button>
        <button
          type="button"
          className="composer-sheet-link"
          onClick={() => {
            drafts.onOpenAll();
            onClose();
          }}
        >
          All drafts <ArrowUpRightIcon className="size-3" aria-hidden="true" />
        </button>
      </>
    );
  } else {
    header = (
      <>
        <ListOrderedIcon className="size-3.5" aria-hidden="true" />
        <span>Up next</span>
        <span className="composer-sheet-count">{queue.items.length}</span>
      </>
    );
    rows =
      queue.items.length === 0 ? (
        <p className="composer-sheet-empty" data-sheet-row>
          Nothing queued. While the agent works, send adds your message here instead.
        </p>
      ) : (
        queue.items.slice(0, 8).map((item, index) => (
          <div key={item.id} className="composer-sheet-row" data-sheet-row>
            <span className="composer-sheet-row-index" aria-hidden="true">
              {index + 1}
            </span>
            <span className="composer-sheet-row-main composer-sheet-row-static">
              <span className="composer-sheet-row-title">{firstLine(item.text)}</span>
              <span className={cn("composer-sheet-row-meta", item.failed && "text-destructive")}>
                {item.failed ? (
                  <TriangleAlertIcon className="mr-1 inline size-3" aria-hidden="true" />
                ) : item.scheduledFor ? (
                  <ClockIcon className="mr-1 inline size-3" aria-hidden="true" />
                ) : null}
                {queueWhen(item)}
              </span>
            </span>
          </div>
        ))
      );
    footer = (
      <button
        type="button"
        className="composer-sheet-link ml-auto"
        onClick={() => {
          queue.onOpenAll();
          onClose();
        }}
      >
        Reorder or edit <ArrowUpRightIcon className="size-3" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={props.kind === "drafts" ? "Saved drafts" : "Queued messages"}
      className="composer-sheet"
      data-shape="preview"
    >
      <div className="composer-sheet-header">
        {header}
        <button type="button" className="composer-sheet-close" aria-label="Close" onClick={onClose}>
          <XIcon className="size-3.5" />
        </button>
      </div>
      <div className="composer-sheet-rows">{rows}</div>
      <div className="composer-sheet-footer">{footer}</div>
    </div>
  );
}

/**
 * While messages wait, a thin line above the composer says what goes next,
 * so a queue is never invisible. Click it for the whole list.
 */
export function UpNextStrip(props: {
  readonly queue: ComposerQueueModel;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly reducedMotion: boolean;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const count = props.queue.items.length;
  const first = props.queue.items[0];

  useLayoutEffect(() => {
    if (!ref.current || props.reducedMotion) return;
    const tween = gsap.fromTo(
      ref.current,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.34, ease: "expo.out", clearProps: "transform,opacity" },
    );
    return () => {
      tween.kill();
    };
  }, [count > 0, props.reducedMotion]);

  // Keep "in 12 min" honest while the strip is on screen.
  const [now, setNow] = useState(() => Date.now());
  const scheduled = first?.scheduledFor ?? null;
  useEffect(() => {
    if (!scheduled) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [scheduled]);

  if (!first) return null;
  return (
    <button
      ref={ref}
      type="button"
      data-composer-sheet-trigger
      aria-expanded={props.open}
      onClick={props.onToggle}
      className="composer-upnext"
      title="Waiting in the queue — click to see it, or reorder and edit in the panel"
    >
      {scheduled ? (
        <ClockIcon className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <ListOrderedIcon className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      <span className="shrink-0 font-medium text-foreground">
        {scheduled ? "Scheduled" : "Up next"}
      </span>
      <span className="min-w-0 flex-1 truncate">{firstLine(first.text)}</span>
      {scheduled && <span className="shrink-0 tabular-nums">{queueWhen(first, now)}</span>}
      {count > 1 && <span className="composer-sheet-count shrink-0">+{count - 1}</span>}
    </button>
  );
}

/** The drafts control: a save action while writing, and the count of saved drafts. */
export function DraftsButton(props: {
  readonly drafts: ComposerDraftsModel;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly variant?: "icon" | "word";
}) {
  const count = props.drafts.entries.length;
  if (props.variant === "word") {
    return (
      <button
        type="button"
        data-composer-sheet-trigger
        aria-expanded={props.open}
        onClick={props.onToggle}
        className="composer-textlink"
      >
        Drafts{count > 0 ? ` (${count})` : ""}
      </button>
    );
  }
  return (
    <button
      type="button"
      data-composer-sheet-trigger
      aria-expanded={props.open}
      onClick={props.onToggle}
      className="composer-icon-button"
      aria-label={count > 0 ? `Saved drafts: ${count}` : "Saved drafts"}
      title={`Saved drafts (${props.drafts.saveShortcut} saves the current one)`}
    >
      <BookmarkIcon className="size-4" aria-hidden="true" />
      {count > 0 && <span className="composer-badge">{count}</span>}
    </button>
  );
}

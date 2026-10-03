import React, { useCallback, useRef, useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  BellIcon,
  CheckCheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  TrashIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import {
  clearNotificationHistory,
  markAllNotificationsRead,
  markNotificationRead,
  useNotificationEntries,
  useUnreadNotificationCount,
  type NotificationSeverity,
} from "~/stores/notificationStore";

// ─── Relative time helper ─────────────────────────────────────────────────────

function formatRelativeTime(timestamp: number): string {
  const deltaSec = Math.floor((Date.now() - timestamp) / 1000);
  if (deltaSec < 5) return "just now";
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDays = Math.floor(deltaHr / 24);
  return `${deltaDays}d ago`;
}

// ─── Icon map ─────────────────────────────────────────────────────────────────

const SEVERITY_ICONS: Record<NotificationSeverity, React.FC<{ className?: string }>> = {
  success: CircleCheckIcon,
  info: InfoIcon,
  warning: TriangleAlertIcon,
  error: CircleAlertIcon,
  loading: LoaderCircleIcon,
};

const SEVERITY_COLOR: Record<NotificationSeverity, string> = {
  success: "text-success",
  info: "text-info",
  warning: "text-warning",
  error: "text-destructive",
  loading: "text-muted-foreground",
};

// ─── Main component ───────────────────────────────────────────────────────────

interface NotificationHistoryPanelProps {
  /** Extra classes for the bell button wrapper */
  className?: string;
  /** Button variant styling */
  variant?: "titlebar" | "settings-header";
  /** Whether the notification section is currently active */
  active?: boolean;
  /** Optional callback to open settings directly */
  onOpenSettings?: () => void;
}

export function NotificationHistoryPanel({
  className,
  variant = "titlebar",
  active = false,
  onOpenSettings,
}: NotificationHistoryPanelProps) {
  const [open, setOpen] = useState(false);
  const entries = useNotificationEntries();
  const unreadCount = useUnreadNotificationCount();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const handleToggle = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setOpen(false);
    if (onOpenSettings) {
      onOpenSettings();
    } else {
      void navigate({
        to: "/settings",
      }).then(() => {
        const url = new URL(window.location.href);
        url.searchParams.set("section", "notifications");
        window.history.replaceState({}, "", url.toString());
      });
    }
  }, [navigate, onOpenSettings]);

  const isTitlebar = variant === "titlebar";

  return (
    <div className={cn("relative", className)}>
      {/* Bell trigger */}
      <button
        ref={buttonRef}
        type="button"
        id={isTitlebar ? "notification-bell-button-titlebar" : "notification-bell-button"}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={handleToggle}
        className={cn(
          "no-drag relative flex items-center justify-center transition-colors cursor-pointer",
          isTitlebar
            ? "size-7 rounded-full text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            : "size-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
          (open || active) && "bg-accent text-foreground",
        )}
      >
        <BellIcon className="size-3.5" />
        {unreadCount > 0 && (
          <span
            className={cn(
              "absolute flex items-center justify-center rounded-full font-bold tabular-nums",
              "bg-primary text-primary-foreground",
              unreadCount > 9
                ? "top-0 right-0 h-3.5 w-4 text-[8px]"
                : "top-0 right-0 h-3.5 w-3.5 text-[8px]",
            )}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Blurred Backdrop Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[190] bg-black/25 backdrop-blur-sm transition-all animate-in fade-in duration-150"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Popover panel */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notification history"
          className={cn(
            "absolute z-[200] mt-2 flex flex-col overflow-hidden",
            "w-[380px] max-w-[calc(100vw-24px)] rounded-2xl border border-border/80 bg-popover/95 backdrop-blur-xl shadow-2xl shadow-black/20",
            "before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)]",
            "before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            "right-0 top-full animate-in fade-in zoom-in-95 duration-150",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <BellIcon className="size-3.5 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Notifications</span>
              {entries.length > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                  {entries.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {entries.length > 0 && (
                <>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    onClick={() => markAllNotificationsRead()}
                    title="Mark all as read"
                    type="button"
                  >
                    <CheckCheckIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-6 text-muted-foreground hover:text-destructive"
                    onClick={() => clearNotificationHistory()}
                    title="Clear all"
                    type="button"
                  >
                    <TrashIcon className="size-3.5" />
                  </Button>
                </>
              )}
              <Button
                size="icon-xs"
                variant="ghost"
                className="size-6 text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(false)}
                type="button"
                aria-label="Close notification panel"
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* List */}
          <div className="flex max-h-[380px] flex-col overflow-y-auto overscroll-contain">
            {entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                  <BellIcon className="size-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">All caught up</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    No notifications yet. They'll appear here.
                  </p>
                </div>
              </div>
            ) : (
              entries.map((entry) => {
                const Icon = SEVERITY_ICONS[entry.type];
                const iconColor = SEVERITY_COLOR[entry.type];
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={cn(
                      "group relative flex w-full items-start gap-3 border-t border-border/60 px-4 py-3 text-left transition-colors",
                      "first:border-t-0 hover:bg-accent/40 cursor-pointer",
                      !entry.read && "bg-primary/[0.03]",
                    )}
                    onClick={() => markNotificationRead(entry.id)}
                  >
                    {/* Unread dot */}
                    {!entry.read && (
                      <span className="absolute left-2 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary" />
                    )}

                    <div className={cn("mt-0.5 shrink-0", iconColor)}>
                      <Icon
                        className={cn("size-3.5", entry.type === "loading" && "animate-spin")}
                      />
                    </div>

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p
                        className={cn(
                          "truncate text-[13px] font-medium leading-tight",
                          entry.read ? "text-muted-foreground" : "text-foreground",
                        )}
                      >
                        {entry.title || "(no title)"}
                      </p>
                      {entry.description && (
                        <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                          {entry.description}
                        </p>
                      )}
                    </div>

                    <time
                      className="mt-0.5 shrink-0 text-[10px] tabular-nums text-muted-foreground/60"
                      dateTime={new Date(entry.timestamp).toISOString()}
                      title={new Date(entry.timestamp).toLocaleString()}
                    >
                      {formatRelativeTime(entry.timestamp)}
                    </time>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border/70 bg-muted/40 px-4 py-2.5">
            <span className="text-[11px] text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} unread` : `${entries.length} recorded`}
            </span>
            <button
              type="button"
              onClick={handleOpenSettings}
              className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:text-foreground/80 transition-colors cursor-pointer"
            >
              <span>Notification settings</span>
              <ChevronRightIcon className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

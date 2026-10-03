/**
 * Notification history store.
 *
 * Records every toast that is shown via toastManager.add so that users can
 * review past notifications even after they are auto-dismissed. The store is
 * in-memory with sessionStorage backup (so it survives hot reloads but not
 * hard page refreshes in production).
 */

export type NotificationSeverity = "success" | "info" | "warning" | "error" | "loading";

export interface NotificationEntry {
  readonly id: string;
  readonly type: NotificationSeverity;
  readonly title: string;
  readonly description?: string;
  readonly timestamp: number;
  readonly read: boolean;
}

const MAX_HISTORY = 100;
const SESSION_KEY = "tabs:notification-history";

// ─── State ────────────────────────────────────────────────────────────────────

let entries: NotificationEntry[] = tryLoadFromSession();
const listeners = new Set<() => void>();

function tryLoadFromSession(): NotificationEntry[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as NotificationEntry[];
  } catch {
    return [];
  }
}

function persistToSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(entries));
  } catch {
    // Quota errors are non-fatal
  }
}

function emit() {
  for (const listener of listeners) listener();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Add or update a notification entry. Deduplicates by id. */
export function recordNotification(
  id: string,
  type: string,
  title: string,
  description?: string,
): void {
  const severity: NotificationSeverity =
    type === "success" ||
    type === "info" ||
    type === "warning" ||
    type === "error" ||
    type === "loading"
      ? (type as NotificationSeverity)
      : "info";

  // Deduplicate: if we already have this id, just update it in place.
  const existing = entries.findIndex((e) => e.id === id);
  if (existing !== -1) {
    const prev = entries[existing];
    if (!prev) return; // Narrow undefined (noUncheckedIndexedAccess guard)
    const updated = [...entries];
    updated[existing] = {
      id: prev.id,
      type: severity,
      title,
      ...(description !== undefined ? { description } : {}),
      timestamp: prev.timestamp,
      read: prev.read,
    };
    entries = updated;
    persistToSession();
    emit();
    return;
  }

  const entry: NotificationEntry = {
    id,
    type: severity,
    title,
    ...(description !== undefined ? { description } : {}),
    timestamp: Date.now(),
    read: false,
  };

  entries = [entry, ...entries].slice(0, MAX_HISTORY);
  persistToSession();
  emit();
}

/** Mark a single notification as read immutably so useSyncExternalStore re-renders. */
export function markNotificationRead(id: string): void {
  const target = entries.find((e) => e.id === id);
  if (!target || target.read) return;
  entries = entries.map((e) => (e.id === id ? { ...e, read: true } : e));
  persistToSession();
  emit();
}

/** Mark multiple notifications as read immutably. */
export function markNotificationsRead(ids: readonly string[] | ReadonlySet<string>): void {
  const idSet = ids instanceof Set ? ids : new Set(ids);
  let changed = false;
  entries = entries.map((e) => {
    if (idSet.has(e.id) && !e.read) {
      changed = true;
      return { ...e, read: true };
    }
    return e;
  });
  if (!changed) return;
  persistToSession();
  emit();
}

/** Delete specific notifications by IDs. */
export function deleteNotifications(ids: readonly string[] | ReadonlySet<string>): void {
  const idSet = ids instanceof Set ? ids : new Set(ids);
  const beforeLen = entries.length;
  entries = entries.filter((e) => !idSet.has(e.id));
  if (entries.length === beforeLen) return;
  persistToSession();
  emit();
}

/** Mark all notifications as read immutably. */
export function markAllNotificationsRead(): void {
  let changed = false;
  entries = entries.map((e) => {
    if (!e.read) {
      changed = true;
      return { ...e, read: true };
    }
    return e;
  });
  if (!changed) return;
  persistToSession();
  emit();
}

/** Remove all notification history. */
export function clearNotificationHistory(): void {
  if (entries.length === 0) return;
  entries = [];
  persistToSession();
  emit();
}

/** Returns the current snapshot of notification entries (newest first). */
export function getNotificationEntries(): readonly NotificationEntry[] {
  return entries;
}

/** Returns the count of unread notifications. */
export function getUnreadNotificationCount(): number {
  return entries.filter((e) => !e.read).length;
}

/** Subscribe to store changes. Returns an unsubscribe function. */
export function subscribeToNotifications(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ─── OS / System Notifications ────────────────────────────────────────────────

export type OsNotificationCategory =
  | "error"
  | "warning"
  | "success"
  | "info"
  | "agent-turn-complete"
  | "agent-waiting-input";

export type OsNotificationCategorySettings = Record<OsNotificationCategory, boolean>;

export const DEFAULT_OS_NOTIFICATION_CATEGORIES: OsNotificationCategorySettings = {
  error: true,
  warning: true,
  "agent-waiting-input": true,
  "agent-turn-complete": true,
  success: false,
  info: false,
};

const OS_NOTIFICATIONS_KEY = "tabs:os-notifications-enabled";
const OS_CATEGORIES_KEY = "tabs:os-notifications-categories";

/** Methods that should never trigger an OS notification (transient watchdogs). */
const OS_NOTIFICATION_TITLE_BLOCKLIST = new Set(["Some requests are slow"]);

let osNotificationsEnabled: boolean = tryLoadOsNotificationsEnabled();
let osCategoriesState: OsNotificationCategorySettings = tryLoadOsCategories();

function tryLoadOsNotificationsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(OS_NOTIFICATIONS_KEY) === "true";
  } catch {
    return false;
  }
}

function tryLoadOsCategories(): OsNotificationCategorySettings {
  if (typeof window === "undefined") return { ...DEFAULT_OS_NOTIFICATION_CATEGORIES };
  try {
    const raw = localStorage.getItem(OS_CATEGORIES_KEY);
    if (!raw) return { ...DEFAULT_OS_NOTIFICATION_CATEGORIES };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_OS_NOTIFICATION_CATEGORIES, ...parsed };
  } catch {
    return { ...DEFAULT_OS_NOTIFICATION_CATEGORIES };
  }
}

export function getOsNotificationsEnabled(): boolean {
  return osNotificationsEnabled;
}

export function setOsNotificationsEnabled(enabled: boolean): void {
  try {
    osNotificationsEnabled = enabled;
    if (typeof window !== "undefined") {
      localStorage.setItem(OS_NOTIFICATIONS_KEY, String(enabled));
    }
  } catch {}
  emit();
}

export function getOsNotificationCategories(): OsNotificationCategorySettings {
  return osCategoriesState;
}

export function setOsNotificationCategory(
  category: OsNotificationCategory,
  enabled: boolean,
): void {
  try {
    osCategoriesState = {
      ...osCategoriesState,
      [category]: enabled,
    };
    if (typeof window !== "undefined") {
      localStorage.setItem(OS_CATEGORIES_KEY, JSON.stringify(osCategoriesState));
    }
  } catch {}
  emit();
}

/** Request browser Notification permission and enable OS notifications if granted. */
export async function requestOsNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") {
    setOsNotificationsEnabled(true);
    return true;
  }
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  if (result === "granted") {
    setOsNotificationsEnabled(true);
    return true;
  }
  return false;
}

/**
 * Fire an OS notification respecting user master preference, granular category
 * filters, and blocking known transient watchdog messages.
 */
export function maybeFireOsNotification(
  type: string,
  title: string,
  description?: string,
  explicitCategory?: OsNotificationCategory,
): void {
  if (typeof Notification === "undefined") return;
  if (!getOsNotificationsEnabled()) return;
  if (Notification.permission !== "granted") return;
  if (OS_NOTIFICATION_TITLE_BLOCKLIST.has(title)) return;

  const category: OsNotificationCategory =
    explicitCategory ??
    (type === "error" || type === "warning" || type === "success" || type === "info"
      ? (type as OsNotificationCategory)
      : "info");

  const categories = getOsNotificationCategories();
  if (!categories[category]) return;

  try {
    new Notification(title, {
      ...(description !== undefined ? { body: description } : {}),
      icon: "/icon.png",
      tag: title, // Deduplicate repeated identical notifications
    });
  } catch {
    // Swallow — OS notifications are best-effort
  }
}

/**
 * Fire a system notification and record it in notification history.
 */
export function fireSystemNotification(options: {
  title: string;
  description?: string;
  category: OsNotificationCategory;
  recordInHistory?: boolean;
}): void {
  const { title, description, category, recordInHistory = true } = options;
  if (recordInHistory) {
    const severity: NotificationSeverity =
      category === "error" ||
      category === "warning" ||
      category === "success" ||
      category === "info"
        ? category
        : category === "agent-waiting-input"
          ? "warning"
          : "info";
    recordNotification(
      `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      severity,
      title,
      description,
    );
  }
  maybeFireOsNotification(category, title, description, category);
}

// ─── React hook ───────────────────────────────────────────────────────────────

import { useSyncExternalStore } from "react";

export function useNotificationEntries(): readonly NotificationEntry[] {
  return useSyncExternalStore(
    subscribeToNotifications,
    getNotificationEntries,
    getNotificationEntries,
  );
}

export function useUnreadNotificationCount(): number {
  return useSyncExternalStore(
    subscribeToNotifications,
    getUnreadNotificationCount,
    getUnreadNotificationCount,
  );
}

export function useOsNotificationsEnabled(): boolean {
  return useSyncExternalStore(
    subscribeToNotifications,
    getOsNotificationsEnabled,
    getOsNotificationsEnabled,
  );
}

export function useOsNotificationCategories(): OsNotificationCategorySettings {
  return useSyncExternalStore(
    subscribeToNotifications,
    getOsNotificationCategories,
    getOsNotificationCategories,
  );
}

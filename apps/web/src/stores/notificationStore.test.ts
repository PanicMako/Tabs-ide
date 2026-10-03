import { describe, expect, it, beforeEach } from "vitest";
import {
  clearNotificationHistory,
  deleteNotifications,
  getNotificationEntries,
  getOsNotificationCategories,
  getOsNotificationsEnabled,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationsRead,
  recordNotification,
  setOsNotificationCategory,
  setOsNotificationsEnabled,
} from "./notificationStore";

describe("notificationStore", () => {
  beforeEach(() => {
    clearNotificationHistory();
  });

  it("getOsNotificationCategories returns a stable reference across calls", () => {
    const first = getOsNotificationCategories();
    const second = getOsNotificationCategories();
    // Must be referentially equal to prevent useSyncExternalStore infinite re-renders
    expect(first).toBe(second);
  });

  it("updating category returns a new reference with updated value", () => {
    const before = getOsNotificationCategories();
    setOsNotificationCategory("info", true);
    const after = getOsNotificationCategories();

    expect(after).not.toBe(before);
    expect(after.info).toBe(true);

    // Clean up
    setOsNotificationCategory("info", false);
  });

  it("getOsNotificationsEnabled returns boolean", () => {
    setOsNotificationsEnabled(true);
    expect(getOsNotificationsEnabled()).toBe(true);
    setOsNotificationsEnabled(false);
    expect(getOsNotificationsEnabled()).toBe(false);
  });

  it("records notifications and updates unread count", () => {
    expect(getUnreadNotificationCount()).toBe(0);

    recordNotification("toast-1", "error", "Build Failed", "Syntax error");
    expect(getNotificationEntries()).toHaveLength(1);
    expect(getUnreadNotificationCount()).toBe(1);

    const entry = getNotificationEntries()[0];
    expect(entry?.title).toBe("Build Failed");
    expect(entry?.type).toBe("error");
    expect(entry?.read).toBe(false);
  });

  it("marks notification as read immutably with new array reference", () => {
    recordNotification("toast-1", "warning", "Disk full");
    const beforeEntries = getNotificationEntries();
    expect(getUnreadNotificationCount()).toBe(1);

    markNotificationRead("toast-1");
    const afterEntries = getNotificationEntries();
    expect(afterEntries).not.toBe(beforeEntries); // Immutable reference change for useSyncExternalStore
    expect(getUnreadNotificationCount()).toBe(0);
    expect(afterEntries[0]?.read).toBe(true);
  });

  it("marks all notifications as read immutably with new array reference", () => {
    recordNotification("toast-1", "error", "Error 1");
    recordNotification("toast-2", "warning", "Warning 2");
    const beforeEntries = getNotificationEntries();
    expect(getUnreadNotificationCount()).toBe(2);

    markAllNotificationsRead();
    const afterEntries = getNotificationEntries();
    expect(afterEntries).not.toBe(beforeEntries);
    expect(getUnreadNotificationCount()).toBe(0);
    expect(afterEntries.every((e) => e.read)).toBe(true);
  });

  it("marks subset of notifications as read with markNotificationsRead", () => {
    recordNotification("toast-1", "error", "Error 1");
    recordNotification("toast-2", "warning", "Warning 2");
    recordNotification("toast-3", "info", "Info 3");

    markNotificationsRead(["toast-1", "toast-3"]);
    expect(getUnreadNotificationCount()).toBe(1);
    const entries = getNotificationEntries();
    expect(entries.find((e) => e.id === "toast-1")?.read).toBe(true);
    expect(entries.find((e) => e.id === "toast-2")?.read).toBe(false);
    expect(entries.find((e) => e.id === "toast-3")?.read).toBe(true);
  });

  it("deletes notifications by ids with deleteNotifications", () => {
    recordNotification("toast-1", "error", "Error 1");
    recordNotification("toast-2", "warning", "Warning 2");

    deleteNotifications(["toast-1"]);
    expect(getNotificationEntries()).toHaveLength(1);
    expect(getNotificationEntries()[0]?.id).toBe("toast-2");
  });

  it("deduplicates notifications by id", () => {
    recordNotification("dup-1", "info", "Starting");
    recordNotification("dup-1", "info", "Updated");

    expect(getNotificationEntries()).toHaveLength(1);
    expect(getNotificationEntries()[0]?.title).toBe("Updated");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  setSettingsPersistence,
  settingsPersistenceAtom,
  type SettingsPersistenceState,
} from "../../state/settings";
import { AppAtomRegistryProvider, appAtomRegistry } from "../../state/atomRegistry";
import {
  clearAllDraftSources,
  registerDraftSource,
  settingsDraftRegistryAtom,
  unregisterDraftSource,
} from "../../state/settingsDraftRegistry";
import { SettingsPersistenceStatus } from "./SettingsPersistenceStatus";

function renderStatus() {
  return renderToStaticMarkup(
    <AppAtomRegistryProvider>
      <SettingsPersistenceStatus />
    </AppAtomRegistryProvider>,
  );
}

describe("SettingsPersistenceStatus Truthful Dirty & Save Status Contract", () => {
  beforeEach(() => {
    clearAllDraftSources();
    setSettingsPersistence({
      status: "idle",
      error: null,
      lastSavedAt: null,
      failedPatch: null,
      retry: null,
    });
    vi.clearAllMocks();
  });

  it("returns null when status is idle and all drafts are clean", () => {
    const markup = renderStatus();
    expect(markup).toBe("");
  });

  it("displays Saved when persistence is saved and no drafts are dirty", () => {
    setSettingsPersistence({
      status: "saved",
      error: null,
      lastSavedAt: Date.now(),
      failedPatch: null,
      retry: null,
    });

    const markup = renderStatus();
    expect(markup).toContain("Saved");
    expect(markup).not.toContain("Unsaved changes");
  });

  it("Workspace draft dirty means the header does not say Saved", () => {
    // Background auto-save completed
    setSettingsPersistence({
      status: "saved",
      error: null,
      lastSavedAt: Date.now(),
      failedPatch: null,
      retry: null,
    });

    // But Workspace has unsaved changes
    registerDraftSource({
      sourceId: "workspace",
      isDirty: true,
      label: "Workspace",
    });

    const markup = renderStatus();
    expect(markup).not.toContain("Saved");
    expect(markup).toContain("Unsaved changes");
  });

  it("Animation draft dirty means the header displays Unsaved changes", () => {
    registerDraftSource({
      sourceId: "animations",
      isDirty: true,
      label: "Animations",
    });

    const markup = renderStatus();
    expect(markup).toContain("Unsaved changes");
    expect(markup).not.toContain("Saved");
  });

  it("Theme Studio draft dirty is represented while open", () => {
    registerDraftSource({
      sourceId: "theme-studio",
      isDirty: true,
      label: "Theme Studio",
    });

    const markup = renderStatus();
    expect(markup).toContain("Unsaved changes");
  });

  it("Auto-saving General settings does not clear Workspace dirty state", () => {
    registerDraftSource({
      sourceId: "workspace",
      isDirty: true,
      label: "Workspace",
    });

    // Auto-save starts saving
    setSettingsPersistence({
      status: "saving",
      error: null,
      lastSavedAt: null,
      failedPatch: null,
      retry: null,
    });

    let markup = renderStatus();
    expect(markup).toContain("Saving...");

    // Auto-save finishes
    setSettingsPersistence({
      status: "saved",
      error: null,
      lastSavedAt: Date.now(),
      failedPatch: null,
      retry: null,
    });

    markup = renderStatus();
    // Workspace dirty state is preserved; header displays Unsaved changes, NOT Saved
    expect(markup).toContain("Unsaved changes");
    expect(markup).not.toContain("Saved");
  });

  it("A save failure overrides Saved/dirty messaging appropriately", () => {
    registerDraftSource({
      sourceId: "workspace",
      isDirty: true,
      label: "Workspace",
    });

    const mockRetry = vi.fn();
    setSettingsPersistence({
      status: "failed",
      error: "Network disconnect",
      lastSavedAt: null,
      failedPatch: { diffWordWrap: true },
      retry: mockRetry,
    });

    const markup = renderStatus();
    expect(markup).toContain("Failed to save");
    expect(markup).toContain("Retry");
    expect(markup).not.toContain("Unsaved changes");
  });

  it("Saving or cancelling the final dirty source returns status to clean", () => {
    registerDraftSource({
      sourceId: "workspace",
      isDirty: true,
      label: "Workspace",
    });

    expect(renderStatus()).toContain("Unsaved changes");

    // User commits or cancels workspace
    registerDraftSource({
      sourceId: "workspace",
      isDirty: false,
      label: "Workspace",
    });

    // Now all drafts clean; idle returns null
    expect(renderStatus()).toBe("");

    // Or if auto-save was saved:
    setSettingsPersistence({
      status: "saved",
      error: null,
      lastSavedAt: Date.now(),
      failedPatch: null,
      retry: null,
    });
    expect(renderStatus()).toContain("Saved");
  });

  it("Unmount removes stale dirty state", () => {
    registerDraftSource({
      sourceId: "workspace",
      isDirty: true,
      label: "Workspace",
    });

    expect(renderStatus()).toContain("Unsaved changes");

    // Component unmount unregisters its source
    unregisterDraftSource("workspace");

    expect(renderStatus()).toBe("");
  });

  it("Screen-reader status is contained in a single stable polite live region", () => {
    registerDraftSource({
      sourceId: "animations",
      isDirty: true,
      label: "Animations",
    });

    const markup = renderStatus();
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-atomic="true"');
  });

  it("displays Auto-save pending... when debounce is queued", () => {
    setSettingsPersistence({
      status: "pending",
      error: null,
      lastSavedAt: null,
      failedPatch: null,
      retry: null,
    });

    const markup = renderStatus();
    expect(markup).toContain("Auto-save pending...");
  });

  it("displays multiple dirty source sections accurately", () => {
    registerDraftSource({
      sourceId: "workspace",
      isDirty: true,
      label: "Workspace",
    });
    registerDraftSource({
      sourceId: "theme-studio",
      isDirty: true,
      label: "Theme Studio",
    });

    const markup = renderStatus();
    expect(markup).toContain("Unsaved changes (Workspace, Theme Studio)");
  });
});

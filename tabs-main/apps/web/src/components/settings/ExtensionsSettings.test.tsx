import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesktopInstalledExtension } from "@tabs/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const extension = {
  id: "acme.dashboard",
  source: "exchange",
  registryOrigin: "https://exchange.example",
  dataDeletionAvailable: true,
  profiles: [{ id: "default", label: "Default", scope: "shared" }],
  manifest: {
    manifestVersion: 1,
    publisher: "acme",
    name: "dashboard",
    version: "1.0.0",
    displayName: "Dashboard",
    description: "Project dashboard",
    engines: { tabs: ">=1.3.0" },
    contributes: { tools: [{ id: "main", label: "Main", entry: "index.html" }] },
  },
  assignment: {
    extensionId: "acme.dashboard",
    enabledGlobally: false,
    enabledProjectIds: ["project-a"],
    disabledProjectIds: [],
    defaultProfileId: "default",
    profileIdByProjectId: {},
  },
} as DesktopInstalledExtension;

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => [{ id: "project-a", name: "Alpha" }],
}));
vi.mock("~/state/threads", () => ({ projectsAtom: Symbol("projects") }));
vi.mock("~/state/extensions", () => ({
  useInstalledExtensions: () => [extension],
  refreshExtensions: async () => {},
}));
vi.mock("~/state/workspaceShell", () => ({
  workspaceShellActions: { removeExtensionToolPreferences: () => {} },
}));
vi.mock("./SettingsLayout", () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  SettingsSectionHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
}));

import ExtensionsSettings from "./ExtensionsSettings";

afterEach(() => vi.unstubAllGlobals());

describe("ExtensionsSettings accessibility", () => {
  it("names installed extension controls with their package and project context", () => {
    vi.stubGlobal("window", { desktopBridge: {} });
    const html = renderToStaticMarkup(<ExtensionsSettings />);
    expect(html).toContain('role="group" aria-label="Extension settings views"');
    expect(html).toContain('aria-label="Dashboard installation and project settings"');
    expect(html).toContain('aria-label="Enable Dashboard"');
    expect(html).toContain('aria-label="Show Dashboard in all projects"');
    expect(html).toContain('aria-label="Show Dashboard in Alpha"');
    expect(html).toContain('aria-label="Check Dashboard for updates"');
  });
});

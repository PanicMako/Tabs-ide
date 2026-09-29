import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesktopInstalledExtension } from "@tabs/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const baseExtension = {
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
    capabilities: [
      "profile-storage",
      "workspace-read",
      "git-status",
      "network",
      "credentials",
      "ai-tools",
    ],
    networkHosts: ["api.example.com"],
    contributes: {
      tools: [{ id: "main", label: "Main", entry: "index.html" }],
      commands: [
        { id: "analyze", label: "Analyze", description: "Analyze project", aiCallable: true },
      ],
    },
  },
  assignment: {
    extensionId: "acme.dashboard",
    enabledGlobally: false,
    enabledProjectIds: ["project-a"],
    disabledProjectIds: [],
    defaultProfileId: "default",
    profileIdByProjectId: {},
    storageGrantedProjectIds: ["project-a"],
    workspaceReadGrantedProjectIds: ["project-a"],
    gitStatusGrantedProjectIds: ["project-a"],
    networkGrantedProjectIds: ["project-a"],
    credentialGrantedProjectIds: ["project-a"],
    aiToolGrantedProjectIds: ["project-a"],
  },
} as DesktopInstalledExtension;

let currentExtensions: DesktopInstalledExtension[] = [baseExtension];

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => [{ id: "project-a", name: "Alpha" }],
}));
vi.mock("~/state/threads", () => ({ projectsAtom: Symbol("projects") }));
vi.mock("~/state/extensions", () => ({
  useInstalledExtensions: () => currentExtensions,
  refreshExtensions: async () => {},
}));
vi.mock("~/state/workspaceShell", () => ({
  workspaceShellActions: { removeExtensionToolPreferences: () => {} },
}));
vi.mock("./SettingsLayout", () => ({
  SettingsSection: ({ title, children }: { title?: string; children: ReactNode }) => (
    <section>
      {title ? <h3>{title}</h3> : null}
      {children}
    </section>
  ),
  SettingsSectionHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
}));

import ExtensionsSettings from "./ExtensionsSettings";

afterEach(() => {
  currentExtensions = [baseExtension];
  vi.unstubAllGlobals();
});

describe("ExtensionsSettings accessibility and UI journeys", () => {
  it("names installed extension controls with their package and project context", () => {
    vi.stubGlobal("window", { desktopBridge: {} });
    const html = renderToStaticMarkup(<ExtensionsSettings />);
    expect(html).toContain('role="group" aria-label="Extension settings views"');
    expect(html).toContain('aria-label="Dashboard installation and project settings"');
    expect(html).toContain('aria-label="Enable Dashboard"');
    expect(html).toContain('aria-label="Show Dashboard in all projects"');
    expect(html).toContain('aria-label="Show Dashboard in Alpha"');
    expect(html).toContain('aria-label="Check Dashboard for updates"');
    expect(html).toContain("Pin Dashboard at version 1.0.0");
    expect(html).toContain("Uninstall Dashboard");
  });

  it("shows clear revoked warning and disables enablement controls when version is revoked", () => {
    currentExtensions = [{ ...baseExtension, revoked: true }];
    vi.stubGlobal("window", { desktopBridge: {} });
    const html = renderToStaticMarkup(<ExtensionsSettings />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("This version was revoked by its registry.");
    expect(html).toContain('disabled=""');
  });

  it("renders desktop-only placeholder when bridge is unavailable", () => {
    vi.stubGlobal("window", {});
    const html = renderToStaticMarkup(<ExtensionsSettings />);
    expect(html).toContain("Desktop only");
    expect(html).toContain("Extensions are currently available in Tabs desktop.");
  });
});

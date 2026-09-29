import "../../index.css";
import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type {
  DesktopBridge,
  DesktopExchangeListing,
  DesktopInstalledExtension,
  DesktopPreparedExchangeInstall,
} from "@tabs/contracts";

const sampleExtension: DesktopInstalledExtension = {
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
};

const sampleListing: DesktopExchangeListing = {
  registryOrigin: "https://exchange.example",
  id: "acme.analytics",
  namespace: "acme",
  name: "analytics",
  version: "1.0.0",
  digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  displayName: "Analytics Tool",
  description: "Workspace analytics",
  verifiedPublisher: true,
  tabsCompatibility: ">=1.3.0",
  capabilities: ["network"],
  sourceUrl: "https://example.com/source",
  supportUrl: "https://example.com/support",
  privacyUrl: "https://example.com/privacy",
};

const samplePreparedInstall: DesktopPreparedExchangeInstall = {
  token: "token-123",
  digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  registryOrigin: "https://exchange.example",
  willKeepEnabled: false,
  addedCapabilities: ["network"],
  addedNetworkHosts: ["api.example.com"],
  addedAiTools: [],
  requiresManualReview: false,
  manifest: {
    manifestVersion: 1,
    publisher: "acme",
    name: "analytics",
    version: "1.0.0",
    displayName: "Analytics Tool",
    description: "Workspace analytics",
    engines: { tabs: ">=1.3.0" },
    capabilities: ["network"],
    networkHosts: ["api.example.com"],
    contributes: {
      tools: [{ id: "analytics", label: "Analytics", entry: "index.html" }],
    },
  },
};

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => [{ id: "project-a", name: "Alpha Project" }],
}));
vi.mock("~/state/threads", () => ({ projectsAtom: Symbol("projects") }));
vi.mock("~/state/extensions", () => ({
  useInstalledExtensions: () => [sampleExtension],
  refreshExtensions: async () => {},
}));
vi.mock("~/state/workspaceShell", () => ({
  workspaceShellActions: { removeExtensionToolPreferences: () => {} },
}));

import ExtensionsSettings from "./ExtensionsSettings";

test("ExtensionsSettings: navigates views, manages focus on dialogs, and supports Escape cancellation in browser", async () => {
  let cancelCalled = false;
  const mockBridge: Partial<DesktopBridge> = {
    listExtensions: vi.fn(async () => [sampleExtension]),
    onExtensionsChanged: vi.fn(() => () => {}),
    listExtensionCredentials: vi.fn(async () => []),
    setExtensionAssignment: vi.fn(async () => undefined),
    discoverExchangeExtensions: vi.fn(async () => ({
      listings: [sampleListing],
      nextCursor: null,
    })),
    exchangeInstallAvailable: vi.fn(async () => true),
    prepareExchangeInstall: vi.fn(async () => samplePreparedInstall),
    confirmExchangeInstall: vi.fn(async () => sampleExtension),
    cancelExchangeInstall: vi.fn(async () => {
      cancelCalled = true;
    }),
    setExtensionUpdatesPinned: vi.fn(async () => undefined),
    checkExtensionUpdate: vi.fn(async () => null),
    setExtensionDisabled: vi.fn(async () => undefined),
    uninstallExtension: vi.fn(async () => undefined),
    setTheme: vi.fn(async () => undefined),
  };

  (window as unknown as { desktopBridge: typeof mockBridge }).desktopBridge = mockBridge;

  const screen = await render(
    <div style={{ width: 800, minHeight: 600 }}>
      <ExtensionsSettings />
    </div>,
  );

  // Tab buttons rendered
  const discoverTab = screen.getByRole("button", { name: "Discover" });
  const installedTab = screen.getByRole("button", { name: "Installed" });
  const profilesTab = screen.getByRole("button", { name: "Profiles & Permissions" });

  await expect.element(installedTab).toBeVisible();
  await expect.element(discoverTab).toBeVisible();
  await expect.element(profilesTab).toBeVisible();

  // Test uninstall flow with keyboard and focus restoration
  const uninstallButton = screen.getByRole("button", { name: "Uninstall Dashboard" });
  await expect.element(uninstallButton).toBeVisible();

  await uninstallButton.click();

  // Dialog heading receives focus
  const uninstallHeading = screen.getByRole("heading", { name: "Uninstall Dashboard?" });
  await expect.element(uninstallHeading).toBeVisible();
  expect(document.activeElement).toBe(uninstallHeading.element());

  // Cancel via Escape key
  await userEvent.keyboard("{Escape}");

  // Verify dialog closed and focus returned to trigger
  const restoredUninstallButton = screen.getByRole("button", { name: "Uninstall Dashboard" });
  await expect.element(restoredUninstallButton).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(restoredUninstallButton.element());

  // Switch to Profiles & Permissions tab
  (
    Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Profiles & Permissions",
    ) as HTMLButtonElement
  ).click();

  await expect
    .element(page.getByText(/A shared profile uses one storage space across projects/))
    .toBeVisible();
  await expect
    .element(screen.getByRole("combobox", { name: "Default profile for Dashboard" }))
    .toBeVisible();

  // Switch to Discover tab
  (
    Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Discover",
    ) as HTMLButtonElement
  ).click();

  await expect.element(screen.getByRole("heading", { name: "Discover" })).toBeVisible();

  // Search Exchange
  const searchInput = screen.getByRole("textbox", { name: "Search Tabs Exchange extensions" });
  await searchInput.fill("analytics");
  const searchButton = screen.getByRole("button", { name: "Search Exchange" });
  await searchButton.click();

  // Listing appears
  const reviewButton = screen.getByRole("button", { name: "Review & install Analytics Tool" });
  await expect.element(reviewButton).toBeVisible();

  // Click review
  await reviewButton.click();

  // Review section heading receives focus
  const reviewHeading = screen.getByRole("heading", { name: "Review Analytics Tool" });
  await expect.element(reviewHeading).toBeVisible();
  expect(document.activeElement).toBe(reviewHeading.element());

  // Cancel via Escape key
  await userEvent.keyboard("{Escape}");
  expect(cancelCalled).toBe(true);

  delete (window as unknown as { desktopBridge?: unknown }).desktopBridge;
});

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

const installedFixtures = [sampleExtension];
const projectFixtures = [{ id: "project-a", name: "Alpha Project" }];

vi.mock("@effect/atom-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAtomValue: () => projectFixtures,
  };
});
vi.mock("~/state/threads", () => ({ projectsAtom: Symbol("projects") }));
vi.mock("~/state/extensions", () => ({
  useInstalledExtensions: () => installedFixtures,
  refreshExtensions: async () => {},
}));
vi.mock("~/state/workspaceShell", () => ({
  workspaceShellActions: { removeExtensionToolPreferences: () => {} },
}));

import ExtensionsSettings from "./ExtensionsSettings";

test("ExtensionsSettings: navigates views, manages focus on dialogs, and supports Escape cancellation in browser", async () => {
  let cancelCount = 0;
  const confirmInstall = vi.fn(async () => sampleExtension);
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
    confirmExchangeInstall: confirmInstall,
    cancelExchangeInstall: vi.fn(async () => {
      cancelCount++;
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
  const discoverTab = screen.getByRole("button", { name: "Browse" });
  const installedTab = screen.getByRole("button", { name: /^Installed/ });

  await expect.element(installedTab).toBeVisible();
  await expect.element(discoverTab).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Profiles & Permissions" }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Manage Dashboard" }).click();

  // Custom project controls preserve the native assignment contract.
  await screen
    .getByRole("checkbox", { name: "Show Dashboard in Alpha Project", exact: true })
    .click();
  await expect
    .poll(() => mockBridge.setExtensionAssignment)
    .toHaveBeenCalledWith("acme.dashboard", expect.objectContaining({ enabledProjectIds: [] }));

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

  await screen.getByRole("button", { name: "Accounts & access", exact: true }).click();
  await expect
    .element(screen.getByRole("combobox", { name: "Default profile for Dashboard" }))
    .toBeVisible();

  const scope = screen.getByRole("combobox", { name: "Storage scope for new Dashboard profile" });
  await scope.click();
  await screen.getByRole("option", { name: "Isolated per project" }).click();
  await expect.element(scope).toHaveTextContent("Isolated per project");

  await discoverTab.click();
  await expect.element(screen.getByRole("region", { name: "Browse extensions" })).toBeVisible();

  // Search Exchange
  const searchInput = screen.getByRole("textbox", { name: "Search Tabs Exchange extensions" });
  await searchInput.fill("analytics");
  const searchButton = screen.getByRole("button", { name: "Search Exchange" });
  await searchButton.click();

  await screen.getByRole("button", { name: "View Analytics Tool" }).click();
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
  expect(cancelCount).toBe(1);
  await expect
    .element(screen.getByRole("heading", { name: "Review Analytics Tool" }))
    .not.toBeInTheDocument();
  await expect.poll(() => document.activeElement).toBe(reviewButton.element());

  // Escape must not cancel an install after confirmation has started.
  await reviewButton.click();
  confirmInstall.mockRejectedValueOnce(new Error("Verified installation could not be completed."));
  await screen.getByRole("button", { name: "Install verified package" }).click();
  await expect
    .element(
      screen.getByText(
        "Verified installation could not be completed. Review the package again before retrying.",
        { exact: true },
      ),
    )
    .toBeVisible();
  await expect.element(reviewHeading).not.toBeInTheDocument();
  await expect.poll(() => document.activeElement).toBe(reviewButton.element());
  expect(cancelCount).toBe(1);
  await reviewButton.click();
  let finishConfirm!: (extension: DesktopInstalledExtension) => void;
  confirmInstall.mockImplementationOnce(
    () =>
      new Promise<DesktopInstalledExtension>((resolve) => {
        finishConfirm = resolve;
      }),
  );
  await screen.getByRole("button", { name: "Install verified package" }).click();
  await userEvent.keyboard("{Escape}");
  expect(cancelCount).toBe(1);
  await expect
    .element(screen.getByRole("heading", { name: "Review Analytics Tool" }))
    .toBeVisible();
  finishConfirm(sampleExtension);
  await expect
    .element(screen.getByRole("button", { name: /^Installed/ }))
    .toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => document.activeElement).toBe(installedTab.element());

  delete (window as unknown as { desktopBridge?: unknown }).desktopBridge;
});

test("Install resumes the verified review after first-time connection, without installing automatically", async () => {
  await page.viewport(1200, 850);
  let trusted = false;
  const prepare = vi.fn(async () => samplePreparedInstall);
  const confirm = vi.fn();
  const bridge: Partial<DesktopBridge> = {
    setTheme: async () => {},
    getRegistryConnection: async () => ({
      origin: "https://exchange.example",
      connected: false,
      trusted,
    }),
    discoverExchangeExtensions: async () => ({ listings: [sampleListing], nextCursor: null }),
    exchangeInstallAvailable: async () => trusted,
    configureRegistryConnection: async () => {
      trusted = true;
      return { origin: "https://exchange.example", connected: false, trusted: true };
    },
    prepareExchangeInstall: prepare,
    confirmExchangeInstall: confirm,
    cancelExchangeInstall: async () => {},
  };
  (window as unknown as { desktopBridge: Partial<DesktopBridge> }).desktopBridge = bridge;
  const screen = await render(<ExtensionsSettings />);
  await screen.getByRole("button", { name: "Browse", exact: true }).click();
  await screen.getByRole("button", { name: "Review & install Analytics Tool" }).click();
  const upload = (label: string, value: unknown) => {
    const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    const data = new DataTransfer();
    data.items.add(new File([JSON.stringify(value)], "fixture.json", { type: "application/json" }));
    input.files = data.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  upload("Desktop connection settings file", {
    TABS_EXCHANGE_ORIGIN: "https://exchange.example",
    TABS_EXCHANGE_TRUST_ROOT_SHA256: "a".repeat(64),
    TABS_EXCHANGE_TRUST_ID: "registry-fixture",
  });
  upload("Public root.json file", { signed: { _type: "root" }, signatures: [] });
  await screen.getByLabelText("3. Confirm this registry").fill("https://exchange.example");
  await screen.getByRole("button", { name: "Trust & connect" }).click();
  await expect
    .element(screen.getByRole("heading", { name: "Review Analytics Tool" }))
    .toBeVisible();
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Cancel install" }).click();
  delete (window as unknown as { desktopBridge?: unknown }).desktopBridge;
});

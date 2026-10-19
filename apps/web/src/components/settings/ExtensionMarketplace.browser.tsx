import "../../index.css";
import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { DesktopBridge, DesktopExchangeListing } from "@tabs/contracts";
import { ExtensionMarketplace } from "./ExtensionMarketplace";
const relay: DesktopExchangeListing = {
  id: "acme.relay",
  namespace: "acme",
  name: "relay",
  registryOrigin: "https://exchange.example",
  version: "1.0.0",
  digest: "a".repeat(64),
  displayName: "Relay",
  description: "Keep your project context",
  verifiedPublisher: false,
  tabsCompatibility: ">=2.0.0",
  capabilities: [],
  listingAssets: { icon: true, readme: true, screenshots: 0 },
};
const second = { ...relay, id: "acme.focus", name: "focus", displayName: "Focus" };
const listings = [relay, second];
test("marketplace renders publisher descriptions safely, switches with keyboard, and ignores stale content", async () => {
  await page.viewport(1200, 850);
  let finish!: (value: { type: string; data: string }) => void;
  const openExternal = vi.fn();
  const bridge = {
    openExternal,
    getExchangeListingAsset: vi.fn(async (listing, kind) => {
      if (kind === "icon") return null;
      if (listing.id === relay.id)
        return new Promise<{ type: string; data: string }>((resolve) => {
          finish = resolve;
        });
      return {
        type: "text/plain",
        data: "# Focus overview\n\nA detailed explanation.\n\n<img src='https://leak.example/pixel'>\n\n![remote](https://leak.example/photo)\n\n[Unsafe](javascript:alert(1))\n\n[Documentation](https://docs.example)",
      };
    }),
  } as unknown as DesktopBridge;
  const onInstall = vi.fn();
  const screen = await render(
    <div className="extensions-settings">
      <ExtensionMarketplace
        bridge={bridge}
        listings={listings}
        installed={[]}
        busy={false}
        onInstall={onInstall}
        onManage={vi.fn()}
      />
    </div>,
  );
  const first = screen.getByRole("button", { name: "View Relay", exact: true });
  await first.click();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(screen.getByRole("heading", { name: "Focus overview" })).toBeVisible();
  finish({ type: "text/plain", data: "# Stale Relay content" });
  await expect
    .element(screen.getByRole("heading", { name: "Stale Relay content" }))
    .not.toBeInTheDocument();
  expect(document.querySelector("img[src^='https://']")).toBeNull();
  expect(screen.getByRole("article").element().querySelector("script")).toBeNull();
  await screen.getByRole("button", { name: /Unsafe/ }).click();
  expect(openExternal).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: /Documentation/ }).click();
  expect(openExternal).toHaveBeenCalledWith("https://docs.example/");
  await screen.getByRole("button", { name: "Review & install Focus" }).click();
  expect(onInstall).toHaveBeenCalledWith(second, expect.any(HTMLButtonElement));
  await screen.getByRole("button", { name: "Access", exact: true }).click();
  await expect
    .element(screen.getByRole("heading", { name: "No project permissions requested" }))
    .toBeVisible();
});
test("narrow screens open details intentionally and restore focus when returning to the list", async () => {
  await page.viewport(390, 800);
  const screen = await render(
    <div className="extensions-settings">
      <ExtensionMarketplace
        bridge={{} as DesktopBridge}
        listings={listings}
        installed={[]}
        busy={false}
        onInstall={vi.fn()}
        onManage={vi.fn()}
      />
    </div>,
  );
  const row = screen.getByRole("button", { name: "View Relay", exact: true });
  await expect.element(row).toBeVisible();
  await row.click();
  await expect
    .element(screen.getByRole("button", { name: "Review & install Relay" }))
    .toBeVisible();
  await screen.getByRole("button", { name: "All extensions", exact: true }).click();
  await expect.element(row).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(row.element());
  await userEvent.keyboard("{Tab}");
});

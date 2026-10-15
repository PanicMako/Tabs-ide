import { expect, it } from "vitest";
import type { DesktopExchangeListing } from "@tabs/contracts";
import { filterExchangeListings } from "./exchangeDiscovery";

const listing = (
  id: string,
  verifiedPublisher: boolean,
  capabilities: string[],
): DesktopExchangeListing => ({
  id,
  verifiedPublisher,
  capabilities,
  registryOrigin: "https://exchange.example",
  namespace: "studio",
  name: id,
  version: "1.0.0",
  digest: "a".repeat(64),
  displayName: "Notes",
  description: "Workspace notes",
  tabsCompatibility: ">=1.3.0",
});
it("combines publisher and requested-access filters without treating verification as permission-free", () => {
  const tools = [
    listing("offline", true, []),
    listing("online", true, ["network"]),
    listing("files", false, ["workspace-read"]),
  ];
  expect(filterExchangeListings(tools, "verified", "none").map((tool) => tool.id)).toEqual([
    "offline",
  ]);
  expect(filterExchangeListings(tools, "verified", "network").map((tool) => tool.id)).toEqual([
    "online",
  ]);
  expect(filterExchangeListings(tools, "verified", "workspace-read")).toEqual([]);
  expect(filterExchangeListings(tools, "all", "workspace-read").map((tool) => tool.id)).toEqual([
    "files",
  ]);
  expect(filterExchangeListings(tools, "all", "all")).toEqual(tools);
});
it("applies the current filter to additional pages without changing package identity or order", () => {
  const first = listing("first", false, []);
  const second = listing("second", true, []);
  const third = listing("third", true, []);
  const tools = [first, second];
  expect(filterExchangeListings(tools, "verified", "all")).toEqual([second]);
  tools.push(third);
  expect(filterExchangeListings(tools, "verified", "all")).toEqual([second, third]);
  expect(tools).toEqual([first, second, third]);
});

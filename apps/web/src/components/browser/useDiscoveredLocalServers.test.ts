import { describe, expect, it } from "vitest";
import { boundConfiguredLocalServerUrls } from "../../portDiscoveryState";
import { mergeServers, type PreviewableServer } from "./useDiscoveredLocalServers";

describe("boundConfiguredLocalServerUrls", () => {
  it("filters non-loopback hosts and invalid urls", () => {
    const urls = [
      "http://localhost:3000",
      "https://127.0.0.1:8080/test#hash",
      "http://example.com:3000",
      "not a url",
      "ftp://localhost:21",
    ];
    const bounded = boundConfiguredLocalServerUrls(urls);
    expect(bounded).toEqual(["http://localhost:3000/", "https://127.0.0.1:8080/test"]);
  });

  it("deduplicates identical URLs", () => {
    const urls = [
      "http://localhost:3000",
      "http://localhost:3000/",
      "http://localhost:3000#section",
    ];
    const bounded = boundConfiguredLocalServerUrls(urls);
    expect(bounded).toHaveLength(1);
    expect(bounded[0]).toBe("http://localhost:3000/");
  });
});

describe("mergeServers", () => {
  it("prioritizes configured servers and sorts by port", () => {
    const scanner = [
      {
        host: "localhost",
        port: 8080,
        url: "http://localhost:8080",
        requestedUrl: "http://localhost:8080",
        processName: "node",
        pid: 1234,
        terminal: null,
      },
      {
        host: "127.0.0.1",
        port: 3000,
        url: "http://127.0.0.1:3000",
        requestedUrl: "http://127.0.0.1:3000",
        processName: "vite",
        pid: 5678,
        terminal: null,
      },
    ];
    const configuredUrls = ["http://localhost:8080"];

    const merged = mergeServers({
      scanner,
      configuredUrls,
      configuredUrlProbing: true,
    });

    expect(merged).toHaveLength(2);
    // Configured server comes first
    expect(merged[0]?.port).toBe(8080);
    expect(merged[0]?.source).toBe("configured");
    // Scanner server comes next
    expect(merged[1]?.port).toBe(3000);
    expect(merged[1]?.source).toBe("scanner");
  });
});

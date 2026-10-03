import { describe, expect, it } from "vitest";

import {
  isLocalLoopbackHost,
  isPrivateNetworkHost,
  isPublicFaviconHost,
  normalizeHostname,
} from "./hostClassification.ts";

describe("isPublicFaviconHost", () => {
  it("treats public hosts as public", () => {
    for (const host of [
      "github.com",
      "www.google.com",
      "tabs.chat",
      "sub.domain.example.co.uk",
      "8.8.8.8",
      "1.1.1.1",
      "100.200.1.1",
      "172.32.0.1",
      "192.167.1.1",
      "11.0.0.1",
    ]) {
      expect(isPublicFaviconHost(host), host).toBe(true);
    }
  });

  it("detects private IPv4 ranges", () => {
    for (const host of [
      "0.0.0.0",
      "10.0.0.1",
      "10.255.255.255",
      "127.0.0.1",
      "192.168.1.10",
      "172.16.0.1",
      "172.31.255.255",
      "169.254.1.1",
    ]) {
      expect(isPublicFaviconHost(host), host).toBe(false);
    }
  });

  it("detects the Tailscale 100.64.0.0/10 range", () => {
    for (const host of ["100.64.0.1", "100.100.100.100", "100.126.17.15", "100.127.255.255"]) {
      expect(isPublicFaviconHost(host), host).toBe(false);
    }
    expect(isPublicFaviconHost("100.63.255.255")).toBe(true);
    expect(isPublicFaviconHost("100.128.0.1")).toBe(true);
  });

  it("detects private host names and suffixes", () => {
    for (const host of [
      "localhost",
      "air",
      "printer.local",
      "api.internal",
      "router.home.arpa",
      "home.arpa",
      "box.tailnet.ts.net",
      "AIR.TAILE8BEA7.TS.NET",
    ]) {
      expect(isPublicFaviconHost(host), host).toBe(false);
    }
  });

  it("identifies local loopback hosts", () => {
    expect(isLocalLoopbackHost("localhost")).toBe(true);
    expect(isLocalLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLocalLoopbackHost("127.1.2.3")).toBe(true);
    expect(isLocalLoopbackHost("::1")).toBe(true);
    expect(isLocalLoopbackHost("example.com")).toBe(false);
    expect(isLocalLoopbackHost("192.168.1.1")).toBe(false);
  });

  it("identifies private network hosts", () => {
    expect(isPrivateNetworkHost("localhost")).toBe(true);
    expect(isPrivateNetworkHost("10.0.0.5")).toBe(true);
    expect(isPrivateNetworkHost("192.168.0.1")).toBe(true);
    expect(isPrivateNetworkHost("my-server.local")).toBe(true);
    expect(isPrivateNetworkHost("my-server.ts.net")).toBe(true);
    expect(isPrivateNetworkHost("google.com")).toBe(false);
  });

  it("normalizes hostnames", () => {
    expect(normalizeHostname("[::1]")).toBe("::1");
    expect(normalizeHostname("LOCALHOST")).toBe("localhost");
    expect(normalizeHostname("example.com.")).toBe("example.com");
  });
});

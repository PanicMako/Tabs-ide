import { describe, expect, it } from "vitest";

import { parseElectronProxyResult, readProxyEnvironment } from "./nativeCodeHostProxy";

describe("native Code-OSS proxy diagnostics", () => {
  it("parses Chromium proxy chains", () => {
    expect(
      parseElectronProxyResult("PROXY proxy.example:8080; SOCKS5 socks.example:1080; DIRECT"),
    ).toEqual([
      { kind: "http", host: "proxy.example:8080" },
      { kind: "socks", host: "socks.example:1080" },
      { kind: "direct" },
    ]);
  });

  it("falls back to a direct connection for an empty result", () => {
    expect(parseElectronProxyResult("")).toEqual([{ kind: "direct" }]);
  });

  it("reports standard proxy environment variables without exposing unrelated values", () => {
    expect(
      readProxyEnvironment({ HTTPS_PROXY: "https://proxy", NO_PROXY: "localhost", SECRET: "x" }),
    ).toEqual({
      httpProxy: { variable: "HTTPS_PROXY", value: "https://proxy" },
      httpsProxy: { variable: "HTTPS_PROXY", value: "https://proxy" },
      noProxy: { variable: "NO_PROXY", value: "localhost" },
    });
  });
});

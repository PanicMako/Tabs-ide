import { describe, expect, it } from "vitest";

import { isNativeAntigravityAcpBinary } from "./AntigravityDriver";

describe("isNativeAntigravityAcpBinary", () => {
  it.each(["/managed/agy_acp_server.par", "C:\\managed\\agy_acp_server.exe", "agy_acp_server.par"])(
    "recognizes Google's native ACP executable: %s",
    (binaryPath) => {
      expect(isNativeAntigravityAcpBinary(binaryPath)).toBe(true);
    },
  );

  it.each([undefined, "", "agy", "/usr/local/bin/agy"])(
    "keeps the compatible print adapter for the existing CLI: %s",
    (binaryPath) => {
      expect(isNativeAntigravityAcpBinary(binaryPath)).toBe(false);
    },
  );
});

import { describe, expect, it } from "vitest";
import {
  validateRemoteHost,
  validateSshPort,
  validateSshTarget,
} from "./connectionInputValidation";

describe("connection input validation", () => {
  it.each(["server.example.com", "https://server.example.com:8443", "127.0.0.1:3000"])(
    "accepts remote host %s",
    (value) => expect(validateRemoteHost(value)).toBeNull(),
  );
  it.each(["", "javascript:alert(1)", "bad host"])("rejects remote host %s", (value) =>
    expect(validateRemoteHost(value)).not.toBeNull(),
  );
  it("validates SSH targets and ports", () => {
    expect(validateSshTarget("user@example.com")).toBeNull();
    expect(validateSshTarget("workbox")).toBeNull();
    expect(validateSshTarget("-oProxyCommand=bad")).not.toBeNull();
    expect(validateSshPort("22")).toBeNull();
    expect(validateSshPort("65536")).not.toBeNull();
  });
});

import * as OS from "node:os";
import { describe, expect, it } from "vitest";

import { redactSupportBundleText, redactDiagnosticValue } from "./SupportBundle.ts";

describe("SupportBundle", () => {
  it("redacts home paths, credentials, and token-shaped values", () => {
    const input = `${OS.homedir()}/project?token=secret-value Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456`;
    const result = redactSupportBundleText(input);
    expect(result).not.toContain(OS.homedir());
    expect(result).not.toContain("secret-value");
    expect(result).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456");
    expect(result).toContain("<home>");
    expect(result).toContain("<redacted>");
  });
});

it("redacts short credentials and private diagnostic fields before serialization", () => {
  const output = JSON.stringify(
    redactDiagnosticValue({
      apiKey: "abc",
      nested: {
        cookies: "session=a",
        accountId: "person",
        prompt: "private",
        source: "code",
        cwd: "/repo",
        argv: ["--token", "abc"],
        pid: 12,
      },
      environmentId: "id",
    }),
  );
  for (const secret of ["abc", "session=a", "person", "private", "code", "/repo", "--token"])
    expect(output).not.toContain(secret);
  expect(output).toContain('"pid":12');
});

import { describe, expect, it } from "vitest";
import { buildSshHost, sshHostIdFor, sshHostToForm } from "./sshHostForm";

const form = (overrides: Partial<Parameters<typeof buildSshHost>[0]> = {}) => ({
  label: "Mac mini",
  target: "me@mini.local",
  port: "",
  identityFile: "",
  ...overrides,
});

describe("sshHostIdFor", () => {
  it("makes a readable id and avoids ones already taken", () => {
    expect(sshHostIdFor("My Mac mini!", [])).toBe("my-mac-mini");
    expect(sshHostIdFor("Mac mini", ["mac-mini"])).toBe("mac-mini-2");
    expect(sshHostIdFor("Mac mini", ["mac-mini", "mac-mini-2"])).toBe("mac-mini-3");
  });

  it("never uses the reserved local id", () => {
    expect(sshHostIdFor("Local", [])).toBe("local-host");
    expect(sshHostIdFor("!!!", [])).toBe("host");
  });
});

describe("buildSshHost", () => {
  it("builds a host with only the fields that were filled in", () => {
    expect(buildSshHost(form(), [])).toEqual({
      ok: true,
      host: { id: "mac-mini", label: "Mac mini", target: "me@mini.local" },
    });
    expect(buildSshHost(form({ port: "2222", identityFile: " ~/.ssh/mini " }), [])).toEqual({
      ok: true,
      host: {
        id: "mac-mini",
        label: "Mac mini",
        target: "me@mini.local",
        port: 2222,
        identityFile: "~/.ssh/mini",
      },
    });
  });

  it("explains each thing that needs fixing", () => {
    for (const bad of [
      form({ label: "  " }),
      form({ target: "" }),
      form({ target: "me @mini" }),
      form({ target: "-oProxyCommand=x" }),
      form({ port: "0" }),
      form({ port: "70000" }),
      form({ port: "22.5" }),
    ]) {
      const result = buildSshHost(bad, []);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message.length).toBeGreaterThan(10);
    }
  });

  it("keeps the id when editing a host and does not clash with itself", () => {
    expect(buildSshHost(form({ label: "Renamed" }), ["mac-mini"], "mac-mini")).toEqual({
      ok: true,
      host: { id: "mac-mini", label: "Renamed", target: "me@mini.local" },
    });
  });

  it("round-trips a host through the form", () => {
    const host = { id: "a", label: "A", target: "u@h", port: 22, identityFile: "k" };
    expect(buildSshHost(sshHostToForm(host), [], "a")).toEqual({ ok: true, host });
  });
});

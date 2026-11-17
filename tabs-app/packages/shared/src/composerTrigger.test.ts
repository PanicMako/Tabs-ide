import { describe, expect, it } from "vitest";

import { parseSideChatCommand, serializeComposerFileLink } from "./composerTrigger";

describe("serializeComposerFileLink", () => {
  it("uses the basename as the markdown label", () => {
    expect(serializeComposerFileLink("path/to/package.json")).toBe(
      "[package.json](path/to/package.json)",
    );
  });

  it("encodes markdown-sensitive destination characters", () => {
    expect(serializeComposerFileLink("docs/My File (draft).md")).toBe(
      "[My File (draft).md](docs/My%20File%20%28draft%29.md)",
    );
  });

  it("supports windows paths", () => {
    expect(serializeComposerFileLink("C:\\repo\\src\\index.ts")).toBe(
      "[index.ts](C:%5Crepo%5Csrc%5Cindex.ts)",
    );
  });

  it("preserves paths that legitimately start with an at sign", () => {
    expect(serializeComposerFileLink("@scope/package.json")).toBe(
      "[package.json](@scope/package.json)",
    );
  });
});

describe("parseSideChatCommand", () => {
  it("reads /side and its /btw alias, with or without a prompt", () => {
    expect(parseSideChatCommand("/side why did that fail?")).toEqual({
      prompt: "why did that fail?",
    });
    expect(parseSideChatCommand("  /BTW   what is a lock\nfile?  ")).toEqual({
      prompt: "what is a lock\nfile?",
    });
    expect(parseSideChatCommand("/side")).toEqual({ prompt: "" });
  });

  it("leaves other messages and look-alike commands alone", () => {
    expect(parseSideChatCommand("please /side this")).toBeNull();
    expect(parseSideChatCommand("/sidebar")).toBeNull();
    expect(parseSideChatCommand("/btwx hi")).toBeNull();
  });
});

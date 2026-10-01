import * as Path from "node:path";

import { describe, expect, it } from "vitest";

import {
  filePathFromNativeUri,
  getNativeCodeOpenTargets,
  parseNativeAgentsWindowOptions,
} from "./nativeCodeHostOpen";

describe("native Code-OSS open targets", () => {
  it("revives file URI components without losing spaces or unicode", () => {
    expect(
      filePathFromNativeUri({
        scheme: "file",
        authority: "",
        path: "/tmp/My Project/✓.ts",
      }),
    ).toBe(Path.join(Path.sep, "tmp", "My Project", "✓.ts"));
  });

  it("preserves literal percent escapes and URL delimiters in URI component paths", () => {
    for (const name of ["literal%20name.ts", "100% done.ts", "query?.ts", "fragment#.ts"]) {
      const path = `/tmp/${name}`;
      expect(filePathFromNativeUri({ scheme: "file", authority: "", path })).toBe(path);
      expect(getNativeCodeOpenTargets([{ fileUri: { scheme: "file", path } }])).toEqual([
        { kind: "file", path },
      ]);
    }
  });

  it("routes files to the current project and folders/workspaces to Tabs", () => {
    expect(
      getNativeCodeOpenTargets([
        { fileUri: { scheme: "file", path: "/tmp/file.ts" } },
        { folderUri: { scheme: "file", path: "/tmp/project" } },
        { workspaceUri: { fsPath: "/tmp/example.code-workspace" } },
      ]),
    ).toEqual([
      { kind: "file", path: "/tmp/file.ts" },
      { kind: "folder", path: "/tmp/project" },
      { kind: "workspace", path: "/tmp/example.code-workspace" },
    ]);
  });

  it("rejects non-file schemes", () => {
    expect(filePathFromNativeUri({ scheme: "https", path: "/example" })).toBeNull();
    expect(
      filePathFromNativeUri({
        scheme: "vscode-remote",
        authority: "ssh-remote+example",
        path: "/workspace/project",
        fsPath: "/workspace/project",
      }),
    ).toBeNull();
  });

  it("preserves logical Agents resources and serialized draft attachments", () => {
    const options = {
      folderUri: { scheme: "vscode-remote", authority: "ssh-remote+host", path: "/workspace" },
      sessionResource: {
        scheme: "vscode-chat-session",
        path: "/session-1",
        query: "provider=local",
        fragment: "turn",
      },
      onboardingSessionResource: { scheme: "agent-host", path: "/onboarding" },
      folderUriIsDefault: true,
      source: "parallelWorkEmptyChatHandoff",
      draft: {
        inputText: "Investigate performance",
        attachments: '[{"kind":"file","uri":{"scheme":"file","path":"/a%20b"}}]',
      },
    };
    expect(parseNativeAgentsWindowOptions(options)).toEqual(options);
  });

  it("rejects invalid drafts rather than silently dropping them", () => {
    for (const draft of [
      { text: "old invalid fixture" },
      {},
      "invalid",
      null,
      { inputText: "prompt" },
    ])
      expect(() => parseNativeAgentsWindowOptions({ draft })).toThrow("Invalid Agents draft");
    expect(parseNativeAgentsWindowOptions(undefined)).toMatchObject({
      source: "unknown",
      folderUriIsDefault: false,
    });
    expect(() =>
      parseNativeAgentsWindowOptions({ sessionResource: { scheme: "https", path: 1 } }),
    ).toThrow("Invalid Agents resource URI");
  });
});

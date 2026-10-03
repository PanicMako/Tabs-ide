import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  AgentSessionImportInput,
  AgentSessionImportResult,
  AgentSessionProjectCandidate,
  AgentSessionScanResult,
  AgentSessionSource,
  isImportedAgentSessionMessageId,
} from "./agentSessions.ts";
import { ProjectId } from "./baseSchemas.ts";

describe("AgentSession contracts", () => {
  it("recognizes imported message ids", () => {
    expect(isImportedAgentSessionMessageId("import:claude:session-1")).toBe(true);
    expect(isImportedAgentSessionMessageId("msg-12345")).toBe(false);
    expect(isImportedAgentSessionMessageId("")).toBe(false);
  });

  it("decodes valid AgentSessionSource", () => {
    const decodeSource = Schema.decodeUnknownSync(AgentSessionSource);
    expect(decodeSource("claudeAgent")).toBe("claudeAgent");
    expect(decodeSource("codex")).toBe("codex");
    expect(() => decodeSource("unknown")).toThrow();
  });

  it("decodes valid AgentSessionProjectCandidate", () => {
    const decodeCandidate = Schema.decodeUnknownSync(AgentSessionProjectCandidate);
    const candidate = decodeCandidate({
      path: "/Users/dev/tabs",
      title: "tabs",
      sources: ["claudeAgent", "codex"],
      threadCount: 5,
      lastActiveAt: "2026-09-12T00:00:00.000Z",
      alreadyImported: false,
      git: {
        remoteKey: "https://github.com/org/repo.git",
        repository: "org/repo",
      },
    });

    expect(candidate.path).toBe("/Users/dev/tabs");
    expect(candidate.title).toBe("tabs");
    expect(candidate.sources).toEqual(["claudeAgent", "codex"]);
    expect(candidate.threadCount).toBe(5);
    expect(candidate.git?.repository).toBe("org/repo");
  });

  it("decodes AgentSessionScanResult", () => {
    const decodeScanResult = Schema.decodeUnknownSync(AgentSessionScanResult);
    const result = decodeScanResult({
      candidates: [],
      scannedAt: "2026-09-12T00:00:00.000Z",
      truncated: false,
    });
    expect(result.candidates).toEqual([]);
    expect(result.scannedAt).toBe("2026-09-12T00:00:00.000Z");
  });

  it("decodes AgentSessionImportInput and AgentSessionImportResult", () => {
    const decodeInput = Schema.decodeUnknownSync(AgentSessionImportInput);
    const decodeResult = Schema.decodeUnknownSync(AgentSessionImportResult);

    const input = decodeInput({
      projectId: ProjectId.make("project-1"),
      expectedWorkspaceRoot: "/workspace/path",
    });
    expect(input.projectId).toBe("project-1");
    expect(input.expectedWorkspaceRoot).toBe("/workspace/path");

    const result = decodeResult({
      importedCount: 3,
      skippedCount: 1,
    });
    expect(result.importedCount).toBe(3);
    expect(result.skippedCount).toBe(1);
  });
});

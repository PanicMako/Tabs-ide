import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseAntigravityTranscriptLines,
  readAntigravityTranscript,
} from "./antigravityTranscript.ts";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))),
);

describe("Antigravity transcript JSONL", () => {
  it("parses step objects and ignores malformed records", () => {
    expect(
      parseAntigravityTranscriptLines([
        '{"type":"PLANNER_RESPONSE","step_index":2,"content":"done"}',
        "not-json",
        "[]",
      ]),
    ).toEqual([{ type: "PLANNER_RESPONSE", step_index: 2, content: "done" }]);
  });

  it("advances only past complete records", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tabs-antigravity-transcript-"));
    directories.push(directory);
    const path = join(directory, "transcript.jsonl");
    const complete = '{"type":"USER_INPUT","step_index":1}\n';
    await writeFile(path, complete + '{"type":"PLANNER_RESPONSE"');

    const batch = await readAntigravityTranscript(path, 0);
    expect(batch.steps).toEqual([{ type: "USER_INPUT", step_index: 1 }]);
    expect(batch.nextOffset).toBe(Buffer.byteLength(complete));
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { BrowserSubmissionGuards } from "./browserWorkflowHostId";

async function guards() {
  const directory = await mkdtemp(join(tmpdir(), "tabs-submission-guards-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return { directory, guards: new BrowserSubmissionGuards(() => directory) };
}
const partition = "persist:tabs-browser:profile:work";

describe("submission guards", () => {
  it("covers the same draft through query strings, trailing slashes and fragments", async () => {
    const { directory, guards: g } = await guards();
    g.set(partition, "https://app.test/drafts/42", true);
    for (const alias of [
      "https://app.test/drafts/42?x=1",
      "https://app.test/drafts/42/",
      "https://app.test/drafts/42/?utm=a#top",
      "https://APP.test/drafts/42",
    ])
      expect(g.has(partition, alias)).toBe(true);
    expect(g.has(partition, "https://app.test/drafts/43")).toBe(false);
    expect(g.has("persist:tabs-browser:profile:personal", "https://app.test/drafts/42")).toBe(
      false,
    );
    expect(
      new BrowserSubmissionGuards(() => directory).has(
        partition,
        "https://app.test/drafts/42/?x=1",
      ),
    ).toBe(true);
    g.set(partition, "https://app.test/drafts/42?x=1", false);
    expect(g.has(partition, "https://app.test/drafts/42")).toBe(false);
    expect(g.has(partition, "https://app.test/drafts/42/?y=2")).toBe(false);
  });

  it("keeps a workflow URL's own query as part of the draft identity", async () => {
    const { guards: g } = await guards();
    g.set(partition, "https://app.test/review?draft=7", true);
    expect(g.has(partition, "https://app.test/review?draft=7")).toBe(true);
    expect(g.has(partition, "https://app.test/review?draft=8")).toBe(false);
    expect(g.has(partition, "https://app.test/review")).toBe(false);
  });

  it("remembers the visible identity for any page of the same partition and origin", async () => {
    const { guards: g } = await guards();
    g.set(partition, "https://app.test/drafts/42", true, {
      selector: "#id",
      resourceId: "42",
    });
    expect(g.identitiesFor(partition, "https://app.test/other/path")).toEqual([
      {
        partition,
        origin: "https://app.test",
        selector: "#id",
        resourceId: "42",
      },
    ]);
    expect(g.identitiesFor(partition, "https://other.test/")).toEqual([]);
    expect(g.identitiesFor("persist:tabs-browser:profile:personal", "https://app.test/")).toEqual(
      [],
    );
    g.set(partition, "https://app.test/drafts/42", false);
    expect(g.identitiesFor(partition, "https://app.test/")).toEqual([]);
  });
});

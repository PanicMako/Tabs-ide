import { describe, expect, it, vi } from "vitest";
import { clearSubmissionView } from "../frontend/src/lib/submissionView.ts";
describe("submission access-loss presentation", () => {
  it("clears review evidence, hides links and removes the appeal draft", () => {
    const ids = [
      "submission-identity",
      "submission-metadata",
      "submission-timeline",
      "submission-reason",
      "submission-issues",
      "submission-scan",
      "submission-appeal-state",
      "submission-public-link",
      "submission-correction",
      "submission-correction-options",
      "submission-appeal-message",
    ];
    const entries = new Map(
      ids.map((id) => [
        id,
        {
          textContent: "private data",
          hidden: false,
          value: "private draft",
          replaceChildren: vi.fn(),
          removeAttribute: vi.fn(),
        },
      ]),
    );
    const document = { getElementById: (id: string) => entries.get(id) ?? null } as unknown as Pick<
      Document,
      "getElementById"
    >;
    clearSubmissionView(document);
    expect(entries.get("submission-identity")?.textContent).not.toContain("private data");
    for (const id of ids.slice(1, 7))
      expect(entries.get(id)?.replaceChildren).toHaveBeenCalledOnce();
    for (const id of ids.slice(7, 10)) expect(entries.get(id)?.hidden).toBe(true);
    expect(entries.get("submission-public-link")?.removeAttribute).toHaveBeenCalledWith("href");
    expect(entries.get("submission-appeal-message")?.value).toBe("");
  });
  it("does not fail if a partially mounted page has no details", () => {
    expect(() => clearSubmissionView({ getElementById: () => null })).not.toThrow();
  });
});

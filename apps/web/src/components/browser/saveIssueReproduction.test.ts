import { describe, expect, it, vi } from "vitest";
import { saveIssueReproduction } from "./saveIssueReproduction";
import type { IssueReproduction } from "./RecordIssueDialog";
const reproduction: IssueReproduction = {
  id: "issue-test",
  projectId: "project",
  taskId: "task",
  route: "http://localhost:3000",
  steps: [{ id: "fill", action: "fill", selector: "#password", value: "synthetic-private-input" }],
  expectedResult: "Expected",
  generatedCode: "reviewed spec",
  specPath: "tests/e2e/reproductions/issue-test.spec.ts",
  verificationStatus: "not_verified",
  createdAt: "2026-09-13T00:00:00Z",
};
describe("saveIssueReproduction", () => {
  it("writes project-scoped evidence without input values and then awaits actual dispatch", async () => {
    const order: string[] = [];
    const writeFile = vi.fn(async (input) => {
      order.push(input.relativePath);
    });
    const dispatch = vi.fn(async () => {
      order.push("dispatch");
    });
    await saveIssueReproduction(reproduction, { cwd: "/project", writeFile, dispatch });
    expect(order).toEqual([
      reproduction.specPath,
      "tests/e2e/reproductions/issue-test.json",
      "dispatch",
    ]);
    expect(writeFile.mock.calls.every(([input]) => input.cwd === "/project")).toBe(true);
    expect(writeFile.mock.calls[1]![0].contents).not.toContain("synthetic-private-input");
    expect(dispatch).toHaveBeenCalledWith(reproduction);
  });
  it("never dispatches after a failed artifact write or missing service", async () => {
    const dispatch = vi.fn(async () => undefined);
    await expect(saveIssueReproduction(reproduction, { cwd: "", dispatch })).rejects.toThrow();
    await expect(
      saveIssueReproduction(reproduction, {
        cwd: "/project",
        dispatch,
        writeFile: async () => {
          throw new Error("Disk unavailable");
        },
      }),
    ).rejects.toThrow("Disk unavailable");
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("propagates dispatch failure and preserves the identity for a retry", async () => {
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Disconnected"))
      .mockResolvedValueOnce(undefined);
    const destination = { cwd: "/project", writeFile: async () => undefined, dispatch };
    await expect(saveIssueReproduction(reproduction, destination)).rejects.toThrow("Disconnected");
    await saveIssueReproduction(reproduction, destination);
    expect(dispatch.mock.calls.map(([input]) => input)).toEqual([reproduction, reproduction]);
  });
});

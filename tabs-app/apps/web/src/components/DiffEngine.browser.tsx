import "../index.css";
import { FileDiff } from "@pierre/diffs/react";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";
import { getRenderablePatch } from "../lib/diffRendering";

const patch = `diff --git a/example.ts b/example.ts
--- a/example.ts
+++ b/example.ts
@@ -1 +1 @@
-export const answer = 41;
+export const answer = 42;
`;

it("renders real highlighted diffs through the worker pool in both layouts", async () => {
  const parsed = getRenderablePatch(patch, "browser-engine");
  expect(parsed?.kind).toBe("files");
  if (parsed?.kind !== "files") throw new Error("Expected parsed diff");
  for (const diffStyle of ["unified", "split"] as const) {
    const view = await render(
      <DiffWorkerPoolProvider>
        <FileDiff fileDiff={parsed.files[0]!} options={{ diffStyle, theme: "pierre-light" }} />
      </DiffWorkerPoolProvider>,
    );
    try {
      await expect
        .poll(() => {
          const host = document.querySelector("diffs-container");
          return host?.shadowRoot?.textContent ?? "";
        })
        .toContain("answer");
      const root = document.querySelector("diffs-container")!.shadowRoot!;
      expect(root.textContent).toContain("41");
      expect(root.textContent).toContain("42");
      await expect.poll(() => root.querySelectorAll("span[style]").length).toBeGreaterThan(0);
    } finally {
      await view.unmount();
    }
  }
});

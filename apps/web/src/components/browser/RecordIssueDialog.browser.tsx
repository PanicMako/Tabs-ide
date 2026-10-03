import "../../index.css";
import { useState } from "react";
import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { RecordIssueDialog } from "./RecordIssueDialog";

const mocks = vi.hoisted(() => ({ writeFile: vi.fn(async () => undefined), toast: vi.fn() }));
vi.mock("~/nativeApi", () => ({
  readNativeApi: () => ({ projects: { writeFile: mocks.writeFile } }),
}));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: mocks.toast } }));

it("keeps recording after closing the dialog, preserves review on remount, and dispatches once", async () => {
  let recording = false;
  const runBrowserAutomation = vi.fn(async ({ operation }: { operation: string }) => {
    if (operation === "recordStart") {
      recording = true;
      return { recording };
    }
    if (operation === "recordStop") {
      recording = false;
      return {
        initialUrl: "http://localhost:3000/original",
        count: 1,
        steps: [{ id: "1", action: "assertVisible", selector: "#result" }],
      };
    }
    return { recording, count: 0 };
  });
  const original = window.desktopBridge;
  window.desktopBridge = {
    runBrowserAutomation,
    captureBrowserScreenshot: async () => ({ path: "/tmp/synthetic-before.png" }),
  } as unknown as NonNullable<Window["desktopBridge"]>;
  const dispatch = vi.fn(async () => undefined);
  const projectId = `ui-${crypto.randomUUID()}`;
  function Harness() {
    const [open, setOpen] = useState(true);
    const [mounted, setMounted] = useState(true);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open review</button>
        <button onClick={() => setMounted((value) => !value)}>Switch tab</button>
        {mounted && (
          <RecordIssueDialog
            isOpen={open}
            onOpenChange={setOpen}
            projectId={projectId}
            projectCwd="/synthetic-project"
            sessionId="tab"
            currentUrl="http://localhost:3000/current"
            assignedTaskId="task"
            availableTasks={[{ id: "task", title: "Fix issue" }]}
            onReproductionCreated={dispatch}
          />
        )}
      </>
    );
  }
  const view = await render(<Harness />);
  try {
    await page.getByRole("button", { name: "Start recording issue" }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(recording).toBe(true);
    await page.getByRole("button", { name: "Open review" }).click();
    await page.getByRole("button", { name: "Stop & review issue" }).click();
    const expected = "Result appears after saving";
    await page
      .getByPlaceholder("e.g. Save button remains enabled and shows success notification")
      .fill(expected);
    await page.getByRole("button", { name: "Close", exact: true }).first().click();
    await page.getByRole("button", { name: "Switch tab" }).click();
    await page.getByRole("button", { name: "Switch tab" }).click();
    await page.getByRole("button", { name: "Open review" }).click();
    await expect
      .element(
        page.getByPlaceholder("e.g. Save button remains enabled and shows success notification"),
      )
      .toHaveValue(expected);
    await page.getByRole("button", { name: "Send to Task" }).click();
    await expect.poll(() => dispatch.mock.calls.length).toBe(1);
    await expect.element(page.getByRole("button", { name: "Send to Task" })).toBeDisabled();
    expect(mocks.writeFile.mock.calls).toHaveLength(2);
  } finally {
    await view.unmount();
    if (original) window.desktopBridge = original;
    else delete window.desktopBridge;
  }
});

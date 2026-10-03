import "../../index.css";
import { useState } from "react";
import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CameraIcon, BugIcon, ShieldCheckIcon } from "lucide-react";
import { BrowserToolbar } from "./BrowserToolbar";
import { Button } from "../ui/button";

it("groups secondary actions and keeps the address usable at desktop and narrow widths", async () => {
  const screenshot = vi.fn();
  const reload = vi.fn();
  const submit = vi.fn();
  function Preview() {
    const [expanded, setExpanded] = useState(true);
    const [url, setUrl] = useState("localhost:5173");
    return (
      <div data-testid="toolbar-preview" style={{ width: 1100, maxWidth: "100%", padding: 12 }}>
        {expanded ? (
          <div className="rounded-xl border bg-card p-2">
            <BrowserToolbar
              title="chatgpt"
              canGoBack
              canGoForward={false}
              onBack={() => undefined}
              onForward={() => undefined}
              onReload={reload}
              onExternal={() => undefined}
              onCollapse={() => setExpanded(false)}
              address={
                <form
                  className="flex h-9 min-w-0 items-center gap-2 rounded-lg border bg-muted/40 px-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit(url);
                  }}
                >
                  <ShieldCheckIcon className="size-3.5 shrink-0 text-foreground" />
                  <input
                    className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
                    aria-label="chatgpt URL"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                  <button type="submit" aria-label="Navigate to address">
                    ↵
                  </button>
                </form>
              }
              captureActions={[
                {
                  label: "Take screenshot",
                  description: "Save an image of this page",
                  icon: <CameraIcon className="size-4" />,
                  onClick: screenshot,
                },
                {
                  label: "Record video",
                  icon: <CameraIcon className="size-4" />,
                  onClick: () => undefined,
                },
                {
                  label: "Record issue",
                  icon: <BugIcon className="size-4" />,
                  onClick: () => undefined,
                },
              ]}
              toolActions={[
                {
                  label: "Developer tools",
                  icon: <BugIcon className="size-4" />,
                  onClick: () => undefined,
                },
                {
                  label: "Compare pages",
                  icon: <BugIcon className="size-4" />,
                  onClick: () => undefined,
                },
              ]}
              viewControls={
                <>
                  <div className="flex justify-between text-xs">
                    <span>Zoom</span>
                    <span>100%</span>
                  </div>
                  <div className="border-t pt-2 text-xs">Viewport: Project default</div>
                </>
              }
            />
          </div>
        ) : (
          <Button onClick={() => setExpanded(true)}>Show chatgpt controls</Button>
        )}
        <div className="mt-2 flex h-40 items-center justify-center rounded-xl border bg-muted/20 text-sm text-muted-foreground">
          Page content
        </div>
      </div>
    );
  }
  const originalTheme = document.documentElement.getAttribute("data-theme");
  document.documentElement.setAttribute("data-theme", "tabs-light");
  await page.viewport(1200, 650);
  const view = await render(<Preview />);
  try {
    await expect
      .element(page.getByRole("menuitem", { name: "Take screenshot" }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    await page.getByRole("menuitem", { name: "Take screenshot" }).click();
    expect(screenshot).toHaveBeenCalledOnce();
    await page.getByRole("button", { name: "Reload page" }).click();
    expect(reload).toHaveBeenCalledWith(false);
    await page.getByRole("textbox", { name: "chatgpt URL" }).fill("https://chatgpt.com/");
    await page.getByRole("button", { name: "Navigate to address" }).click();
    expect(submit).toHaveBeenCalledWith("https://chatgpt.com/");
    await page.getByRole("button", { name: "View settings" }).click();
    await expect.element(page.getByText("Zoom", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View settings" }).click();
    await page.getByRole("button", { name: "Collapse chatgpt controls" }).click();
    await page.getByRole("button", { name: "Show chatgpt controls" }).click();
    await expect
      .element(page.getByRole("textbox", { name: "chatgpt URL" }))
      .toHaveValue("https://chatgpt.com/");
    await page.getByTestId("toolbar-preview").screenshot({ path: "/tmp/tabs-toolbar-wide.png" });
    await page.viewport(375, 650);
    await expect.poll(() => document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
    await expect.element(page.getByRole("textbox", { name: "chatgpt URL" })).toBeVisible();
    await page.getByTestId("toolbar-preview").screenshot({ path: "/tmp/tabs-toolbar-narrow.png" });
  } finally {
    await view.unmount();
    if (originalTheme) document.documentElement.setAttribute("data-theme", originalTheme);
    else document.documentElement.removeAttribute("data-theme");
  }
});

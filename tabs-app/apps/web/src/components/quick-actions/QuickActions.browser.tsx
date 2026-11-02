import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../index.css";
import { LauncherSurface } from "./QuickActions";
import { LAUNCHER_DESIGNS, QUICK_ACTIONS } from "./actions";

for (const design of LAUNCHER_DESIGNS) {
  it(`${design.name} runs the shared action and exposes an accessible search`, async () => {
    const execute = vi.fn(async () => {});
    await render(
      <LauncherSurface
        design={design.id}
        actions={QUICK_ACTIONS}
        execute={execute}
        disabled={() => undefined}
        preview
      />,
    );
    await page.getByRole("button", { name: /New workspace tab/ }).click();
    expect(execute).toHaveBeenCalledWith("new-tab", "");
    await page.getByRole("textbox").fill("some documentation query");
    await page.getByRole("button", { name: /Search the web/ }).click();
    expect(execute).toHaveBeenLastCalledWith("search", "some documentation query");
  });
}
it("shows action errors and respects unavailable workspace actions", async () => {
  const execute = vi.fn(async () => {
    throw new Error("Workspace disconnected");
  });
  await render(
    <LauncherSurface
      design="list"
      actions={QUICK_ACTIONS}
      execute={execute}
      disabled={(id) => (id === "new-agent" ? "Open a project first" : undefined)}
      preview
    />,
  );
  await expect.element(page.getByRole("button", { name: /New conversation/ })).toBeDisabled();
  await page.getByRole("button", { name: /New workspace tab/ }).click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("Workspace disconnected");
});
it("focus view advances one action at a time", async () => {
  await render(
    <LauncherSurface
      design="stack"
      actions={QUICK_ACTIONS}
      execute={async () => {}}
      disabled={() => undefined}
      preview
    />,
  );
  await expect.element(page.getByRole("button", { name: /New workspace tab/ })).toBeVisible();
  await page.getByRole("button", { name: "Next →" }).click();
  await expect.element(page.getByRole("button", { name: /New conversation/ })).toBeVisible();
});
it("compass pages reveal the same remaining actions", async () => {
  await render(
    <LauncherSurface
      design="compass"
      actions={QUICK_ACTIONS}
      execute={async () => {}}
      disabled={() => undefined}
      preview
    />,
  );
  await page.getByRole("button", { name: "More →" }).click();
  await expect.element(page.getByRole("button", { name: /Pop out conversation/ })).toBeVisible();
});

it("focus view preserves keyboard focus while replacing its single action", async () => {
  const execute = vi.fn(async () => {});
  await render(
    <LauncherSurface
      design="stack"
      actions={QUICK_ACTIONS}
      execute={execute}
      disabled={() => undefined}
      preview
    />,
  );
  await page.getByRole("textbox").click();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByRole("button", { name: /New workspace tab/ })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByRole("button", { name: /New conversation/ })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(execute).toHaveBeenCalledWith("new-agent", "");
});
it("keypad reserves numbers for navigation outside text input and moves vertically by row", async () => {
  const execute = vi.fn(async () => {});
  await render(
    <LauncherSurface
      design="matrix"
      actions={QUICK_ACTIONS}
      execute={execute}
      disabled={() => undefined}
      preview
    />,
  );
  await page.getByRole("textbox").click();
  await userEvent.keyboard("123");
  expect(execute).not.toHaveBeenCalled();
  await page.getByRole("textbox").fill("");
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByRole("button", { name: /New workspace tab/ })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByRole("button", { name: /Scratch browser/ })).toHaveFocus();
  await userEvent.keyboard("4");
  expect(execute).toHaveBeenCalledWith("scratch-browser", "");
});

it("arrow navigation skips unavailable actions instead of leaving focus behind", async () => {
  await render(
    <LauncherSurface
      design="list"
      actions={QUICK_ACTIONS}
      execute={async () => {}}
      disabled={(id) => (id === "new-agent" ? "Unavailable" : undefined)}
      preview
    />,
  );
  await page.getByRole("textbox").click();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByRole("button", { name: /New workspace tab/ })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByRole("button", { name: /Isolated agent/ })).toHaveFocus();
});

it("keypad wraps vertical navigation on a partial final page", async () => {
  await render(
    <LauncherSurface
      design="matrix"
      actions={QUICK_ACTIONS}
      execute={async () => {}}
      disabled={() => undefined}
      preview
    />,
  );
  await page.getByRole("button", { name: "More →" }).click();
  await userEvent.keyboard("{ArrowUp}");
  await expect.element(page.getByRole("button", { name: /Customize quick actions/ })).toHaveFocus();
});

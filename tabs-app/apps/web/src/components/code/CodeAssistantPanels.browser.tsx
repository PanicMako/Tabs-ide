import { useCallback, useState } from "react";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { AiProvider } from "@tabs/contracts";
import { CODE_CHROME_COMMANDS } from "@tabs/shared/codeChrome";
import { useCodeAssistantPanels } from "./useCodeAssistantPanels";

function AssistantPanels() {
  const [provider, setProvider] = useState<AiProvider>("copilot");
  const [ready, setReady] = useState(false);
  const [nativeOpen, setNativeOpen] = useState(true);
  const [tabsOpen, setTabsOpen] = useState(false);
  const runCommand = useCallback((command: string) => {
    if (command === CODE_CHROME_COMMANDS.closeAuxiliaryBar) setNativeOpen(false);
    if (command === CODE_CHROME_COMMANDS.toggleAuxiliaryBar) setNativeOpen((open) => !open);
  }, []);
  const toggle = useCodeAssistantPanels({
    provider,
    hostReady: ready,
    sideChatOpen: tabsOpen,
    setSideChatOpen: setTabsOpen,
    runCommand,
  });
  return (
    <>
      <button onClick={() => setReady(true)}>Ready</button>
      <button onClick={() => setProvider("tabs")}>Use Tabs</button>
      <button onClick={() => setProvider("copilot")}>Use Copilot</button>
      <button onClick={() => setNativeOpen(true)}>Open native extension</button>
      <button onClick={toggle}>Messages</button>
      {nativeOpen && <div>Native chat panel</div>}
      {tabsOpen && <div>Tabs chat panel</div>}
    </>
  );
}

it("closes the previous provider on preference changes, host readiness, and toolbar toggles", async () => {
  const view = await render(<AssistantPanels />);
  await page.getByRole("button", { name: "Use Tabs", exact: true }).click();
  await expect.element(page.getByText("Native chat panel", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ready", exact: true }).click();
  await expect
    .element(page.getByText("Native chat panel", { exact: true }))
    .not.toBeInTheDocument();
  await page.getByRole("button", { name: "Messages", exact: true }).click();
  await expect.element(page.getByText("Tabs chat panel", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use Copilot", exact: true }).click();
  await expect.element(page.getByText("Tabs chat panel", { exact: true })).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Messages", exact: true }).click();
  await expect.element(page.getByText("Native chat panel", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use Tabs", exact: true }).click();
  await expect
    .element(page.getByText("Native chat panel", { exact: true }))
    .not.toBeInTheDocument();
  await page.getByRole("button", { name: "Open native extension", exact: true }).click();
  await page.getByRole("button", { name: "Messages", exact: true }).click();
  await expect
    .element(page.getByText("Native chat panel", { exact: true }))
    .not.toBeInTheDocument();
  await expect.element(page.getByText("Tabs chat panel", { exact: true })).toBeVisible();
  await view.unmount();
});

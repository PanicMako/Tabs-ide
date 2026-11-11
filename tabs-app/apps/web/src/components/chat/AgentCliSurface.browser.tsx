import "../../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ThreadId } from "@tabs/contracts";
import { ThreadSurfaceSwitch } from "./ThreadSurfaceSwitch";
import { AgentCliSurface } from "./AgentCliSurface";

vi.mock("~/state/settings", async (original) => ({
  ...(await original<typeof import("~/state/settings")>()),
  useServerConfig: () => ({
    settings: { providerInstances: {}, providers: {} },
    providers: [
      {
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        displayName: "Claude",
        enabled: true,
        installed: true,
      },
      {
        instanceId: "codex",
        driver: "codex",
        displayName: "Codex",
        enabled: true,
        installed: true,
      },
    ],
  }),
}));

it("switches surfaces with clicks and arrow keys", async () => {
  const onChange = vi.fn();
  const view = await render(<ThreadSurfaceSwitch surface="chat" onChange={onChange} attention />);
  try {
    await expect
      .element(page.getByRole("radio", { name: "Chat" }))
      .toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: "CLI" }).click();
    expect(onChange).toHaveBeenLastCalledWith("cli");
    expect(document.querySelector('[data-surface="cli"][data-attention]')).not.toBeNull();
  } finally {
    await view.unmount();
  }
});

it("offers the thread's agent, other detected CLIs, a fork and a way back to chat", async () => {
  const onSwitchToChat = vi.fn();
  const view = await render(
    <div style={{ width: 900, height: 600, display: "flex" }}>
      <AgentCliSurface
        threadId={"thread-1" as ThreadId}
        environmentId={null}
        cwd="/workspace/project"
        runtimeEnv={{}}
        instanceId="claudeAgent"
        model="claude-opus-4-1"
        hasConversation
        onSwitchToChat={onSwitchToChat}
      />
    </div>,
  );
  try {
    await expect
      .element(page.getByRole("radio", { name: /Claude/ }))
      .toHaveAttribute("aria-checked", "true");
    await expect.element(page.getByRole("radio", { name: /Codex/ })).toBeVisible();
    await expect.element(page.getByRole("radio", { name: /Shell/ })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Start Claude" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Continue this conversation" }))
      .toBeVisible();

    // Another agent cannot continue a Claude conversation.
    await page.getByRole("radio", { name: /Codex/ }).click();
    await expect.element(page.getByRole("button", { name: "Start Codex" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Continue this conversation" }))
      .not.toBeInTheDocument();

    await page.getByRole("button", { name: "Back to chat" }).click();
    expect(onSwitchToChat).toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

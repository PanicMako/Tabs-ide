import "../../index.css";
import { useState } from "react";
import { CpuIcon } from "lucide-react";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ProviderDirectory, type ProviderDirectoryEntry } from "./ProviderDirectory";

const entries: ProviderDirectoryEntry[] = [
  {
    id: "codex",
    name: "Codex",
    icon: CpuIcon,
    enabled: true,
    status: "Unavailable",
    statusClass: "bg-red-500",
    modelCount: 7,
  },
  {
    id: "claude",
    name: "Claude",
    icon: CpuIcon,
    enabled: false,
    status: "Authenticated",
    statusClass: "bg-green-500",
    modelCount: 3,
  },
  {
    id: "opencode",
    name: "OpenCode",
    icon: CpuIcon,
    enabled: true,
    status: "Authenticated",
    statusClass: "bg-green-500",
    modelCount: 22,
  },
];
function Directory() {
  const [selectedId, onSelect] = useState("codex");
  return (
    <div style={{ width: 340 }}>
      <ProviderDirectory entries={entries} selectedId={selectedId} onSelect={onSelect} />
    </div>
  );
}
// Some tests need a desktop-width window; give later suites the default one back.
afterEach(async () => {
  await page.viewport(414, 896);
});

it("filters enabled providers independently of health and selects without changing enablement", async () => {
  const view = await render(<Directory />);
  try {
    const codex = page.getByRole("button", { name: "Codex Unavailable 7" });
    await expect.element(codex).toHaveAttribute("aria-current", "true");
    await page.getByRole("radio", { name: "Enabled 2" }).click();
    await expect.element(page.getByRole("button", { name: /Claude/ })).not.toBeInTheDocument();
    await expect.element(codex).toBeVisible();
    const openCode = page.getByRole("button", { name: "OpenCode Authenticated 22" });
    await openCode.click();
    await expect.element(openCode).toHaveAttribute("aria-current", "true");
    await expect.element(codex).not.toHaveAttribute("aria-current");
    await page.getByRole("textbox", { name: "Find a provider" }).fill("OPEN");
    await expect.element(codex).not.toBeInTheDocument();
    await expect.element(openCode).toBeVisible();
    await page.getByRole("textbox", { name: "Find a provider" }).fill("missing");
    // dnd-kit keeps its own live region for drag announcements.
    await expect.element(page.getByText("No matching providers.")).toBeVisible();
  } finally {
    await view.unmount();
  }
});

it("runs the setup action independently of provider selection", async () => {
  const onSelect = vi.fn();
  const onInstall = vi.fn();
  const view = await render(
    <ProviderDirectory
      entries={[
        { ...entries[0]!, status: "Not found", action: { label: "Install", onClick: onInstall } },
      ]}
      selectedId="codex"
      onSelect={onSelect}
    />,
  );
  try {
    await page.getByRole("button", { name: "Install Codex", exact: true }).click();
    expect(onInstall).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Codex Not found", exact: true }).click();
    expect(onSelect).toHaveBeenCalledWith("codex");
  } finally {
    await view.unmount();
  }
});

function ReorderableDirectory({ onReorder }: { onReorder: (ids: string[]) => void }) {
  const [order, setOrder] = useState(entries.map((entry) => entry.id));
  const [selectedId, onSelect] = useState("codex");
  const ordered = order.map((id) => entries.find((entry) => entry.id === id)!);
  return (
    <div style={{ width: 340 }}>
      <ProviderDirectory
        entries={ordered}
        selectedId={selectedId}
        onSelect={onSelect}
        onReorder={(ids) => {
          onReorder(ids);
          setOrder(ids);
        }}
        isCustomOrder={order.join() !== entries.map((entry) => entry.id).join()}
        onResetOrder={() => setOrder(entries.map((entry) => entry.id))}
      />
    </div>
  );
}

const names = () =>
  [...document.querySelectorAll(".provider-directory-name strong")].map((node) => node.textContent);

it("moves a provider with the keyboard and offers to reset the order", async () => {
  // Desktop width: the directory is a single column (narrow windows use a grid).
  await page.viewport(1200, 900);
  const onReorder = vi.fn();
  const view = await render(<ReorderableDirectory onReorder={onReorder} />);
  try {
    expect(names()).toEqual(["Codex", "Claude", "OpenCode"]);
    await expect.element(page.getByRole("button", { name: "Reset order" })).not.toBeInTheDocument();
    (page.getByRole("button", { name: "Reorder Codex" }).element() as HTMLElement).focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard(" ");
    await expect.poll(() => onReorder.mock.calls.length).toBe(1);
    expect(onReorder).toHaveBeenCalledWith(["claude", "codex", "opencode"]);
    await expect.poll(names).toEqual(["Claude", "Codex", "OpenCode"]);
    // Dropping a row never changes which provider is selected.
    await expect
      .element(page.getByRole("button", { name: "Codex Unavailable 7" }))
      .toHaveAttribute("aria-current", "true");
    await page.getByRole("button", { name: "Reset order" }).click();
    await expect.poll(names).toEqual(["Codex", "Claude", "OpenCode"]);
  } finally {
    await view.unmount();
  }
});

it("keeps hidden providers in place when reordering the Enabled list", async () => {
  await page.viewport(1200, 900);
  const onReorder = vi.fn();
  const view = await render(<ReorderableDirectory onReorder={onReorder} />);
  try {
    await page.getByRole("radio", { name: "Enabled 2" }).click();
    (page.getByRole("button", { name: "Reorder OpenCode" }).element() as HTMLElement).focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{ArrowUp}");
    await userEvent.keyboard(" ");
    await expect.poll(() => onReorder.mock.calls.length).toBe(1);
    expect(onReorder).toHaveBeenCalledWith(["opencode", "codex", "claude"]);
  } finally {
    await view.unmount();
  }
});

it("does not offer reordering while searching or without a handler", async () => {
  const view = await render(<ReorderableDirectory onReorder={vi.fn()} />);
  try {
    await expect.element(page.getByRole("button", { name: "Reorder Codex" })).toBeVisible();
    await page.getByRole("textbox", { name: "Find a provider" }).fill("o");
    await expect
      .element(page.getByRole("button", { name: "Reorder Codex" }))
      .not.toBeInTheDocument();
  } finally {
    await view.unmount();
  }
  const fixed = await render(
    <ProviderDirectory entries={entries} selectedId="codex" onSelect={() => {}} />,
  );
  try {
    await expect
      .element(page.getByRole("button", { name: "Reorder Codex" }))
      .not.toBeInTheDocument();
  } finally {
    await fixed.unmount();
  }
});

it("moves along rows and columns when narrow windows show the directory as a grid", async () => {
  await page.viewport(600, 900);
  const onReorder = vi.fn();
  const view = await render(<ReorderableDirectory onReorder={onReorder} />);
  try {
    (page.getByRole("button", { name: "Reorder Codex" }).element() as HTMLElement).focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard(" ");
    await expect.poll(() => onReorder.mock.calls.length).toBe(1);
    expect(onReorder).toHaveBeenCalledWith(["claude", "codex", "opencode"]);
  } finally {
    await view.unmount();
  }
});

import "../../index.css";
import { useState } from "react";
import { CpuIcon } from "lucide-react";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
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
    await expect.element(page.getByRole("status")).toHaveTextContent("No matching providers.");
  } finally {
    await view.unmount();
  }
});

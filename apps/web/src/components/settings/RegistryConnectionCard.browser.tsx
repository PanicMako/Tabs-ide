import "../../index.css";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { DesktopBridge } from "@tabs/contracts";
import { RegistryConnectionCard, type RegistryConnection } from "./RegistryConnectionCard";

function Harness({
  configure,
}: {
  configure: NonNullable<DesktopBridge["configureRegistryConnection"]>;
}) {
  const [open, setOpen] = useState(false);
  const [connection, setConnection] = useState<RegistryConnection>({
    origin: "https://exchange.example",
    connected: false,
    trusted: false,
  });
  return (
    <RegistryConnectionCard
      bridge={{ configureRegistryConnection: configure } as DesktopBridge}
      connection={connection}
      open={open}
      onOpenChange={setOpen}
      onConnected={setConnection}
      busy={false}
    />
  );
}
function upload(name: string, content: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
  const data = new DataTransfer();
  data.items.add(new File([content], "fixture.json", { type: "application/json" }));
  input.files = data.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
test("guided connection requires public files and explicit confirmation, then reflects native success", async () => {
  const configure = vi.fn(async () => ({
    origin: "https://exchange.example",
    connected: false,
    trusted: true,
    managed: false,
  }));
  const screen = await render(<Harness configure={configure} />);
  await screen.getByRole("button", { name: "Connect Exchange", exact: true }).click();
  const submit = screen.getByRole("button", { name: "Trust & connect" });
  await expect.element(submit).toBeDisabled();
  upload("Public root.json file", JSON.stringify({ encrypted: "private signing backup" }));
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(/not your encrypted signing backup/);
  expect(configure).not.toHaveBeenCalled();
  upload(
    "Desktop connection settings file",
    JSON.stringify({
      TABS_EXCHANGE_ORIGIN: "https://exchange.example",
      TABS_EXCHANGE_TRUST_ROOT_SHA256: "a".repeat(64),
      TABS_EXCHANGE_TRUST_ID: "registry-fixture",
    }),
  );
  upload("Public root.json file", JSON.stringify({ signed: { _type: "root" }, signatures: [] }));
  await expect.element(screen.getByLabelText("Trust fingerprint")).toHaveValue("a".repeat(64));
  await expect.element(submit).toBeDisabled();
  await screen.getByLabelText("3. Confirm this registry").fill("https://exchange.example");
  await expect.element(submit).toBeEnabled();
  await submit.click();
  await expect
    .element(screen.getByRole("heading", { name: "Connected to Exchange" }))
    .toBeVisible();
  expect(configure).toHaveBeenCalledWith(
    expect.objectContaining({
      origin: "https://exchange.example",
      confirmOrigin: "https://exchange.example",
      trustId: "registry-fixture",
    }),
  );
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
});
test("a failed native validation stays disconnected and the dialog supports Escape", async () => {
  const configure = vi.fn(async () => {
    throw new Error("Fingerprint mismatch");
  });
  const screen = await render(<Harness configure={configure} />);
  const trigger = screen.getByRole("button", { name: "Connect Exchange", exact: true });
  await trigger.click();
  upload("Public root.json file", JSON.stringify({ signed: { _type: "root" }, signatures: [] }));
  await screen.getByText("Connection details", { exact: true }).click();
  await screen.getByLabelText("Trust fingerprint").fill("b".repeat(64));
  await screen.getByLabelText("3. Confirm this registry").fill("https://exchange.example");
  await screen.getByRole("button", { name: "Trust & connect" }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Fingerprint mismatch");
  await expect.element(screen.getByRole("dialog")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(trigger).toBeVisible();
});

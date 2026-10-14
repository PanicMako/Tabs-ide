import "../../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { AppAtomRegistryProvider } from "../../state/atomRegistry";
import { UsagePriceOverrides } from "./UsagePriceOverrides";

vi.mock("../../state/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/settings")>()),
  useServerConfig: () => null,
}));

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useSettings")>()),
  useUpdateSettings: () => ({ updateSettings: save }),
}));

it("opens with the chosen model and awaits persistence before reporting success", async () => {
  let resolve: (saved: boolean) => void = () => {};
  save.mockImplementationOnce(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  const onSaved = vi.fn();
  const view = await render(
    <AppAtomRegistryProvider>
      <UsagePriceOverrides
        initialModelId="unknown-model"
        onSaved={onSaved}
        onOpenChange={() => {}}
      />
    </AppAtomRegistryProvider>,
  );
  try {
    await expect
      .element(page.getByRole("combobox", { name: "New model ID" }))
      .toHaveValue("unknown-model");
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    await page.getByRole("textbox", { name: "Input price for unknown-model" }).fill("2");
    await page.getByRole("textbox", { name: "Output price for unknown-model" }).fill("6");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    expect(onSaved).not.toHaveBeenCalled();
    resolve(true);
    await expect.element(page.getByText("Saved", { exact: true })).toBeVisible();
    expect(onSaved).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith({
      usagePriceOverrides: {
        "unknown-model": { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 6 },
      },
    });
  } finally {
    await view.unmount();
    save.mockReset();
  }
});
it("retains the draft and offers a retry when the server rejects the prices", async () => {
  save.mockResolvedValueOnce(false);
  const onSaved = vi.fn();
  const view = await render(
    <AppAtomRegistryProvider>
      <UsagePriceOverrides
        initialModelId="unknown-model"
        onSaved={onSaved}
        onOpenChange={() => {}}
      />
    </AppAtomRegistryProvider>,
  );
  try {
    await page.getByRole("textbox", { name: "Input price for unknown-model" }).fill("0");
    await page.getByRole("textbox", { name: "Output price for unknown-model" }).fill("0");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Retry failed saves", exact: true }))
      .toBeVisible();
    expect(onSaved).not.toHaveBeenCalled();
    await expect
      .element(page.getByRole("textbox", { name: "Input price for unknown-model" }))
      .toHaveValue("0");
  } finally {
    await view.unmount();
    save.mockReset();
  }
});

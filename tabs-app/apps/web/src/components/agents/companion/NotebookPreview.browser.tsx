import "../../../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { NotebookPreview } from "./NotebookPreview";

const notebook = JSON.stringify({
  cells: [
    { cell_type: "markdown", source: ["Some notes"] },
    {
      cell_type: "code",
      source: "print('hi')",
      execution_count: 2,
      outputs: [{ output_type: "stream", text: ["hi\n"] }],
    },
  ],
});

it("shows prose, code, the run number and the saved output", async () => {
  const view = await render(<NotebookPreview text={notebook} />);
  try {
    await expect.element(page.getByText("Some notes")).toBeVisible();
    await expect.element(page.getByText("print('hi')")).toBeVisible();
    await expect.element(page.getByText("[2]")).toBeVisible();
    await expect.element(page.getByText("hi", { exact: true })).toBeVisible();
  } finally {
    await view.unmount();
  }
});

it("points to Source when the file is not a notebook", async () => {
  const view = await render(<NotebookPreview text="not json" />);
  try {
    await expect.element(page.getByText(/not a notebook Tabs can read/)).toBeVisible();
  } finally {
    await view.unmount();
  }
});

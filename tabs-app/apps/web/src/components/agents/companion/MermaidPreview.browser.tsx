import "../../../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { MermaidPreview } from "./MermaidPreview";

it("draws a flowchart as an image", async () => {
  const view = await render(
    <MermaidPreview text={"graph TD\n  A[Start] --> B[Finish]"} dark={false} />,
  );
  try {
    await expect.element(page.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
    expect(view.container.querySelector("svg")).not.toBeNull();
    expect(view.container.textContent).toContain("Start");
  } finally {
    await view.unmount();
  }
});

it("explains a diagram it cannot draw and points to Source", async () => {
  const view = await render(<MermaidPreview text="this is not a diagram" dark={false} />);
  try {
    await expect.element(page.getByRole("alert")).toBeVisible();
    await expect.element(page.getByText(/Switch to Source/)).toBeVisible();
  } finally {
    await view.unmount();
  }
});

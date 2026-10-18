// @vitest-environment happy-dom
import { expect, it } from "vitest";

it("previews a namespace as text and restores the example when cleared", async () => {
  document.body.innerHTML =
    '<input id="new-namespace"><output id="namespace-example-name">your-name</output>';
  await import("../frontend/src/scripts/publisher-setup");
  const input = document.querySelector<HTMLInputElement>("input")!;
  const output = document.querySelector("output")!;
  input.value = " My-Studio ";
  input.dispatchEvent(new Event("input"));
  expect(output.textContent).toBe("my-studio");
  input.dispatchEvent(new Event("blur"));
  expect(input.value).toBe("my-studio");
  input.value = "<img src=x>";
  input.dispatchEvent(new Event("input"));
  expect(output.children.length).toBe(0);
  expect(output.textContent).toBe("<img src=x>");
  input.value = "";
  input.dispatchEvent(new Event("input"));
  expect(output.textContent).toBe("your-name");
});

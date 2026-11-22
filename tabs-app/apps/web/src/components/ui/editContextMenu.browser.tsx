import { expect, it } from "vitest";
import { isEditableTarget } from "../../lib/editContextMenu";

it("recognises editable targets", () => {
  const input = document.createElement("input");
  expect(isEditableTarget(input)).toBe(true);
  input.readOnly = true;
  expect(isEditableTarget(input)).toBe(false);
  expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
  expect(isEditableTarget(document.createElement("div"))).toBe(false);
});

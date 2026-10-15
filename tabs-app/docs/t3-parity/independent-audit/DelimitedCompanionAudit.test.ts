import { it, expect } from "vite-plus/test";
import { parseDelimitedPreview as shared } from "./delimitedPreview.ts";
import { parseDelimitedPreview as companion } from "../../../apps/web/src/components/agents/companion/filePreview.ts";
it("preserves the last quoted empty CSV row in the actual companion parser", () => {
  const input = 'name\nAlice\n""';
  expect(shared(input, ",").rows).toEqual([["name"], ["Alice"], [""]]);
  expect(companion(input, ",").rows).toEqual([["name"], ["Alice"], [""]]);
});

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const { writeWindowsPackedInventory } = require("./windows-packed-inventory.cjs") as {
  writeWindowsPackedInventory: (runtimeDirectory: string) => number;
};

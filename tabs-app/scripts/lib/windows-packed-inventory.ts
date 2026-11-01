import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const { writeWindowsPackedInventory, verifyWindowsStagedRuntime } =
  require("./windows-packed-inventory.cjs") as {
    writeWindowsPackedInventory: (runtimeDirectory: string) => number;
    verifyWindowsStagedRuntime: (appDirectory: string) => number;
  };

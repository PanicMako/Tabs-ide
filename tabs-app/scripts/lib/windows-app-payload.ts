import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const {
  WINDOWS_APP_FILE_EXCLUSIONS,
  excludedWindowsAppFile,
  assertWindowsAppArchiveLean,
  trimWindowsAppArchive,
} = require("./windows-app-payload.cjs") as {
  WINDOWS_APP_FILE_EXCLUSIONS: string[];
  excludedWindowsAppFile: (filename: string) => boolean;
  assertWindowsAppArchiveLean: (filename: string) => void;
  trimWindowsAppArchive: (filename: string) => number;
};

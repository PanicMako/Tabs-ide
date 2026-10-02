#!/usr/bin/env bun
import { packTabsext, inspectTabsext, validateTabsextDirectory } from "./index.ts";
import { createExtensionStarter } from "./starter.ts";

const args = process.argv.slice(2);
const command = args[0];
const source = args[1];
const destination = command === "pack" ? args[2] : undefined;
const option = command === "pack" ? args[3] : args[2];
const version = command === "pack" ? args[4] : args[3];
if (command === "init") {
  try {
    if (!source || args.length !== 4 || !args[2] || !args[3]) {
      throw new Error("Usage: tabsext init <new-directory> <publisher> <name>");
    }
    createExtensionStarter(source, args[2], args[3]);
    process.stdout.write(
      `Created ${source}. Edit dist/index.html, then load the folder in Tabs desktop development mode.\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
} else if (
  !source ||
  option !== "--tabs-version" ||
  !version ||
  (command !== "pack" && command !== "inspect" && command !== "validate") ||
  (command === "pack" && (!destination || args.length !== 5)) ||
  ((command === "inspect" || command === "validate") && args.length !== 4)
) {
  process.stderr.write(
    "Usage: tabsext pack <directory> <output.tabsext> --tabs-version <version>\n" +
      "       tabsext init <new-directory> <publisher> <name>\n" +
      "       tabsext inspect <archive.tabsext> --tabs-version <version>\n" +
      "       tabsext validate <directory> --tabs-version <version>\n",
  );
  process.exitCode = 2;
} else {
  try {
    const result =
      command === "pack"
        ? await packTabsext({ directory: source, destination: destination!, tabsVersion: version })
        : command === "validate"
          ? validateTabsextDirectory(source, version)
          : await inspectTabsext(source, version);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

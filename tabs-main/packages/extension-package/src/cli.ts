#!/usr/bin/env bun
import { packTabsext, inspectTabsext } from "./index.ts";

const args = process.argv.slice(2);
const command = args[0];
const source = args[1];
const destination = command === "pack" ? args[2] : undefined;
const option = command === "pack" ? args[3] : args[2];
const version = command === "pack" ? args[4] : args[3];
if (
  !source ||
  option !== "--tabs-version" ||
  !version ||
  (command !== "pack" && command !== "inspect") ||
  (command === "pack" && (!destination || args.length !== 5)) ||
  (command === "inspect" && args.length !== 4)
) {
  process.stderr.write(
    "Usage: tabsext pack <directory> <output.tabsext> --tabs-version <version>\n" +
      "       tabsext inspect <archive.tabsext> --tabs-version <version>\n",
  );
  process.exitCode = 2;
} else {
  try {
    const result =
      command === "pack"
        ? await packTabsext({ directory: source, destination: destination!, tabsVersion: version })
        : await inspectTabsext(source, version);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

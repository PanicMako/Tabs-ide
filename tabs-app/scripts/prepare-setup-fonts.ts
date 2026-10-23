import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultDirectory = fileURLToPath(new URL("../apps/web/public/fonts/setup/", import.meta.url));

// Fonts are supplied locally with the appropriate embedding licenses.
export async function prepareSetupFonts(directory = defaultDirectory): Promise<void> {
  for (const [name, signature] of [
    ["KS-Bistra.otf", "OTTO"],
    ["AICON-SemiBold.otf", "OTTO"],
    ["Pavot-BoldItalic.otf", "OTTO"],
    ["ZTOtez-Regular.otf", "OTTO"],
    ["Pavot-Bold.otf", "OTTO"],
    ["ZTOtez-Italic.otf", "OTTO"],
  ] as const) {
    const path = resolve(directory, name);
    const bytes = await readFile(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      throw new Error(
        `Missing setup font ${name}. Supply the requested font locally; see ${directory}/README.md.`,
      );
    });
    if (bytes.length < 12 || bytes.subarray(0, 4).toString("latin1") !== signature) {
      throw new Error(`Invalid setup font ${name}; expected an original font file.`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareSetupFonts();
}

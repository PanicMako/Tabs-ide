import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { prepareSetupFonts } from "./prepare-setup-fonts";

const directories: string[] = [];
async function target() {
  const directory = await mkdtemp(join(tmpdir(), "tabs-setup-font-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("accepts all bundled font files without network access", async () => {
  const directory = await target();
  await writeFile(join(directory, "KS-Bistra.otf"), "OTTOtest-font-fixture");
  await writeFile(join(directory, "AICON-SemiBold.otf"), "OTTOtest-font-fixture");
  await writeFile(join(directory, "Pavot-BoldItalic.otf"), "OTTOtest-font-fixture");
  await writeFile(join(directory, "ZTOtez-Regular.otf"), "OTTOtest-font-fixture");
  await writeFile(join(directory, "Pavot-Bold.otf"), "OTTOtest-font-fixture");
  await writeFile(join(directory, "ZTOtez-Italic.otf"), "OTTOtest-font-fixture");
  await expect(prepareSetupFonts(directory)).resolves.toBeUndefined();
});

it("reports the exact missing font instead of substituting another family", async () => {
  const directory = await target();
  await expect(prepareSetupFonts(directory)).rejects.toThrow("Missing setup font KS-Bistra.otf");
  await writeFile(join(directory, "KS-Bistra.otf"), "OTTOtest-font-fixture");
  await expect(prepareSetupFonts(directory)).rejects.toThrow(
    "Missing setup font AICON-SemiBold.otf",
  );
});

it("rejects an HTML download response instead of treating it as a font", async () => {
  const directory = await target();
  await writeFile(join(directory, "KS-Bistra.otf"), "<html>bad response</html>");
  await expect(prepareSetupFonts(directory)).rejects.toThrow("Invalid setup font KS-Bistra.otf");
});

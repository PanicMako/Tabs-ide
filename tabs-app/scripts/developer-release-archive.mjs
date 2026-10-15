import * as FS from "node:fs";
import * as Path from "node:path";

export function preserveDeveloperReleases(source, destination) {
  if (!FS.existsSync(source)) return;
  for (const entry of FS.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === "manifest.json") continue;
    if (!entry.isDirectory() || !/^\d+\.\d+\.\d+-[a-f0-9]{16}$/.test(entry.name))
      throw new Error("Unexpected developer release archive entry.");
    const target = Path.join(destination, entry.name);
    FS.mkdirSync(target, { recursive: true });
    if (!FS.lstatSync(target).isDirectory())
      throw new Error("Invalid developer release destination.");
    for (const file of FS.readdirSync(Path.join(source, entry.name), { withFileTypes: true })) {
      if (
        !file.isFile() ||
        !/^(?:tabs-extension-(?:api|cli)-\d+\.\d+\.\d+\.tgz|tabs-developer-bundle\.tar\.gz|release\.json|README\.md|SHA256SUMS)$/.test(
          file.name,
        )
      )
        throw new Error("Unexpected developer release asset.");
      const path = Path.join(source, entry.name, file.name);
      if (FS.statSync(path).size > 32 * 1024 * 1024)
        throw new Error("Developer release asset exceeds its limit.");
      const bytes = FS.readFileSync(path);
      const output = Path.join(target, file.name);
      try {
        FS.writeFileSync(output, bytes, { flag: "wx" });
      } catch (error) {
        if (
          error.code !== "EEXIST" ||
          !FS.lstatSync(output).isFile() ||
          !FS.readFileSync(output).equals(bytes)
        )
          throw new Error("Immutable developer release collision.");
      }
    }
  }
}

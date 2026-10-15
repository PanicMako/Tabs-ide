import * as FS from "node:fs";
import * as Path from "node:path";

export function targetVersion(explicit?: string, directory = process.cwd()): string {
  let version: unknown = explicit;
  if (!version) {
    const config = Path.join(directory, ".tabsext.json");
    if (FS.existsSync(config)) {
      if (FS.statSync(config).size > 4096) throw new Error(".tabsext.json exceeds 4 KiB.");
      version = JSON.parse(FS.readFileSync(config, "utf8")).tabsVersion;
    }
  }
  if (
    typeof version !== "string" ||
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      version,
    )
  )
    throw new Error(
      "Choose your desktop testing version with --tabs-version <version>, or run init with that option to record it in .tabsext.json.",
    );
  return version;
}

const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
export function humanOutput(command: string, result: unknown): string {
  const lines = [`Tabs extension ${clean(command)}`];
  function render(value: unknown, prefix: string, depth: number) {
    if (depth > 6) {
      lines.push(`${prefix}(use --json for full details)`);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 30)) render(entry, `${prefix}- `, depth + 1);
      if (value.length > 30) lines.push(`${prefix}... ${value.length - 30} more; use --json.`);
    } else if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        if (entry && typeof entry === "object") {
          lines.push(`${prefix}${clean(key)}:`);
          render(entry, `${prefix}  `, depth + 1);
        } else lines.push(`${prefix}${clean(key)}: ${clean(String(entry ?? "not available"))}`);
      }
    } else lines.push(`${prefix}${clean(String(value ?? "not available"))}`);
  }
  render(result, "", 0);
  return `${lines.join("\n")}\n`;
}

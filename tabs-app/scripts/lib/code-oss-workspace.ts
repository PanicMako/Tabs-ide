import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The project folders of the Code-OSS root pnpm workspace
 * (`tabs-code-oss/pnpm-workspace.yaml`), relative to the checkout, with `/`.
 */
export function readCodeOssWorkspaceMembers(sourceRoot: string): string[] {
  const manifest = path.join(sourceRoot, "pnpm-workspace.yaml");
  if (!fs.existsSync(manifest)) return [];
  const members: string[] = [];
  let inPackages = false;
  for (const line of fs.readFileSync(manifest, "utf8").split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s+-\s+['"]?([^'"#\s]+)['"]?\s*$/.exec(line);
    if (item) {
      members.push(item[1]!.replace(/\/+$/, ""));
    } else if (/^\S/.test(line)) {
      break;
    }
  }
  return members;
}

/**
 * Returns a copy filter that leaves out the `node_modules` of workspace members.
 * With pnpm's isolated linker they only hold links into the root virtual store
 * (development tools such as Playwright). Once the root is relaid out hoisted
 * those links dangle, and Windows cannot copy a dangling junction. With the
 * hoisted linker, which Code-OSS used before 1.148, the folders did not exist.
 */
export function createWorkspaceMemberModulesFilter(
  sourceRoot: string,
  members = readCodeOssWorkspaceMembers(sourceRoot),
): (entry: string) => boolean {
  const root = path.resolve(sourceRoot);
  const excluded = new Set(members.map((member) => `${member}/node_modules`));
  return (entry) => {
    const relative = path.relative(root, path.resolve(entry)).split(path.sep).join("/");
    return !excluded.has(relative);
  };
}

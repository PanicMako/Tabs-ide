import { constants as FS_CONSTANTS } from "node:fs";
import * as FS from "node:fs/promises";
import * as Path from "node:path";

const MAX_RELATIVE_PATH = 240;
const MAX_CONTENT_BYTES = 1024 * 1024;

/** The project root comes from the server read model, never from extension input. */
export async function readExtensionWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<string> {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    relativePath.length > MAX_RELATIVE_PATH ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    Path.isAbsolute(relativePath) ||
    relativePath.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Invalid relative workspace path.");
  }
  const root = await FS.realpath(workspaceRoot);
  if (!(await FS.stat(root)).isDirectory()) throw new Error("Project root is not a directory.");
  const requested = Path.resolve(root, ...relativePath.split("/"));
  const canonical = await FS.realpath(requested);
  if (!canonical.startsWith(`${root}${Path.sep}`)) {
    throw new Error("Workspace path escapes the project root.");
  }
  const handle = await FS.open(canonical, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_CONTENT_BYTES) {
      throw new Error("Workspace file is unavailable or too large.");
    }
    const bytes = Buffer.alloc(MAX_CONTENT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > MAX_CONTENT_BYTES) throw new Error("Workspace file is too large.");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
  } finally {
    await handle.close();
  }
}

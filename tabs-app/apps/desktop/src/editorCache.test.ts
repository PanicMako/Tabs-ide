import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLegacyEditorCaches } from "./editorCache";

const roots: string[] = [];
async function profile() {
  const root = await mkdtemp(Path.join(OS.tmpdir(), "tabs-editor-cache-"));
  roots.push(root);
  // macOS /var is a symlink; the production profile path is canonical.
  const { realpath } = await import("node:fs/promises");
  return realpath(root);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("editor cache migration", () => {
  it("clears only editor caches, preserving browser partitions and saved state", async () => {
    const root = await profile();
    const partition = Path.join(root, "Partitions", "tabs-code-host%3Aproject");
    await mkdir(Path.join(partition, "IndexedDB"), { recursive: true });
    const state = Path.join(partition, "IndexedDB", "state");
    await writeFile(state, "saved editor state");
    for (const name of [
      "tabs-browser%3Aproject",
      "tabs-extension%3Aone",
      "tabs-code-host%ZZ",
      "tabs-code-host%3A..%2Fother",
    ]) {
      await mkdir(Path.join(root, "Partitions", name));
    }
    const editorSession = {
      clearCache: vi.fn(async () => {}),
      clearCodeCaches: vi.fn(async () => {}),
    };
    const fromPartition = vi.fn(() => editorSession);
    const warn = vi.fn();
    await clearLegacyEditorCaches(root, fromPartition, warn);
    expect(fromPartition).toHaveBeenCalledExactlyOnceWith("persist:tabs-code-host:project", {
      cache: false,
    });
    expect(editorSession.clearCache).toHaveBeenCalledOnce();
    expect(editorSession.clearCodeCaches).toHaveBeenCalledExactlyOnceWith({ urls: [] });
    expect(await readFile(state, "utf8")).toBe("saved editor state");
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not follow symlinked partitions or partition directories", async () => {
    const root = await profile();
    const outside = await profile();
    await mkdir(Path.join(root, "Partitions"));
    await symlink(outside, Path.join(root, "Partitions", "tabs-code-host%3Aexternal"), "dir");
    const fromPartition = vi.fn();
    await clearLegacyEditorCaches(root, fromPartition, vi.fn());
    await symlink(Path.join(root, "Partitions"), Path.join(outside, "Partitions"), "dir");
    await clearLegacyEditorCaches(outside, fromPartition, vi.fn());
    expect(fromPartition).not.toHaveBeenCalled();
  });

  it("tolerates a new profile and continues when a cache cannot be cleared", async () => {
    const root = await profile();
    const fromPartition = vi.fn(() => ({
      clearCache: vi.fn(async () => {
        throw new Error("cache unavailable");
      }),
      clearCodeCaches: vi.fn(async () => {}),
    }));
    const warn = vi.fn();
    await clearLegacyEditorCaches(root, fromPartition, warn);
    expect(fromPartition).not.toHaveBeenCalled();
    for (const name of ["first", "second"]) {
      await mkdir(Path.join(root, "Partitions", `tabs-code-host%3A${name}`), { recursive: true });
    }
    await clearLegacyEditorCaches(root, fromPartition, warn);
    expect(fromPartition).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
    for (const result of fromPartition.mock.results) {
      expect(result.value.clearCodeCaches).toHaveBeenCalledOnce();
    }
  });
});

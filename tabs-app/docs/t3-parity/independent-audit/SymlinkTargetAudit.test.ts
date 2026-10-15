import { expect, it } from "vitest";
import * as Fs from "node:fs/promises";
import * as Os from "node:os";
import * as Path from "node:path";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { resolveSymlinkTarget } from "./symlink.ts";
it("resolves relative link targets through a symlinked parent and preserves dangling target", async () => {
  const dir = await Fs.mkdtemp(Path.join(Os.tmpdir(), "tabs-symlink-audit-"));
  try {
    await Fs.mkdir(Path.join(dir, "real"));
    await Fs.symlink("real", Path.join(dir, "alias"));
    await Fs.symlink("../missing", Path.join(dir, "real", "link"));
    const actual = await Effect.runPromise(
      resolveSymlinkTarget(Path.join(dir, "alias", "link")).pipe(
        Effect.provide(NodeServices.layer),
      ),
    );
    expect(actual).toBe(Path.join(await Fs.realpath(dir), "missing"));
  } finally {
    await Fs.rm(dir, { recursive: true, force: true });
  }
});
it("fails cyclic links rather than returning a rename target", async () => {
  const dir = await Fs.mkdtemp(Path.join(Os.tmpdir(), "tabs-symlink-cycle-"));
  try {
    await Fs.symlink("b", Path.join(dir, "a"));
    await Fs.symlink("a", Path.join(dir, "b"));
    const exit = await Effect.runPromiseExit(
      resolveSymlinkTarget(Path.join(dir, "a")).pipe(Effect.provide(NodeServices.layer)),
    );
    expect(exit._tag).toBe("Failure");
  } finally {
    await Fs.rm(dir, { recursive: true, force: true });
  }
});

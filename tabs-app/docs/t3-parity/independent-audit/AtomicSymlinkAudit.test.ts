import { expect, it } from "vitest";
import * as Fs from "node:fs/promises";
import * as Os from "node:os";
import * as Path from "node:path";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { writeFileStringAtomically } from "./atomicWrite.ts";
it("preserves the link and updates its destination", async () => {
  const dir = await Fs.mkdtemp(Path.join(Os.tmpdir(), "tabs-atomic-control-"));
  try {
    const dest = Path.join(dir, "destination"),
      link = Path.join(dir, "link");
    await Fs.writeFile(dest, "before");
    await Fs.symlink(dest, link);
    await Effect.runPromise(
      writeFileStringAtomically({ filePath: link, contents: "after" }).pipe(
        Effect.provide(NodeServices.layer),
      ),
    );
    expect({
      isLink: (await Fs.lstat(link)).isSymbolicLink(),
      destination: await Fs.readFile(dest, "utf8"),
      linkContents: await Fs.readFile(link, "utf8"),
    }).toEqual({ isLink: true, destination: "after", linkContents: "after" });
  } finally {
    await Fs.rm(dir, { recursive: true, force: true });
  }
});

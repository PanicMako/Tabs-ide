// Adapted from Orca (MIT, (c) 2026 Lovecast Inc.) — src/main/bots/bot-home.ts
import type { TeammateId } from "@tabs/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ServerConfig from "../config.ts";
import { starterSoul } from "./teammateText.ts";

const SOUL_FILE = "SOUL.md";
const MEMORY_FILE = "MEMORY.md";

/** A teammate's home folder under the server state dir: SOUL.md, MEMORY.md, memory/, skills/. */
export class TeammateHome extends Context.Service<
  TeammateHome,
  {
    readonly homeDir: (id: TeammateId) => string;
    /** Creates the folder and seeds SOUL.md when missing. Never overwrites an existing soul. */
    readonly ensure: (input: {
      readonly id: TeammateId;
      readonly name: string;
      readonly soul?: string | undefined;
    }) => Effect.Effect<string>;
    /** null when the file is missing or unreadable. */
    readonly readSoul: (id: TeammateId) => Effect.Effect<string | null>;
    readonly writeSoul: (id: TeammateId, soul: string) => Effect.Effect<void, unknown>;
    readonly readMemory: (id: TeammateId) => Effect.Effect<string | null>;
    readonly writeMemory: (id: TeammateId, memory: string) => Effect.Effect<void, unknown>;
    /** Removes the whole folder. */
    readonly remove: (id: TeammateId) => Effect.Effect<void>;
    /** Whether the default teammate was ever created (or the user removed all of them). */
    readonly defaultSeeded: Effect.Effect<boolean>;
    /** Records that the default teammate must never be re-created on its own. */
    readonly markDefaultSeeded: Effect.Effect<void>;
  }
>()("tabs/teammates/TeammateHome") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const root = path.join(config.stateDir, "teammates");
  const homeDir = (id: TeammateId) => path.join(root, id);

  const readText = (file: string) =>
    fs.readFileString(file).pipe(Effect.orElseSucceed((): string | null => null));

  const ensure: TeammateHome["Service"]["ensure"] = (input) =>
    Effect.gen(function* () {
      const dir = homeDir(input.id);
      yield* fs.makeDirectory(path.join(dir, "memory"), { recursive: true });
      yield* fs.makeDirectory(path.join(dir, "skills"), { recursive: true });
      const soulPath = path.join(dir, SOUL_FILE);
      if (!(yield* fs.exists(soulPath))) {
        const seeded =
          input.soul !== undefined && input.soul.trim() !== ""
            ? input.soul
            : starterSoul(input.name);
        yield* writeFileStringAtomically({ filePath: soulPath, contents: seeded });
      }
      const memoryPath = path.join(dir, MEMORY_FILE);
      if (!(yield* fs.exists(memoryPath))) {
        yield* writeFileStringAtomically({ filePath: memoryPath, contents: "" });
      }
      return dir;
    }).pipe(Effect.provideContext(context), Effect.orDie);

  const seededMarker = path.join(root, ".default-seeded");

  return TeammateHome.of({
    homeDir,
    defaultSeeded: fs.exists(seededMarker).pipe(Effect.orElseSucceed(() => false)),
    markDefaultSeeded: Effect.gen(function* () {
      yield* fs.makeDirectory(root, { recursive: true });
      yield* writeFileStringAtomically({ filePath: seededMarker, contents: "1\n" });
    }).pipe(Effect.provideContext(context), Effect.ignore({ log: true })),
    ensure,
    readSoul: (id) => readText(path.join(homeDir(id), SOUL_FILE)),
    writeSoul: (id, soul) =>
      writeFileStringAtomically({
        filePath: path.join(homeDir(id), SOUL_FILE),
        contents: soul,
      }).pipe(Effect.provideContext(context)),
    readMemory: (id) => readText(path.join(homeDir(id), MEMORY_FILE)),
    writeMemory: (id, memory) =>
      writeFileStringAtomically({
        filePath: path.join(homeDir(id), MEMORY_FILE),
        contents: memory,
      }).pipe(Effect.provideContext(context)),
    remove: (id) =>
      fs.remove(homeDir(id), { recursive: true, force: true }).pipe(Effect.ignore({ log: true })),
  });
});

export const layer = Layer.effect(TeammateHome, make);

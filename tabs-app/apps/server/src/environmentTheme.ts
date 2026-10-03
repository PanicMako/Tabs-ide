import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { EnvironmentThemeFile, EnvironmentThemeId, type EnvironmentTheme } from "@tabs/contracts";
import { Context, Effect, Equal, Exit, Layer, PubSub, Ref, Schema, Stream } from "effect";

import { ServerConfig } from "./config.ts";

const MAX_FILES = 32;
const MAX_FILE_BYTES = 32 * 1024;
const MAX_TOTAL_BYTES = 192 * 1024;
const decodeFile = Schema.decodeUnknownExit(Schema.fromJsonString(EnvironmentThemeFile));
const validId = Schema.is(EnvironmentThemeId);

export function readPublishedThemes(directory: string): ReadonlyArray<EnvironmentTheme> {
  let entries: string[];
  try {
    entries = NodeFS.readdirSync(directory).toSorted();
  } catch {
    return [];
  }
  const themes: EnvironmentTheme[] = [];
  let examined = 0;
  let totalBytes = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -5);
    if (!validId(id) || ++examined > MAX_FILES) continue;
    const filePath = NodePath.join(directory, entry);
    let descriptor: number | undefined;
    try {
      descriptor = NodeFS.openSync(
        filePath,
        NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW | NodeFS.constants.O_NONBLOCK,
      );
      const stat = NodeFS.fstatSync(descriptor);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES || totalBytes + stat.size > MAX_TOTAL_BYTES)
        continue;
      const raw = NodeFS.readFileSync(descriptor, "utf8");
      const decoded = decodeFile(raw);
      if (Exit.isFailure(decoded)) continue;
      const file = decoded.value;
      const hasSeeds = file.canvas !== undefined && file.accent !== undefined;
      const hasColors = file.colors !== undefined && Object.keys(file.colors).length > 0;
      if (!hasSeeds && !hasColors) continue;
      totalBytes += stat.size;
      themes.push({ id, ...file });
    } catch {
      continue;
    } finally {
      if (descriptor !== undefined) NodeFS.closeSync(descriptor);
    }
  }
  return themes;
}

export class EnvironmentThemeService extends Context.Service<
  EnvironmentThemeService,
  {
    readonly current: Effect.Effect<ReadonlyArray<EnvironmentTheme>>;
    readonly streamChanges: Stream.Stream<ReadonlyArray<EnvironmentTheme>>;
  }
>()("tabs/environmentTheme/EnvironmentThemeService") {}

const make = Effect.gen(function* () {
  const { environmentThemesDir } = yield* ServerConfig;
  NodeFS.mkdirSync(environmentThemesDir, { recursive: true });
  const initial = readPublishedThemes(environmentThemesDir);
  const state = yield* Ref.make(initial);
  const changes = yield* PubSub.sliding<ReadonlyArray<EnvironmentTheme>>(1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = Effect.sync(() => readPublishedThemes(environmentThemesDir)).pipe(
    Effect.flatMap((next) =>
      Ref.modify(state, (previous) => [!Equal.equals(previous, next), next] as const).pipe(
        Effect.flatMap((changed) =>
          changed ? PubSub.publish(changes, next).pipe(Effect.asVoid) : Effect.void,
        ),
      ),
    ),
  );
  const watcher = NodeFS.watch(environmentThemesDir, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => Effect.runFork(refresh), 100);
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (timer) clearTimeout(timer);
      watcher.close();
    }),
  );
  return {
    current: Ref.get(state),
    streamChanges: Stream.concat(Stream.fromEffect(Ref.get(state)), Stream.fromPubSub(changes)),
  };
});

export const layer = Layer.effect(EnvironmentThemeService, make);

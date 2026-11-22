import type { TeammateId, ThreadId } from "@tabs/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { TeammateHome } from "./TeammateHome.ts";
import { TeammateStore } from "./TeammateStore.ts";
import { buildTeammatePreamble } from "./teammateText.ts";

/**
 * What the provider turn path asks about a teammate thread. A Reference with a no-op default so
 * the orchestration layers (and their tests) work without teammates; the server provides the
 * live implementation.
 */
export interface TeammateTurnHooksShape {
  /**
   * Text to put in front of the user's message for this turn: the preamble on a thread's first
   * turn on a native provider thread, a "SOUL.md changed" notice afterwards, "" for any thread
   * that is not a teammate's home or look-around thread.
   */
  readonly prefaceFor: (input: {
    readonly threadId: ThreadId;
    readonly firstNativeTurn: boolean;
  }) => Effect.Effect<string>;
}

export class TeammateTurnHooks extends Context.Reference<TeammateTurnHooksShape>(
  "tabs/teammates/TeammateTurnHooks",
  { defaultValue: () => ({ prefaceFor: () => Effect.succeed("") }) },
) {}

/**
 * Soul edits waiting to reach a chat whose provider thread is already running. In memory: a
 * restarted server resends the preamble to any provider thread it has to start again.
 */
const pendingSoulNotices = new Map<TeammateId, string>();

export function queueSoulNotice(teammateId: TeammateId, notice: string): void {
  pendingSoulNotices.set(teammateId, notice);
}

const STARTER_LINE = /Describe .+ here: what it is for, how it talks, and what it must never do\./;

/** True while SOUL.md is still the starter template, which is how a teammate knows it is new. */
export const isStarterSoul = (soul: string | null): boolean =>
  soul === null || soul.trim() === "" || STARTER_LINE.test(soul);

const make = Effect.gen(function* () {
  const store = yield* TeammateStore;
  const home = yield* TeammateHome;

  const prefaceFor: TeammateTurnHooksShape["prefaceFor"] = ({ threadId, firstNativeTurn }) =>
    Effect.gen(function* () {
      const link = yield* store.getThreadLink(threadId);
      if (link === null || link.kind === "worker") return "";
      const teammate = yield* store.getTeammate(link.teammateId);
      if (teammate === null) return "";
      if (!firstNativeTurn) {
        const notice = pendingSoulNotices.get(teammate.id);
        if (notice === undefined) return "";
        pendingSoulNotices.delete(teammate.id);
        return notice;
      }
      // A fresh provider thread reads the files as they are now, so an older notice is stale.
      pendingSoulNotices.delete(teammate.id);
      const [soul, memory] = yield* Effect.all([
        home.readSoul(teammate.id),
        home.readMemory(teammate.id),
      ]);
      return buildTeammatePreamble({
        name: teammate.name,
        soul,
        memory,
        homeDir: home.homeDir(teammate.id),
        projectName: null,
        firstRun: link.kind === "home" && isStarterSoul(soul),
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Teammate preface failed; sending the message without it", {
          threadId,
          cause,
        }).pipe(Effect.as("")),
      ),
    );

  return { prefaceFor } satisfies TeammateTurnHooksShape;
});

export const layer = Layer.effect(TeammateTurnHooks, make);

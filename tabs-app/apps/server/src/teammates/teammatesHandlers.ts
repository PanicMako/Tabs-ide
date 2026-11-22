import { TeammatesRpcGroup } from "@tabs/contracts";
import * as Effect from "effect/Effect";

import { TeammateService } from "./TeammateService.ts";

/** WebSocket handlers for the `teammates.*` RPCs. */
export const makeTeammatesHandlers = Effect.gen(function* () {
  const teammates = yield* TeammateService;
  return TeammatesRpcGroup.of({
    "teammates.list": () => teammates.snapshot,
    "teammates.subscribe": () => teammates.subscribe,
    "teammates.create": (input) =>
      teammates.create(input).pipe(Effect.map((teammate) => ({ teammate }))),
    "teammates.update": (input) =>
      teammates.update(input).pipe(Effect.map((teammate) => ({ teammate }))),
    "teammates.delete": (input) => teammates.delete(input.id),
    "teammates.openHome": (input) => teammates.openHome(input.id),
    "teammates.items.update": (input) =>
      teammates.updateItem(input).pipe(Effect.map((item) => ({ item }))),
    "teammates.suggestions.start": (input) => teammates.startSuggestion(input.id),
    "teammates.suggestions.dismiss": (input) =>
      teammates.dismissSuggestion(input.id).pipe(Effect.map((suggestion) => ({ suggestion }))),
    "teammates.memory.list": (input) =>
      teammates.listFacts(input.teammateId).pipe(Effect.map((facts) => ({ facts }))),
    "teammates.memory.forget": (input) =>
      teammates.forgetFact(input.id).pipe(Effect.as({ id: input.id })),
    "teammates.lookAroundNow": (input) => teammates.lookAroundNow(input.id),
    "teammates.soul.get": (input) =>
      teammates.getSoul(input.id).pipe(Effect.map((soul) => ({ id: input.id, soul }))),
    "teammates.soul.set": (input) =>
      teammates.setSoul(input.id, input.soul).pipe(Effect.map((soul) => ({ id: input.id, soul }))),
  });
});

import { TEAMMATE_SOUL_MAX_LENGTH, TeammateError, TeammatesRpcGroup } from "@tabs/contracts";
import * as Effect from "effect/Effect";

import * as ServerSettings from "../serverSettings";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { TeammateService } from "./TeammateService.ts";

/** WebSocket handlers for the `teammates.*` RPCs. */
export const makeTeammatesHandlers = Effect.gen(function* () {
  const teammates = yield* TeammateService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
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
    "teammates.profile.generate": (input) =>
      Effect.gen(function* () {
        const settings = yield* serverSettings.getSettings;
        const modelSelection = input.modelSelection ?? settings.textGenerationModelSelection;
        if (modelSelection === null || modelSelection === undefined) {
          return yield* Effect.fail(
            new TeammateError({
              message:
                "No writing model is set. Pick a model for this teammate, or set one in Settings.",
            }),
          );
        }
        const generate = textGeneration.generateTeammateProfile;
        if (generate === undefined) {
          return yield* Effect.fail(
            new TeammateError({ message: "The writing model cannot draft teammates." }),
          );
        }
        const generated = yield* generate({
          cwd: process.cwd(),
          name: input.name,
          purpose: input.purpose,
          modelSelection,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new TeammateError({
                message: cause.detail ?? "The writing model could not draft this teammate.",
                cause,
              }),
          ),
        );
        return {
          soul: generated.soul.slice(0, TEAMMATE_SOUL_MAX_LENGTH),
          focus: generated.focus.slice(0, 2_000),
        };
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof TeammateError
            ? cause
            : new TeammateError({ message: "Could not read settings.", cause }),
        ),
      ),
    "teammates.soul.set": (input) =>
      teammates.setSoul(input.id, input.soul).pipe(Effect.map((soul) => ({ id: input.id, soul }))),
  });
});

import { BrowserWorkflowResultError, PartnerCenterConnection } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ServerSecretStore } from "../../../auth/ServerSecretStore.ts";

const secretName = "partner-center-connection";
const unavailable = () =>
  new BrowserWorkflowResultError({
    message: "The Partner Center connection could not be read or saved.",
  });

export const readPartnerCenterConnection = Effect.gen(function* () {
  const store = yield* ServerSecretStore;
  const bytes = yield* store.get(secretName).pipe(Effect.mapError(unavailable));
  if (Option.isNone(bytes)) return undefined;
  return yield* Effect.try({
    try: () =>
      Schema.decodeUnknownSync(PartnerCenterConnection)(
        JSON.parse(new TextDecoder().decode(bytes.value)),
      ),
    catch: unavailable,
  });
});

export const writePartnerCenterConnection = (connection: PartnerCenterConnection | null) =>
  Effect.flatMap(ServerSecretStore, (store) =>
    (connection === null
      ? store.remove(secretName)
      : store.set(secretName, new TextEncoder().encode(JSON.stringify(connection)))
    ).pipe(Effect.mapError(unavailable)),
  );

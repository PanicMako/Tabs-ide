import * as Context from "effect/Context";
import { Effect, Layer, Option } from "effect";
import type { SourceControlProviderAuth } from "@tabs/contracts";

export interface BitbucketApiShape {
  readonly probeAuth: () => Effect.Effect<SourceControlProviderAuth, never>;
}

export class BitbucketApi extends Context.Service<BitbucketApi, BitbucketApiShape>()(
  "tabs/sourceControl/BitbucketApi",
) {}

const makeBitbucketApi = Effect.sync(() => {
  const probeAuth: BitbucketApiShape["probeAuth"] = () => {
    const accessToken = process.env.T3CODE_BITBUCKET_ACCESS_TOKEN;
    const email = process.env.T3CODE_BITBUCKET_EMAIL;
    const apiToken = process.env.T3CODE_BITBUCKET_API_TOKEN;

    if (accessToken) {
      return Effect.succeed({
        status: "unknown" as const,
        account: Option.none(),
        host: Option.some("bitbucket.org"),
        detail: Option.some("Bitbucket access token is configured."),
      });
    }

    if (email && apiToken) {
      return Effect.succeed({
        status: "unknown" as const,
        account: Option.some(email),
        host: Option.some("bitbucket.org"),
        detail: Option.some("Bitbucket API token is configured."),
      });
    }

    return Effect.succeed({
      status: "unauthenticated" as const,
      account: Option.none(),
      host: Option.some("bitbucket.org"),
      detail: Option.some(
        "Set T3CODE_BITBUCKET_EMAIL and T3CODE_BITBUCKET_API_TOKEN, or T3CODE_BITBUCKET_ACCESS_TOKEN.",
      ),
    });
  };

  return {
    probeAuth,
  } satisfies BitbucketApiShape;
});

export const BitbucketApiLive = Layer.effect(BitbucketApi, makeBitbucketApi);

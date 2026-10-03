import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { resolveProjectAutoPull } from "@tabs/shared/serverSettings";
import { normalizeProjectPathForComparison } from "@tabs/shared/path";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

export interface VcsAutoPullPolicyShape {
  readonly isEnabled: (cwd: string) => Effect.Effect<boolean, never>;
}

export class VcsAutoPullPolicy extends Context.Reference<VcsAutoPullPolicyShape>(
  "tabs/git/VcsAutoPullPolicy",
  {
    defaultValue: () => ({
      isEnabled: () => Effect.succeed(false),
    }),
  },
) {}

export const autoPullPolicyLayer = Layer.effect(
  VcsAutoPullPolicy,
  Effect.gen(function* () {
    const snapshotQuery = yield* ProjectionSnapshotQuery;
    const serverSettings = yield* ServerSettingsService;
    return {
      isEnabled: Effect.fn("VcsAutoPullPolicy.isEnabled")(
        function* (cwd: string) {
          const snapshot = yield* snapshotQuery.getSnapshot();
          const normalizedCwd = normalizeProjectPathForComparison(cwd);
          const project = snapshot.projects.find(
            (p) =>
              p.deletedAt === null &&
              normalizeProjectPathForComparison(p.workspaceRoot) === normalizedCwd,
          );
          if (!project) return false;
          const settings = yield* serverSettings.getSettings;
          return resolveProjectAutoPull(settings, project.id, project.autoPull);
        },
        Effect.orElseSucceed(() => false),
      ),
    };
  }),
);

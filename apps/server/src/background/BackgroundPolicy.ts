import type {
  AuthSessionId,
  BackgroundPolicySnapshot,
  BackgroundScope,
  ClientActivityLease,
  ClientActivityReportInput,
  HostPowerSnapshot,
  RpcClientId,
} from "@tabs/contracts";
import { resolveServerBackgroundActivitySettings } from "@tabs/shared/backgroundActivitySettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { ServerSettingsService } from "../serverSettings.ts";

const DEFAULT_LEASE_TTL_MS = 45_000;
const MAX_LEASE_TTL_MS = 120_000;
export const MAX_CLIENT_ACTIVITY_LEASES_PER_RPC_CLIENT = 16;

export class BackgroundPolicy extends Context.Service<
  BackgroundPolicy,
  {
    readonly reportClientActivity: (
      sessionId: AuthSessionId,
      rpcClientId: RpcClientId,
      input: ClientActivityReportInput,
    ) => Effect.Effect<void>;
    readonly removeRpcClient: (
      sessionId: AuthSessionId,
      rpcClientId: RpcClientId,
    ) => Effect.Effect<void>;
    readonly reportHostPowerState: (snapshot: HostPowerSnapshot) => Effect.Effect<void>;
    readonly snapshot: Effect.Effect<BackgroundPolicySnapshot>;
    readonly streamChanges: Stream.Stream<BackgroundPolicySnapshot>;
    readonly hasDemand: (scope: BackgroundScope) => Effect.Effect<boolean>;
    readonly shouldRunScopeWork: (scope: BackgroundScope) => Effect.Effect<boolean>;
    readonly shouldRunOpportunisticWork: Effect.Effect<boolean>;
  }
>()("tabs/background/BackgroundPolicy") {}

function scopeKey(scope: BackgroundScope): string {
  if (scope.type === "provider-status")
    return scope.instanceId ? `${scope.type}:${scope.instanceId}` : scope.type;
  if (scope.type === "vcs-status" || scope.type === "git-refs") return `${scope.type}:${scope.cwd}`;
  if (scope.type === "thread") return `${scope.type}:${scope.threadId}`;
  return scope.type;
}

function leaseKey(sessionId: AuthSessionId, rpcClientId: RpcClientId, clientId: string) {
  return `${sessionId}\0${rpcClientId}\0${clientId}`;
}

function upsertClientActivityLease(
  leases: ReadonlyMap<string, ClientActivityLease>,
  lease: ClientActivityLease,
  now: DateTime.Utc,
): Map<string, ClientActivityLease> {
  const next = new Map(leases);
  const key = leaseKey(lease.sessionId, lease.rpcClientId, lease.clientId);
  if (!next.has(key)) {
    let connectionLeaseCount = 0;
    let oldestConnectionLease:
      | {
          readonly key: string;
          readonly updatedAtMs: number;
        }
      | undefined;
    for (const [currentKey, current] of next) {
      if (current.sessionId !== lease.sessionId || current.rpcClientId !== lease.rpcClientId) {
        continue;
      }
      connectionLeaseCount += 1;
      const updatedAtMs = DateTime.toEpochMillis(current.updatedAt);
      if (oldestConnectionLease === undefined || updatedAtMs < oldestConnectionLease.updatedAtMs) {
        oldestConnectionLease = { key: currentKey, updatedAtMs };
      }
    }
    if (
      connectionLeaseCount >= MAX_CLIENT_ACTIVITY_LEASES_PER_RPC_CLIENT &&
      oldestConnectionLease !== undefined
    ) {
      next.delete(oldestConnectionLease.key);
    }
  }

  next.set(key, lease);
  return next;
}

function constrainedHost(
  power: HostPowerSnapshot,
  settings: ReturnType<typeof resolveServerBackgroundActivitySettings>,
): boolean {
  if (power.stale) return false;
  if (power.suspended || power.thermalState === "serious" || power.thermalState === "critical")
    return true;
  if (settings.pauseWhenHostLocked && power.locked === "true") return true;
  if (settings.pauseWhenHostLowPower && power.lowPowerMode === "true") return true;
  return settings.pauseWhenOnBattery && power.onBattery === "true";
}

export const make = Effect.gen(function* () {
  const serverSettings = yield* ServerSettingsService;
  const now = yield* DateTime.now;
  const hostPower = yield* Ref.make<HostPowerSnapshot>({
    source: "unknown",
    idle: "unknown",
    idleSeconds: null,
    locked: "unknown",
    suspended: false,
    onBattery: "unknown",
    lowPowerMode: "unknown",
    thermalState: "unknown",
    stale: true,
    updatedAt: now,
  });
  const leases = yield* Ref.make(new Map<string, ClientActivityLease>());
  const changes = yield* PubSub.sliding<BackgroundPolicySnapshot>(1);
  const publishMutex = yield* Semaphore.make(1);
  const readSettings = serverSettings.getSettings.pipe(
    Effect.orDie,
    Effect.map(resolveServerBackgroundActivitySettings),
  );

  const snapshot = Effect.gen(function* () {
    const currentTime = yield* DateTime.now;
    const settings = yield* readSettings;
    const power = yield* Ref.get(hostPower);
    const all = yield* Ref.get(leases);
    const active = [...all.values()].filter((lease) =>
      DateTime.isGreaterThan(lease.expiresAt, currentTime),
    );
    const foreground = active.filter(
      (lease) => lease.visible && (lease.focused || lease.recentlyInteracted),
    );
    const keys = new Set(active.flatMap((lease) => lease.scopes.map(scopeKey)));
    const clientMayRun = (lease: ClientActivityLease) =>
      !(settings.pauseWhenClientLowPower && lease.lowPowerMode === "true") &&
      !(settings.pauseWhenOnBattery && lease.batteryState === "unplugged");
    return {
      hostPower: power,
      leases: active,
      activeForegroundLeaseCount: foreground.length,
      activeScopeKeys: [...keys].sort(),
      shouldRunOpportunisticWork:
        !constrainedHost(power, settings) && foreground.some(clientMayRun),
      updatedAt: currentTime,
    } satisfies BackgroundPolicySnapshot;
  });
  const publishUnlocked = snapshot.pipe(
    Effect.flatMap((value) => PubSub.publish(changes, value)),
    Effect.asVoid,
  );
  const publish = publishMutex.withPermits(1)(publishUnlocked);

  const reportClientActivity = (
    sessionId: AuthSessionId,
    rpcClientId: RpcClientId,
    input: ClientActivityReportInput,
  ) =>
    publishMutex.withPermits(1)(
      Effect.gen(function* () {
        const updatedAt = yield* DateTime.now;
        const ttlMs = Math.min(
          MAX_LEASE_TTL_MS,
          Math.max(1_000, input.ttlMs ?? DEFAULT_LEASE_TTL_MS),
        );
        const expiresAt = DateTime.add(updatedAt, { milliseconds: ttlMs });
        const lease: ClientActivityLease = {
          sessionId,
          rpcClientId,
          clientId: input.clientId,
          clientKind: input.clientKind,
          visible: input.visible,
          focused: input.focused,
          recentlyInteracted: input.recentlyInteracted,
          ...(input.appState === undefined ? {} : { appState: input.appState }),
          ...(input.lowPowerMode === undefined ? {} : { lowPowerMode: input.lowPowerMode }),
          ...(input.batteryState === undefined ? {} : { batteryState: input.batteryState }),
          ...(input.networkType === undefined ? {} : { networkType: input.networkType }),
          scopes: input.scopes,
          updatedAt,
          expiresAt,
        };
        yield* Ref.update(leases, (current) =>
          upsertClientActivityLease(current, lease, updatedAt),
        );
        yield* publishUnlocked;
      }),
    );

  const shouldRunScopeWork = (scope: BackgroundScope) =>
    Effect.gen(function* () {
      const state = yield* snapshot;
      const settings = yield* readSettings;
      if (constrainedHost(state.hostPower, settings)) return false;
      return state.leases.some(
        (lease) =>
          lease.scopes.some((candidate) => scopeKey(candidate) === scopeKey(scope)) &&
          !(settings.pauseWhenClientLowPower && lease.lowPowerMode === "true") &&
          !(settings.pauseWhenOnBattery && lease.batteryState === "unplugged") &&
          (settings.profile === "performance" ||
            (lease.visible && (lease.focused || lease.recentlyInteracted))),
      );
    });

  yield* Effect.forever(
    Effect.sleep("15 seconds").pipe(
      Effect.andThen(
        publishMutex.withPermits(1)(
          Effect.gen(function* () {
            const currentTime = yield* DateTime.now;
            yield* Ref.update(leases, (current) => {
              const next = new Map(current);
              for (const [key, lease] of next) {
                if (DateTime.isLessThanOrEqualTo(lease.expiresAt, currentTime)) {
                  next.delete(key);
                }
              }
              return next;
            });
            yield* publishUnlocked;
          }),
        ),
      ),
    ),
  ).pipe(Effect.forkScoped);

  return BackgroundPolicy.of({
    reportClientActivity,
    removeRpcClient: (sessionId, rpcClientId) =>
      publishMutex.withPermits(1)(
        Ref.update(
          leases,
          (current) =>
            new Map(
              [...current].filter(
                ([, lease]) => lease.sessionId !== sessionId || lease.rpcClientId !== rpcClientId,
              ),
            ),
        ).pipe(Effect.andThen(publishUnlocked)),
      ),
    reportHostPowerState: (value) =>
      publishMutex.withPermits(1)(Ref.set(hostPower, value).pipe(Effect.andThen(publishUnlocked))),
    snapshot,
    streamChanges: Stream.fromPubSub(changes),
    hasDemand: (scope) =>
      snapshot.pipe(Effect.map((state) => state.activeScopeKeys.includes(scopeKey(scope)))),
    shouldRunScopeWork,
    shouldRunOpportunisticWork: snapshot.pipe(
      Effect.map((state) => state.shouldRunOpportunisticWork),
    ),
  });
});

export const layer = Layer.effect(BackgroundPolicy, make);

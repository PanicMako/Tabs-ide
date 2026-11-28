import { createHash, randomUUID } from "node:crypto";
import type {
  NativeComputerCommand,
  NativeComputerState,
  NativeWindowChoice,
  NativeWindowGrant,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import {
  DEFAULT_MAX_NODES,
  type AppComputerRequest,
  type AttachedAppSelector,
  type ComputerRequest,
  type NativeActionGuard,
  type Target,
} from "./commands.ts";
import { ComputerUseError } from "./ComputerUseError.ts";
import type { RuntimeSnapshot, RuntimeSuccess } from "./runtimeResponse.ts";
import { parseComputerTreeText } from "./treeText.ts";

type Invoke = (
  request: ComputerRequest,
  signal?: AbortSignal,
) => Effect.Effect<RuntimeSuccess, ComputerUseError>;

type Grant = {
  view: NativeWindowGrant;
  controller: AbortController;
  activity?: NativeComputerState["activity"];
  continuationId?: string;
  observation?: { snapshot: RuntimeSnapshot; maxNodes: number };
  handoff?: {
    baseline?: HandoffObservation;
    returned?: { stateHash: string; message: string; changedControls: readonly number[] };
    meaning?: string;
  };
};

type HandoffObservation = {
  stateHash: string;
  layoutHash: string | undefined;
  controlHashes: ReadonlyMap<string, string>;
  maxNodes: number;
};

const fail = (code: string, message: string) => new ComputerUseError({ code, message });
const paused = () =>
  fail(
    "user_turn",
    "The user has control or window access changed. After control returns, observe the current state before retrying any action.",
  );
const stale = () =>
  fail("stale_observation", "Take a fresh computer_snapshot of the attached window before acting.");

const hashText = (text: string) => createHash("sha256").update(text).digest("hex");

function windowStateHash(snapshot: RuntimeSnapshot) {
  return hashText(
    JSON.stringify([snapshot.treeText, snapshot.elements, snapshot.focusedElementIndex]),
  );
}

// Retain fingerprints of the rendered controls. The fresh snapshot is the only
// source of control labels and values that the agent sees during handoff.
function controlHashes(snapshot: RuntimeSnapshot) {
  const fingerprints = new Map<string, { index: number; hash: string }>();
  const ambiguous = new Set<string>();
  for (const { index, lines } of parseComputerTreeText(snapshot.treeText).elements) {
    const token = snapshot.elements?.[index - 1];
    if (!token) continue;
    const key = hashText(token);
    if (fingerprints.has(key)) ambiguous.add(key);
    const [first, ...rest] = lines;
    const hash = hashText([first?.replace(/^\s*\d+ /u, ""), ...rest].join("\n"));
    fingerprints.set(key, { index, hash });
  }
  for (const key of ambiguous) fingerprints.delete(key);
  return fingerprints;
}

function describeHandoff(baseline: HandoffObservation | undefined, snapshot: RuntimeSnapshot) {
  const stateHash = windowStateHash(snapshot);
  const layoutHash = windowLayoutHash(snapshot);
  const layout = baseline?.layoutHash && layoutHash && baseline.layoutHash !== layoutHash;
  const changed = baseline !== undefined && stateHash !== baseline.stateHash;
  const message = !baseline
    ? "No starting observation was available for the user handoff."
    : layout
      ? "The accessible layout changed while the user had control."
      : changed
        ? "The observable window state changed while the user had control."
        : "The last accessibility observation and the current one match.";
  return {
    stateHash,
    message,
    changedControls:
      baseline && changed
        ? [...controlHashes(snapshot)]
            .filter(([key, { hash }]) => baseline.controlHashes.get(key) !== hash)
            .map(([, { index }]) => index)
        : [],
  };
}

function windowLayoutHash(snapshot: RuntimeSnapshot) {
  return snapshot.elements && hashText(JSON.stringify(snapshot.elements));
}

function referencedIndexes(request: ComputerRequest): number[] {
  const targets: Target[] =
    request.op === "drag"
      ? [request.from, request.to]
      : "target" in request
        ? [request.target]
        : [];
  return [
    ...targets.flatMap((target) => (target.kind === "element" ? [target.index] : [])),
    ...("elementIndex" in request && request.elementIndex !== undefined
      ? [request.elementIndex]
      : []),
    ...(request.op === "snapshot" && request.rootElementIndex !== undefined
      ? [request.rootElementIndex]
      : []),
  ];
}

function requiresObservation(request: ComputerRequest): boolean {
  if (request.op === "snapshot") return request.rootElementIndex !== undefined;
  return request.op !== "focusApp";
}

export class NativeWindows {
  private readonly grants = new Map<string, Grant>();
  private readonly pendingAttachments = new Map<string, symbol>();

  constructor(
    private readonly invoke: Invoke,
    private readonly gate: Semaphore.Semaphore,
  ) {}

  private state(threadId: string): NativeComputerState {
    const grant = this.grants.get(threadId);
    return { grant: grant?.view ?? null, ...(grant?.activity ? { activity: grant.activity } : {}) };
  }

  private assertAvailable(threadId: string, window: NativeWindowChoice, foreground: boolean) {
    for (const [owner, { view }] of this.grants) {
      if (owner === threadId) continue;
      if (view.window.id === window.id)
        return fail("window_busy", "This window is already attached to another thread.");
      if (foreground && view.foreground && view.mode === "agent")
        return fail(
          "pointer_busy",
          "Another thread has physical input. Take back or revoke its access first.",
        );
    }
    return undefined;
  }

  control(input: NativeComputerCommand): Effect.Effect<NativeComputerState, ComputerUseError> {
    const { threadId, op } = input;
    return Effect.gen({ self: this }, function* () {
      const existing = this.grants.get(threadId);
      if (op === "status") return this.state(threadId);
      if (
        (op === "take" || op === "revoke") &&
        input.selector !== undefined &&
        existing?.view.selector !== input.selector
      )
        return yield* fail("window_stale", "The attached window changed before this action.");
      if (op === "revoke") yield* this.revokeThread(threadId);
      if (op === "take") {
        this.pendingAttachments.delete(threadId);
        if (!existing)
          return yield* this.gate.withPermits(1)(Effect.sync(() => this.state(threadId)));
        existing.controller.abort();
        const captureBefore = existing.view.mode === "agent";
        const maxNodes = existing.observation?.maxNodes ?? DEFAULT_MAX_NODES;
        if (captureBefore) existing.handoff = {};
        delete existing.activity;
        delete existing.observation;
        delete existing.continuationId;
        const controller = new AbortController();
        existing.controller = controller;
        existing.view = { ...existing.view, mode: "user", takeoverId: randomUUID() };

        // Cancel input before waiting for the gate. Capture only once the packet has released it.
        return yield* this.gate.withPermits(1)(
          Effect.gen({ self: this }, function* () {
            const current = () =>
              this.grants.get(threadId) === existing && existing.controller === controller;
            if (captureBefore && current()) {
              const windowId = existing.view.window.id;
              const observed = yield* this.observeHandoff(
                windowId,
                maxNodes,
                controller.signal,
              ).pipe(
                Effect.timeout("1500 millis"),
                Effect.catch(() => Effect.succeed(undefined)),
              );
              const snapshot = observed?.snapshot;
              if (current() && snapshot?.window.key === windowId) {
                existing.handoff = {
                  baseline: {
                    layoutHash: windowLayoutHash(snapshot),
                    stateHash: windowStateHash(snapshot),
                    controlHashes: new Map(
                      [...controlHashes(snapshot)].map(([key, { hash }]) => [key, hash]),
                    ),
                    maxNodes,
                  },
                };
              }
            }
            return this.state(threadId);
          }),
        );
      }
      if (op === "revoke") {
        return yield* this.gate.withPermits(1)(Effect.sync(() => this.state(threadId)));
      }
      if (op === "reveal") {
        return yield* this.gate.withPermits(1)(
          Effect.gen({ self: this }, function* () {
            if (
              !existing ||
              this.grants.get(threadId) !== existing ||
              existing.view.selector !== input.selector
            )
              return yield* fail(
                "window_stale",
                "This window attachment has expired. Select the window again.",
              );
            yield* this.invoke({
              op: "focusApp",
              app: { kind: "window", id: existing.view.window.id },
            });
            return this.state(threadId);
          }),
        );
      }
      if (op === "resume") {
        return yield* this.resume(input, existing);
      }

      const pending = Symbol();
      if (op === "attach") this.pendingAttachments.set(threadId, pending);
      return yield* this.gate
        .withPermits(1)(
          Effect.gen({ self: this }, function* () {
            const listed = yield* this.invoke({ op: "listWindows" });
            const windows = listed.windows ?? [];
            const capabilities = listed.permissions?.capabilities;
            if (op === "list")
              return {
                ...this.state(threadId),
                windows,
                ...(capabilities ? { capabilities } : {}),
              };
            if (
              this.pendingAttachments.get(threadId) !== pending ||
              this.grants.get(threadId) !== existing ||
              existing?.view.mode === "user"
            )
              return yield* paused();
            const window = windows.find(({ id }) => id === input.windowId);
            if (!window)
              return yield* fail(
                "window_stale",
                "This window has closed or changed identity. Refresh the list.",
              );
            if (input.foreground && !capabilities?.foregroundInput)
              return yield* fail(
                "background_unavailable",
                "Physical input is unavailable in this desktop session.",
              );
            const error = this.assertAvailable(threadId, window, input.foreground);
            if (error) return yield* error;
            existing?.controller.abort();
            this.grants.set(threadId, {
              view: {
                window,
                selector: `window:${randomUUID()}`,
                foreground: input.foreground,
                mode: "agent",
              },
              controller: new AbortController(),
            });
            return this.state(threadId);
          }),
        )
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (this.pendingAttachments.get(threadId) === pending)
                this.pendingAttachments.delete(threadId);
            }),
          ),
        );
    });
  }

  private observeHandoff(windowId: string, maxNodes: number, signal: AbortSignal) {
    return this.invoke(
      {
        op: "snapshot",
        app: { kind: "window", id: windowId },
        maxNodes,
        native: { foreground: false },
      },
      signal,
    );
  }

  private resume(input: Extract<NativeComputerCommand, { op: "resume" }>, grant?: Grant) {
    const { threadId, selector, takeoverId } = input;
    const staleHandoff = () =>
      fail("window_stale", "The attached window or its control changed before control returned.");
    const matchesGeneration = () =>
      grant !== undefined &&
      this.grants.get(threadId) === grant &&
      grant.view.selector === selector &&
      grant.view.takeoverId === takeoverId;
    const matchesTakeover = () => matchesGeneration() && grant?.view.mode === "user";
    const resume = Effect.gen({ self: this }, function* () {
      if (selector !== undefined && grant?.view.selector !== selector) return yield* staleHandoff();
      if (takeoverId !== undefined && !matchesGeneration()) return yield* staleHandoff();
      if (!grant || grant.view.mode === "agent") {
        const continuationId = takeoverId !== undefined ? grant?.continuationId : undefined;
        return { ...this.state(threadId), ...(continuationId ? { continuationId } : {}) };
      }

      const meaning = input.meaning?.trim();
      let continuationId: string | undefined;
      let returned: NonNullable<Grant["handoff"]>["returned"];
      if (takeoverId !== undefined) {
        const baseline = grant.handoff?.baseline;
        const windowId = grant.view.window.id;
        const { snapshot } = yield* this.observeHandoff(
          windowId,
          baseline?.maxNodes ?? DEFAULT_MAX_NODES,
          grant.controller.signal,
        ).pipe(
          Effect.mapError((error) =>
            matchesTakeover()
              ? fail(error.code, "Could not verify the attached window before returning control.")
              : staleHandoff(),
          ),
        );
        if (!matchesTakeover() || snapshot?.window.key !== windowId) return yield* staleHandoff();
        returned = describeHandoff(baseline, snapshot);
        if ((baseline && baseline.stateHash !== returned.stateHash) || meaning)
          continuationId = randomUUID();
      }

      const error = this.assertAvailable(threadId, grant.view.window, grant.view.foreground);
      if (error) return yield* error;
      if (returned) grant.handoff = { ...(meaning ? { meaning } : {}), returned };
      else if (meaning) grant.handoff = { ...grant.handoff, meaning };
      // Only a new agent snapshot may authorize actions after the handoff.
      grant.controller.abort();
      grant.controller = new AbortController();
      grant.view = { ...grant.view, mode: "agent" };
      if (continuationId) grant.continuationId = continuationId;
      return { ...this.state(threadId), ...(continuationId ? { continuationId } : {}) };
    });
    return takeoverId === undefined ? resume : this.gate.withPermits(1)(resume);
  }

  revokeThread(threadId: string) {
    return Effect.sync(() => {
      this.pendingAttachments.delete(threadId);
      this.grants.get(threadId)?.controller.abort();
      this.grants.delete(threadId);
    });
  }

  revokeAll() {
    return Effect.sync(() => {
      this.pendingAttachments.clear();
      for (const grant of this.grants.values()) grant.controller.abort();
      this.grants.clear();
    });
  }

  signal(threadId: string) {
    return this.grants.get(threadId)?.controller.signal;
  }

  get(threadId: string) {
    return this.grants.get(threadId)?.view;
  }

  run(
    request: AppComputerRequest & { app: AttachedAppSelector },
    threadId: string,
    observationId?: string,
    reportHandoff = false,
  ) {
    return Effect.gen({ self: this }, function* () {
      const grant = this.grants.get(threadId);
      if (!grant || grant.view.selector !== request.app.selector)
        return yield* fail(
          "window_grant_required",
          "Attach this window in the thread’s Desktop window menu and use its selector from computer_list_apps.",
        );
      if (grant.view.mode === "user") return yield* paused();
      const signal = grant.controller.signal;
      return yield* this.gate.withPermits(1)(
        Effect.gen({ self: this }, function* () {
          if (signal.aborted) return yield* paused();
          const observation = grant.observation?.snapshot;
          const indexes = referencedIndexes(request);
          const needed = requiresObservation(request);
          if (needed && (!observation || observation.id !== observationId)) return yield* stale();
          const foreground = "foreground" in request && request.foreground === true;
          if (foreground && !grant.view.foreground)
            return yield* fail(
              "foreground_denied",
              "The user granted accessibility control only. Ask them to allow physical input in the Desktop window menu.",
            );
          if (request.op === "focusApp")
            return yield* fail(
              "foreground_denied",
              "Ask the user to bring the attached window to the front.",
            );
          const elements: Record<string, string> = {};
          const observedElements = observation?.elements ?? [];
          for (const index of indexes) {
            const token = observedElements[index - 1];
            if (!token || observedElements.indexOf(token) !== observedElements.lastIndexOf(token))
              return yield* fail(
                "stale_observation",
                "This element has no unique native reference. Take a fresh snapshot or use a supported point action.",
              );
            elements[index] = token;
          }
          const usesFocus =
            request.op === "key" || (request.op === "type" && request.elementIndex === undefined);
          const focusedIndex = observation?.focusedElementIndex;
          const focused =
            usesFocus && focusedIndex ? observedElements[focusedIndex - 1] : undefined;
          if (
            usesFocus &&
            (!focused ||
              observedElements.indexOf(focused) !== observedElements.lastIndexOf(focused))
          )
            return yield* stale();
          const guard: NativeActionGuard = {
            foreground,
            ...(needed && observation
              ? {
                  frame: observation.window.frame,
                  ...(observation.display === undefined ? {} : { display: observation.display }),
                  ...(observation.scale === undefined ? {} : { scale: observation.scale }),
                }
              : {}),
            ...(indexes.length > 0 ? { elements } : {}),
            ...(focused ? { focused } : {}),
          };
          const mutates =
            request.op !== "snapshot" &&
            request.op !== "screenshot" &&
            request.op !== "windowFrame";
          const windowId = grant.view.window.id;
          const response = yield* Effect.suspend(() => {
            if (mutates || grant.activity !== "needs_foreground")
              grant.activity = foreground ? "checking_foreground" : "background";
            return this.invoke(
              { ...request, app: { kind: "window", id: windowId }, native: guard },
              signal,
            );
          }).pipe(
            Effect.flatMap((result) =>
              result.snapshot && result.snapshot.window.key !== windowId
                ? fail(
                    "window_stale",
                    "The runtime could not confirm the selected window. Attach it again.",
                  )
                : Effect.succeed(result),
            ),
            Effect.onExit((exit) =>
              Effect.sync(() => {
                // Takeover, revocation and replacement abort this dispatch's control generation.
                if (signal.aborted) return;
                const code = Option.getOrUndefined(Exit.findErrorOption(exit))?.code;
                // Input may have landed before an error or interruption.
                if (
                  mutates ||
                  code === "window_stale" ||
                  code === "stale_observation" ||
                  code === "element_not_found" ||
                  code === "focus_changed"
                )
                  delete grant.observation;
                if (Exit.isFailure(exit)) {
                  if (foreground && code === "focus_changed") grant.activity = "needs_foreground";
                  else delete grant.activity;
                } else if (foreground) {
                  const delivery = exit.value.action?.delivery;
                  if (delivery === "foreground" || delivery === "background")
                    grant.activity = delivery;
                  else delete grant.activity;
                }
              }),
            ),
            Effect.mapError((error) => (signal.aborted ? paused() : error)),
          );
          if (signal.aborted) return yield* paused();
          const full =
            response.snapshot &&
            !(request.op === "snapshot" && request.rootElementIndex !== undefined);
          if (full && response.snapshot) {
            // A new opaque observation ID prevents two runtimes' millisecond IDs from colliding.
            const snapshot = { ...response.snapshot, id: randomUUID() };
            grant.observation = {
              snapshot,
              maxNodes: "maxNodes" in request ? request.maxNodes : DEFAULT_MAX_NODES,
            };
            const handoff = reportHandoff && request.op === "snapshot" ? grant.handoff : undefined;
            if (!handoff) return { ...response, snapshot };
            // The previous turn can still be active when the continuation is queued.
            // Keep the last correction available until the next takeover or revocation.
            const returned = handoff.returned ?? describeHandoff(handoff.baseline, snapshot);
            const stillMatches = returned.stateHash === windowStateHash(snapshot);
            const controls = returned.changedControls.slice(0, 8);
            const message = [
              returned.message,
              !stillMatches
                ? "The window changed again after control returned. Use the current snapshot."
                : controls.length > 0
                  ? `New or changed current controls include ${controls.join(", ")}.`
                  : "",
            ]
              .filter(Boolean)
              .join(" ");
            return {
              ...response,
              snapshot,
              handoff: message,
              ...(handoff.meaning ? { userDemonstration: handoff.meaning } : {}),
            };
          }
          return request.op === "snapshot" && response.snapshot && observation
            ? { ...response, snapshot: { ...response.snapshot, id: observation.id } }
            : response;
        }),
      );
    });
  }
}

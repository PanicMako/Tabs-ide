import type {
  NativeApi,
  NativeComputerCommand,
  NativeComputerState,
  NativeWindowChoice,
} from "@tabs/contracts";
import { AppWindowIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { Button } from "~/components/ui/button";
import { showCustomConfirm } from "~/lib/customConfirm";
import {
  NATIVE_WINDOW_ATTACH_REQUEST_EVENT,
  NATIVE_WINDOW_UPDATED_EVENT,
  writeNativeWindowDrag,
  type NativeWindowUpdate,
} from "~/lib/nativeWindowHandoff";
import { AGENT_HANDOFF_LABELS } from "~/lib/agentHandoffLabels";
import { publishPhysicalInput } from "~/lib/agentPhysicalInputStore";
import { queueThreadContinuation } from "~/lib/queueThreadContinuation";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";

import {
  nativeWindowAttachmentFile,
  requireSurfaceAttachmentSlot,
  writeSurfaceDrag,
  type SurfaceLocation,
} from "~/lib/threadSurfaceAttachment";

type NativeComputer = NativeApi["server"]["nativeComputer"];
type Operation = NativeComputerCommand["op"];
const STATUS_REFRESH_MS = 1_000;

function agentControlLabel(activity: NativeComputerState["activity"], activeAgentTurn: boolean) {
  if (activity === "needs_foreground") {
    return "Agent has control. Bring this window to the front for physical input.";
  }
  if (activeAgentTurn) {
    if (activity === "checking_foreground") return "Agent is checking if this window is in front";
    if (activity === "foreground") return "Agent used physical input";
  }
  return "Agent has control";
}

function windowLabel(window: NativeWindowChoice) {
  const { x, y, width, height } = window.frame;
  const geometry =
    width > 0
      ? ` · ${Math.round(width)}×${Math.round(height)} at ${Math.round(x)}, ${Math.round(y)}`
      : "";
  return `${window.app} · PID ${window.pid}${geometry}`;
}

function windowDescription(window: NativeWindowChoice, windows?: readonly NativeWindowChoice[]) {
  const label = windowLabel(window);
  const duplicate = windows?.some(
    (other) =>
      other.id !== window.id && other.title === window.title && windowLabel(other) === label,
  );
  return duplicate ? `${label} · ${window.id}` : label;
}

export function NativeWindowAccess({
  enabled,
  location,
  isActivePane = true,
  activeAgentTurn = false,
  request,
  prepareThread,
  attachToDraft,
}: {
  enabled: boolean;
  location: SurfaceLocation;
  isActivePane?: boolean;
  activeAgentTurn?: boolean;
  request: NativeComputer;
  prepareThread?: () => Promise<unknown>;
  attachToDraft: (file: File) => void;
}) {
  const { threadId } = location;
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const clearDrag = useRef<() => void>(undefined);
  const [state, setState] = useState<NativeComputerState>({ grant: null });
  const [selection, setSelection] = useState<string>();
  const [physical, setPhysical] = useState(false);
  const [meaning, setMeaning] = useState("");
  const [busy, setBusy] = useState<Operation>();
  const [error, setError] = useState("");
  const group = useId();
  const revisions = useRef({ request: 0, control: 0 });
  const wasRefreshing = useRef(false);
  const { capabilities, grant } = state;
  const { mode, selector, takeoverId, window: attachedWindow } = grant ?? {};
  const attachedWindowId = attachedWindow?.id;
  const attachedWindowPid = attachedWindow?.pid;
  const windows = capabilities?.windowSelection === false ? undefined : state.windows;
  const windowId = windows?.find(({ id }) => id === selection)?.id ?? "";
  const foregroundAvailable = capabilities?.foregroundInput === true;

  useEffect(() => () => clearDrag.current?.(), []);
  // Surface physical input / foreground use app-wide, not only in this pane.
  useEffect(() => {
    publishPhysicalInput(location, state, request);
  }, [location, state.grant, state.activity, request]);

  useEffect(() => {
    const current = revisions.current;
    const version = ++current.request;
    void request({ op: "status", threadId }).then(
      (result) => {
        if (current.request === version) setState(result);
      },
      () => {},
    );
    return () => {
      current.request++;
    };
  }, [request, threadId]);
  useEffect(() => {
    const onAttachRequest = (event: Event) => {
      const target = (event as CustomEvent<SurfaceLocation>).detail;
      if (
        target?.threadId === threadId &&
        target.projectId === location.projectId &&
        target.environmentId === location.environmentId &&
        enabled
      )
        setOpen(true);
    };
    window.addEventListener(NATIVE_WINDOW_ATTACH_REQUEST_EVENT, onAttachRequest);
    return () => window.removeEventListener(NATIVE_WINDOW_ATTACH_REQUEST_EVENT, onAttachRequest);
  }, [enabled, location.environmentId, location.projectId, threadId]);
  useEffect(() => {
    const onUpdate = (event: Event) => {
      const update = (event as CustomEvent<NativeWindowUpdate>).detail;
      if (
        update?.location?.threadId !== threadId ||
        update.location.projectId !== location.projectId ||
        update.location.environmentId !== location.environmentId
      )
        return;
      revisions.current.request++;
      revisions.current.control++;
      setState((current) => ({
        ...current,
        ...update.state,
        activity: update.state.activity ?? "background",
      }));
      setBusy(undefined);
      setError("");
      if (!update.state.grant) setMeaning("");
    };
    window.addEventListener(NATIVE_WINDOW_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(NATIVE_WINDOW_UPDATED_EVENT, onUpdate);
  }, [location.environmentId, location.projectId, threadId]);

  useEffect(() => {
    const canRefresh = isActivePane && mode === "agent" && busy === undefined;
    const refreshing = canRefresh && activeAgentTurn;
    const settled = canRefresh && wasRefreshing.current && !activeAgentTurn;
    wasRefreshing.current = refreshing;
    if (!refreshing && !settled) return;

    let cancelled = false;
    let timer: number | undefined;
    const current = revisions.current;
    async function refreshStatus() {
      const version = current.request;
      try {
        const result = await request({ op: "status", threadId });
        if (cancelled || current.request !== version) return;
        const live = result.grant;
        if (
          live &&
          (live.selector !== selector ||
            live.window.id !== attachedWindowId ||
            live.window.pid !== attachedWindowPid ||
            (live.mode === "agent" && live.takeoverId !== takeoverId))
        )
          return;

        const activity = live?.mode === "agent" ? (result.activity ?? "background") : "background";
        setState((previous) =>
          live?.mode === "agent" && previous.activity === activity
            ? previous
            : { ...previous, grant: live, activity },
        );
      } catch {
        // Keep the last confirmed status and retry while the turn is active.
      } finally {
        if (!cancelled && refreshing) timer = window.setTimeout(refreshStatus, STATUS_REFRESH_MS);
      }
    }

    // Sample once more as the turn settles so a refusal between polls stays visible.
    void refreshStatus();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activeAgentTurn,
    attachedWindowId,
    attachedWindowPid,
    busy,
    isActivePane,
    mode,
    request,
    selector,
    takeoverId,
    threadId,
  ]);

  async function send(
    op: "list" | "take" | "resume" | "revoke" | "attach",
    drop?: { window: NativeWindowChoice; canAttach: () => boolean },
  ) {
    const selectedId = drop?.window.id ?? windowId;
    if (op === "attach" && !selectedId) return;
    const current = revisions.current;
    const version = ++current.request;
    if (op === "take" || op === "revoke" || op === "attach") current.control++;
    const controlVersion = current.control;
    setBusy(op);
    setError("");
    try {
      const foreground = foregroundAvailable && physical;
      if (op === "attach") {
        if (drop) {
          const choice = drop.window;
          const label = `“${choice.title || choice.app}” (${windowDescription(choice, windows)})`;
          const message = foreground
            ? `Allow this thread to use ${label} and send physical mouse and keyboard input while it is in front?`
            : `Allow this thread to use ${label}?`;
          if (
            !drop.canAttach() ||
            !(await showCustomConfirm(message)) ||
            !drop.canAttach() ||
            current.request !== version
          )
            return;
          requireSurfaceAttachmentSlot(location);
        }
        await prepareThread?.();
        if (current.request !== version || (drop && !drop.canAttach())) return;
        if (drop) requireSurfaceAttachmentSlot(location);
      }
      const description = meaning.trim();
      const command: NativeComputerCommand =
        op === "attach"
          ? { op, threadId, windowId: selectedId, foreground }
          : op === "resume" && grant
            ? {
                op,
                threadId,
                selector: grant.selector,
                ...(grant.takeoverId ? { takeoverId: grant.takeoverId } : {}),
                ...(description ? { meaning: description } : {}),
              }
            : op === "take" || op === "revoke"
              ? { op, threadId, ...(grant ? { selector: grant.selector } : {}) }
              : { op, threadId };
      const { continuationId, ...result } = await request(command);
      if (op === "resume" && continuationId && grant?.takeoverId) {
        const { selector, takeoverId } = grant;
        const matchesReturn = (live: NativeComputerState["grant"]) =>
          live?.mode === "agent" && live.selector === selector && live.takeoverId === takeoverId;
        const stillCurrent = () => current.control === controlVersion;
        if (matchesReturn(result.grant) && stillCurrent()) {
          queueThreadContinuation({
            id: continuationId,
            threadId,
            environmentId: location.environmentId,
            text: `I returned control of the attached desktop window (${selector}). Take a fresh computer_snapshot with this selector and use the current state and any user demonstration it reports to continue the task. Check whether previous actions already took effect before retrying them.`,
            failedTitle: "Desktop window control was returned",
            verify: async () => {
              if (!stillCurrent()) return false;
              const live = await request({ op: "status", threadId });
              return stillCurrent() && matchesReturn(live.grant);
            },
          });
        }
      }
      if (current.request !== version) return;
      if (op === "list") {
        setState(result);
        if (!result.capabilities?.foregroundInput) setPhysical(false);
      } else {
        setState((current) => ({
          ...current,
          ...result,
          activity: result.activity ?? "background",
        }));
      }
      if (op === "resume" || op === "revoke") setMeaning("");
      if (op === "attach") {
        setOpen(false);
        const attached = result.grant;
        if (attached && (!drop || drop.canAttach()))
          attachToDraft(nativeWindowAttachmentFile(location, attached));
      }
    } catch (cause) {
      if (current.request === version) {
        if (op === "list") {
          setState(({ grant }) => ({ grant }));
          setPhysical(false);
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (current.request === version) {
        current.request++;
        setBusy(undefined);
      }
    }
  }

  function startWindowDrag(event: DragEvent, choice: NativeWindowChoice) {
    clearDrag.current?.();
    clearDrag.current = writeNativeWindowDrag(event.dataTransfer, location, (canAttach) => {
      setOpen(false);
      endWindowDrag();
      return send("attach", { window: choice, canAttach });
    });
    setDragging(true);
  }

  function endWindowDrag() {
    clearDrag.current?.();
    setDragging(false);
  }

  if (!enabled && !grant) return null;
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1 text-xs">
      <Dialog
        open={open}
        modal={false}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setPhysical(false);
            setSelection(undefined);
            void send("list");
          } else {
            endWindowDrag();
            setError("");
          }
        }}
      >
        <DialogTrigger
          render={<Button type="button" variant="ghost" size="xs" />}
          aria-label={
            grant
              ? `Desktop window: ${grant.window.title || grant.window.app}`
              : "Attach desktop window"
          }
          title={grant ? windowDescription(grant.window, windows) : undefined}
          data-native-window-selector={grant?.selector}
          draggable={Boolean(grant)}
          onDragStart={(event) =>
            writeSurfaceDrag(event, grant ? nativeWindowAttachmentFile(location, grant) : null)
          }
          disabled={!enabled || grant?.mode === "user" || busy !== undefined}
        >
          <AppWindowIcon aria-hidden="true" />
          {grant ? grant.window.title || grant.window.app : "Desktop window"}
        </DialogTrigger>
        <DialogPopup
          // Keep the dragged row mounted while exposing the composer to the pointer.
          backdropClassName={dragging ? "pointer-events-none opacity-0!" : ""}
          viewportClassName={dragging ? "pointer-events-none opacity-0" : ""}
        >
          <DialogPanel>
            <DialogTitle>Attach a desktop window</DialogTitle>
            <DialogDescription>
              Select a window and choose Allow and attach, or drag it to the composer.
            </DialogDescription>
            <div className="mt-3 flex items-start justify-between gap-3 text-xs text-muted-foreground">
              <p role="status">
                {busy === "list" ? "Finding desktop windows…" : capabilities?.details}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Refresh windows"
                disabled={busy !== undefined}
                onClick={() => void send("list")}
              >
                <RefreshCwIcon aria-hidden="true" />
              </Button>
            </div>
            {capabilities && busy !== "list" ? (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li>
                  Window selection {capabilities.windowSelection ? "available" : "unavailable"}
                </li>
                <li>
                  Accessibility actions{" "}
                  {capabilities.accessibilityActions ? "available" : "unavailable"}
                </li>
                <li>Window capture {capabilities.windowCapture ? "available" : "unavailable"}</li>
                {!foregroundAvailable && <li>Physical input unavailable</li>}
              </ul>
            ) : null}
            {windows && windows.length > 0 ? (
              <fieldset className="mt-3 max-h-64 min-w-0 overflow-y-auto rounded-[var(--radius-control)] border border-border/60">
                <legend className="sr-only">Available windows</legend>
                {windows.map((window) => (
                  <label
                    key={window.id}
                    className="flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0 [&[draggable=true]]:cursor-grab"
                    draggable={enabled && busy === undefined}
                    onDragStart={(event) => startWindowDrag(event, window)}
                    onDragEnd={endWindowDrag}
                  >
                    <input
                      type="radio"
                      name={group}
                      checked={selection === window.id}
                      onChange={() => setSelection(window.id)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{window.title || window.app}</span>
                      <span className="block text-xs text-muted-foreground">
                        {windowDescription(window, windows)}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : busy !== "list" && capabilities?.windowSelection !== false && !error ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No eligible windows are available.
              </p>
            ) : null}
            {foregroundAvailable && busy !== "list" ? (
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={physical}
                  onChange={(event) => setPhysical(event.currentTarget.checked)}
                />
                Allow physical mouse and keyboard input while this window is in front
              </label>
            ) : null}
            {error ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                size="sm"
                disabled={busy !== undefined || !windowId}
                onClick={() => void send("attach")}
              >
                Allow and attach
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
      {grant ? (
        <>
          {(capabilities as { maturity?: string } | undefined)?.maturity === "preview" && (
            <span
              className="rounded-[var(--radius-control)] border border-border/60 px-1.5 text-muted-foreground"
              title={(capabilities as { maturityNote?: string }).maturityNote}
            >
              Preview
            </span>
          )}
          <span className="text-muted-foreground" role="status">
            {busy === "take" || busy === "revoke"
              ? "Releasing input…"
              : grant.mode === "user"
                ? "You have control"
                : agentControlLabel(state.activity, isActivePane && activeAgentTurn)}
          </span>
          {grant.mode === "user" && (
            <input
              aria-label="Meaning of the demonstrated window step"
              placeholder="What did this step do?"
              className="w-40 bg-transparent"
              maxLength={320}
              value={meaning}
              onChange={(event) => setMeaning(event.currentTarget.value)}
            />
          )}
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={
              busy === "take" ||
              busy === "resume" ||
              busy === "revoke" ||
              (!enabled && grant.mode === "user")
            }
            onClick={() => void send(grant.mode === "agent" ? "take" : "resume")}
          >
            {grant.mode === "agent"
              ? AGENT_HANDOFF_LABELS.takeOver
              : AGENT_HANDOFF_LABELS.returnToAgent}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy === "revoke"}
            onClick={() => void send("revoke")}
          >
            {AGENT_HANDOFF_LABELS.stopAgent}
          </Button>
        </>
      ) : null}
      {!open && error ? (
        <span className="text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

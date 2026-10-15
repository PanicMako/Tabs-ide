import {
  advanceRunner,
  jumpRunner,
  newRunner,
  runnerEncounter,
  runnerTools,
  stepRunner,
} from "./workspaceRunnerModel";

export function mountWorkspaceRunner(root: HTMLDetailsElement): void {
  if (root.dataset.ready === "true") return;
  const scene = root.querySelector<SVGSVGElement>("[data-runner-scene]")!;
  const player = root.querySelector<SVGGElement>("[data-runner-player]")!;
  const obstacle = root.querySelector<SVGGElement>("[data-runner-obstacle]")!;
  const obstacleText = root.querySelector<SVGTextElement>("[data-runner-label]")!;
  const status = root.querySelector<HTMLElement>("[data-runner-status]")!;
  const collected = root.querySelector<HTMLElement>("[data-runner-collected]")!;
  const start = root.querySelector<HTMLButtonElement>("[data-runner-start]")!;
  const jump = root.querySelector<HTMLButtonElement>("[data-runner-jump]")!;
  const pause = root.querySelector<HTMLButtonElement>("[data-runner-pause]")!;
  const advance = root.querySelector<HTMLButtonElement>("[data-runner-advance]")!;
  const mode = root.querySelector<HTMLSelectElement>("[data-runner-mode]")!;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const lifetime = new AbortController();
  let state = newRunner();
  let started = false;
  let paused = true;
  let frame = 0;
  let previous = 0;
  mode.value = motion.matches ? "untimed" : "animated";
  function announce() {
    if (!started) status.textContent = "Ready when you are. Start a run or choose untimed mode.";
    else if (state.outcome === "collision")
      status.textContent =
        "Caught in the window shuffle. Restart to try again; there is no saved score.";
    else if (state.outcome === "complete")
      status.textContent =
        "All four tools collected. One workspace, less window shuffle! Restart for another run.";
    else if (paused && mode.value === "animated") status.textContent = "Paused. Resume when ready.";
    else
      status.textContent =
        runnerEncounter(state) === "window"
          ? "Next: a scattered window. Jump to avoid it."
          : `Next: collect ${runnerTools[state.tools]}.`;
  }
  function render() {
    const focusedControl = document.activeElement;
    const restoreFocus =
      state.outcome !== "running" &&
      (focusedControl === jump || focusedControl === advance || focusedControl === pause);
    const x = mode.value === "untimed" ? 360 : 80 + 430 + state.encounter * 350 - state.distance;
    player.setAttribute("transform", `translate(70,${132 - state.height})`);
    obstacle.setAttribute("transform", `translate(${x},0)`);
    obstacle.setAttribute("visibility", state.outcome === "complete" ? "hidden" : "visible");
    obstacleText.textContent =
      runnerEncounter(state) === "window"
        ? "Window shuffle"
        : (runnerTools[state.tools] ?? "Workspace");
    scene.dataset.kind = runnerEncounter(state);
    collected.textContent = `In your workspace: ${runnerTools.slice(0, state.tools).join(" · ") || "no tools yet"}`;
    jump.disabled =
      !started || state.outcome !== "running" || (paused && mode.value === "animated");
    advance.hidden = mode.value !== "untimed";
    advance.disabled = !started || state.outcome !== "running";
    pause.hidden = mode.value === "untimed";
    pause.disabled = !started || state.outcome !== "running";
    pause.textContent = paused ? "Resume run" : "Pause run";
    start.textContent = started ? "Restart run" : "Start run";
    if (restoreFocus && root.open && !document.hidden) start.focus();
  }
  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
    paused = true;
    render();
    announce();
  }
  function tick(time: number) {
    if (paused || !root.open || document.hidden) {
      stop();
      return;
    }
    const before = state.encounter;
    state = stepRunner(state, previous ? time - previous : 0);
    previous = time;
    render();
    if (state.outcome !== "running") {
      frame = 0;
      paused = true;
      render();
      announce();
      return;
    }
    if (before !== state.encounter) announce();
    frame = requestAnimationFrame(tick);
  }
  function play() {
    if (!root.open || document.hidden || state.outcome !== "running") return;
    paused = false;
    previous = 0;
    if (mode.value === "animated") frame = requestAnimationFrame(tick);
    render();
    announce();
  }
  function doJump() {
    if (jump.disabled) return;
    state = mode.value === "untimed" ? advanceRunner(state, true) : jumpRunner(state);
    render();
    if (mode.value === "untimed") announce();
  }
  start.addEventListener(
    "click",
    () => {
      stop();
      state = newRunner();
      started = true;
      play();
    },
    { signal: lifetime.signal },
  );
  jump.addEventListener("click", doJump, { signal: lifetime.signal });
  advance.addEventListener(
    "click",
    () => {
      state = advanceRunner(state, false);
      render();
      announce();
    },
    { signal: lifetime.signal },
  );
  pause.addEventListener("click", () => (paused ? play() : stop()), { signal: lifetime.signal });
  mode.addEventListener(
    "change",
    () => {
      stop();
      state = newRunner();
      started = false;
      render();
      announce();
    },
    { signal: lifetime.signal },
  );
  root.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        stop();
        root.open = false;
        root.querySelector("summary")?.focus();
      } else if (event.key === "ArrowUp" && !(event.target instanceof HTMLSelectElement)) {
        event.preventDefault();
        if (!event.repeat) doJump();
      }
    },
    { signal: lifetime.signal },
  );
  root.addEventListener(
    "toggle",
    () => {
      if (!root.open) stop();
    },
    { signal: lifetime.signal },
  );
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) stop();
    },
    { signal: lifetime.signal },
  );
  motion.addEventListener(
    "change",
    () => {
      if (motion.matches) {
        stop();
        mode.value = "untimed";
        state = newRunner();
        started = false;
        render();
        announce();
      }
    },
    { signal: lifetime.signal },
  );
  window.addEventListener(
    "pagehide",
    (event) => {
      stop();
      if (!event.persisted) lifetime.abort();
    },
    { signal: lifetime.signal },
  );
  root.dataset.ready = "true";
  render();
  announce();
}

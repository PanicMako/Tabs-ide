export interface RunnerState {
  distance: number;
  height: number;
  velocity: number;
  encounter: number;
  tools: number;
  outcome: "running" | "collision" | "complete";
}
export const runnerTools = ["Code", "Agents", "Git", "Browser"] as const;
export function newRunner(): RunnerState {
  return { distance: 0, height: 0, velocity: 0, encounter: 0, tools: 0, outcome: "running" };
}
export function runnerEncounter(state: RunnerState): "window" | "tool" {
  return state.encounter % 2 === 0 ? "window" : "tool";
}
export function jumpRunner(state: RunnerState): RunnerState {
  return state.outcome === "running" && state.height === 0 ? { ...state, velocity: 360 } : state;
}
export function stepRunner(state: RunnerState, milliseconds: number): RunnerState {
  if (state.outcome !== "running" || !Number.isFinite(milliseconds) || milliseconds <= 0)
    return state;
  const seconds = Math.min(milliseconds, 50) / 1000;
  const distance = state.distance + 180 * seconds;
  const height = Math.max(0, state.height + state.velocity * seconds);
  const next = {
    ...state,
    distance,
    height,
    velocity: height > 0 ? state.velocity - 900 * seconds : 0,
  };
  const target = 430 + state.encounter * 350;
  if (distance >= target) {
    if (runnerEncounter(state) === "window" && height < 54)
      return { ...next, outcome: "collision" };
    next.encounter++;
    if (runnerEncounter(state) === "tool") next.tools++;
    if (next.tools === runnerTools.length) next.outcome = "complete";
  }
  return next;
}
/** Untimed alternative: each action resolves one clearly announced encounter. */
export function advanceRunner(state: RunnerState, jump: boolean): RunnerState {
  if (state.outcome !== "running") return state;
  if (runnerEncounter(state) === "window" && !jump) return { ...state, outcome: "collision" };
  const tools = state.tools + (runnerEncounter(state) === "tool" ? 1 : 0);
  return {
    ...state,
    distance: 430 + state.encounter * 350,
    encounter: state.encounter + 1,
    height: 0,
    velocity: 0,
    tools,
    outcome: tools === runnerTools.length ? "complete" : "running",
  };
}

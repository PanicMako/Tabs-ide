import type { BrowserReadinessState } from "@tabs/contracts";

/** Reject results from a previous target, even when its request completes late. */
export class ReadinessProbeGate {
  private target: string | undefined;
  private ticket: symbol | null = null;
  private previous: BrowserReadinessState = "probing";
  reset(target?: string): void {
    this.target = target;
    this.ticket = null;
    this.previous = "probing";
  }
  start(target: string): symbol | null {
    if (target !== this.target || this.ticket) return null;
    return (this.ticket = Symbol("readiness"));
  }
  finish(
    ticket: symbol,
    target: string,
    state: BrowserReadinessState,
  ): { accepted: boolean; recovered: boolean } {
    if (this.ticket !== ticket || this.target !== target)
      return { accepted: false, recovered: false };
    this.ticket = null;
    const recovered = this.previous === "offline" && state === "ready";
    this.previous = state;
    return { accepted: true, recovered };
  }
}

/**
 * TanStack Router commits every navigation inside `React.startTransition`. That is low priority:
 * while anything else updates often (a streaming agent, timers, the workspace store), React keeps
 * interrupting and restarting the render of the next screen. Clicking Settings or Back then did
 * nothing for a moment and the screen appeared at some random point later.
 *
 * Navigations started through `navigateUrgently` commit at normal priority instead, so the next
 * screen renders straight away. Every other navigation keeps the router's default.
 */
type StartTransition = (fn: () => void) => void;

let urgentDepth = 0;

const runNow: StartTransition = (fn) => fn();

/** The router (re)assigns `startTransition` on every render, so it is intercepted once here. */
export function installUrgentNavigation(router: { startTransition: StartTransition }): void {
  let transitional: StartTransition = router.startTransition;
  Object.defineProperty(router, "startTransition", {
    configurable: true,
    get: () => (urgentDepth > 0 ? runNow : transitional),
    set: (next: StartTransition) => {
      transitional = next;
    },
  });
}

/** Runs a navigation whose screen should appear immediately. */
export async function navigateUrgently<T>(navigate: () => Promise<T>): Promise<T> {
  urgentDepth += 1;
  try {
    return await navigate();
  } finally {
    urgentDepth -= 1;
  }
}

export function isUrgentNavigationActive(): boolean {
  return urgentDepth > 0;
}

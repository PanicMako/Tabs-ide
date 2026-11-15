/**
 * While the splash plays, the workspace layer is parked off-screen and later slides
 * up (see StartupCurtain). Positions measured inside it are transformed and wrong
 * for anything that places a native view from them, so those wait for the settled
 * layout (StartupShell fires a resize once the splash is gone).
 */
export function isUnderStartupTransform(node: Element | null): boolean {
  return node?.closest("[data-staged],[data-rising]") != null;
}

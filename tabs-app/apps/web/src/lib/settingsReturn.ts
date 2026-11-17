/**
 * Where Settings' Back returns to. Going back to "/" made the index route render, then navigate
 * again (at low priority) to the thread the user had open: two hops and two renders, which is
 * what made Back slow and land at a random moment. Remembering the exact location the user left
 * lets Back return there in one step.
 */
let lastWorkspaceHref: string | null = null;

export function rememberWorkspaceLocation(href: string, pathname: string): void {
  if (pathname === "/settings") return;
  lastWorkspaceHref = href;
}

/** The location to return to from Settings: where the user was, or the workspace home. */
export function settingsReturnHref(): string {
  return lastWorkspaceHref ?? "/";
}

export function accountNavigation(actor: unknown, returnTo: string) {
  if (actor === null) {
    return {
      label: "Sign in with GitHub",
      href: `/auth/github/start?${new URLSearchParams({ returnTo })}`,
      reviewer: false,
      operator: false,
    };
  }
  if (
    !actor ||
    typeof actor !== "object" ||
    Array.isArray(actor) ||
    !("login" in actor) ||
    typeof actor.login !== "string" ||
    !actor.login.trim() ||
    actor.login.length > 100
  )
    throw new Error("Invalid account identity.");
  return {
    label: `${actor.login} · Account`,
    href: "/account",
    reviewer: "admin" in actor && actor.admin === true,
    operator: "operator" in actor && actor.operator === true,
  };
}

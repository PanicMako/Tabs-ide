import { request } from "./api";
import { accountNavigation } from "../lib/accountNavigation";

const accountLink = document.getElementById("account-link") as HTMLAnchorElement;
const reviewerLink = document.getElementById("reviewer-link") as HTMLAnchorElement;
const operatorLink = document.getElementById("operator-link") as HTMLAnchorElement | null;
const signout = document.getElementById("dashboard-signout") as HTMLButtonElement | null;
const sessionStatus = document.getElementById("dashboard-session-status");
let generation = 0;
let pending: AbortController | undefined;
async function updateAccount() {
  const current = ++generation;
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  reviewerLink.hidden = true;
  if (signout) signout.hidden = true;
  if (operatorLink) operatorLink.hidden = true;
  accountLink.textContent = "Publisher account";
  accountLink.href = "/account";
  try {
    const actor = await request<unknown>("/v1/me", "GET", undefined, controller.signal);
    if (current !== generation) return;
    const navigation = accountNavigation(
      actor,
      `${location.pathname}${location.search}${location.hash}`,
    );
    accountLink.textContent = navigation.label;
    const monogram = document.getElementById("account-monogram");
    if (monogram)
      monogram.textContent =
        actor && typeof actor === "object" && "login" in actor && typeof actor.login === "string"
          ? actor.login.slice(0, 1).toUpperCase()
          : "T";
    const summary = document.getElementById("account-summary-name");
    if (summary)
      summary.textContent =
        actor && typeof actor === "object" && "login" in actor && typeof actor.login === "string"
          ? actor.login
          : "Sign in";
    if (summary)
      summary.closest("summary")?.setAttribute("aria-label", summary.textContent || "Your account");
    if (
      monogram &&
      actor &&
      typeof actor === "object" &&
      "login" in actor &&
      typeof actor.login === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(actor.login)
    ) {
      const avatar = document.createElement("img");
      avatar.alt = "";
      avatar.width = 32;
      avatar.height = 32;
      avatar.referrerPolicy = "no-referrer";
      avatar.src = `https://github.com/${encodeURIComponent(actor.login)}.png?size=64`;
      avatar.addEventListener("error", () => avatar.remove(), { once: true });
      monogram.append(avatar);
    }
    accountLink.href = navigation.href;
    reviewerLink.hidden = !navigation.reviewer;
    if (operatorLink) operatorLink.hidden = !navigation.operator;
    if (signout) signout.hidden = actor === null;
  } catch {
    // Keep the normal account link usable when background account lookup fails.
  }
}
window.addEventListener("pagehide", () => {
  generation++;
  pending?.abort();
  reviewerLink.hidden = true;
  if (signout) signout.hidden = true;
  if (operatorLink) operatorLink.hidden = true;
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void updateAccount();
});
void updateAccount();

signout?.addEventListener("click", async () => {
  signout.disabled = true;
  if (sessionStatus) sessionStatus.textContent = "Signing out…";
  try {
    await request("/v1/logout", "POST", {});
    reviewerLink.hidden = true;
    if (operatorLink) operatorLink.hidden = true;
    const content = document.getElementById("account-content");
    if (content) content.hidden = true;
    location.assign("/");
  } catch (error) {
    if (sessionStatus)
      sessionStatus.textContent =
        error instanceof Error ? error.message : "Sign-out failed. Try again.";
    signout.disabled = false;
  }
});

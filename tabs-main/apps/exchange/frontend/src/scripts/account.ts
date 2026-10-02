import { request } from "./api";
import { accountNavigation } from "../lib/accountNavigation";

const accountLink = document.getElementById("account-link") as HTMLAnchorElement;
const reviewerLink = document.getElementById("reviewer-link") as HTMLAnchorElement;
let generation = 0;
let pending: AbortController | undefined;
async function updateAccount() {
  const current = ++generation;
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  reviewerLink.hidden = true;
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
    accountLink.href = navigation.href;
    reviewerLink.hidden = !navigation.reviewer;
  } catch {
    // Keep the normal account link usable when background account lookup fails.
  }
}
window.addEventListener("pagehide", () => {
  generation++;
  pending?.abort();
  reviewerLink.hidden = true;
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void updateAccount();
});
void updateAccount();

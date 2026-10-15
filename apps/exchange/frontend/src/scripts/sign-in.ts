import { loginReturnRoute } from "../../../src/loginReturn";

const messages: Record<string, string> = {
  cancelled: "Sign-in was cancelled. You can try again whenever you’re ready.",
  expired: "That sign-in link has expired or was already used. Start a fresh attempt to continue.",
  denied:
    "This private Exchange is limited to invited accounts. Use an invited GitHub account, or ask the operator for access.",
  unavailable: "We couldn’t finish signing you in. Try again in a moment.",
};
const params = new URLSearchParams(location.search);
const message = document.getElementById("sign-in-message");
const reason = params.get("reason") ?? "";
if (message)
  message.textContent = Object.hasOwn(messages, reason) ? messages[reason]! : messages.unavailable!;
const retry = document.getElementById("sign-in-retry");
if (retry instanceof HTMLAnchorElement) {
  const query = new URLSearchParams({ returnTo: loginReturnRoute(params.get("returnTo")) });
  retry.href = `/auth/github/start?${query}`;
}

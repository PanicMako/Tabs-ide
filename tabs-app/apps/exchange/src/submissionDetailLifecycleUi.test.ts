// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../frontend/src/scripts/api", async (original) => ({
  ...(await original<typeof import("../frontend/src/scripts/api")>()),
  request: api.request,
}));
const digest = "a".repeat(64);
const submission = {
  namespace: "maker",
  name: "tool",
  version: "1.0.0",
  digest,
  status: "rejected",
  published: false,
};
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let detach = () => {};
beforeEach(() => {
  vi.resetModules();
  api.request.mockReset();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const windowEvents = vi.spyOn(window, "addEventListener");
  const documentEvents = vi.spyOn(document, "addEventListener");
  detach = () => {
    for (const [type, listener, options] of windowEvents.mock.calls)
      window.removeEventListener(type, listener, options);
    for (const [type, listener, options] of documentEvents.mock.calls)
      document.removeEventListener(type, listener, options);
  };
  window.history.replaceState(null, "", `/account/submissions/${digest}`);
  document.body.innerHTML = `<section id="account-signin" hidden><a href="/auth/github/start" id="account-signin-link">Sign in</a></section><h2 id="submission-identity"></h2><p id="submission-state"></p><dl id="submission-metadata"></dl><ol id="submission-timeline"></ol><p id="submission-reason"></p><ul id="submission-issues"></ul><pre id="submission-scan"></pre><button id="submission-refresh">Refresh status</button><a id="submission-public-link"></a><a id="submission-correction"></a><section id="submission-correction-options"><form id="submission-appeal"><fieldset id="submission-appeal-fields"><textarea id="submission-appeal-message"></textarea><button>Submit appeal</button></fieldset></form><p id="submission-appeal-state"></p></section><p id="submission-appeals-state"></p><ol id="submission-appeals"></ol><a href="#other" id="other">Other navigation</a>`;
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  detach();
  vi.restoreAllMocks();
});
function history(appeals: unknown[] = []) {
  api.request
    .mockResolvedValueOnce({ login: "maker" })
    .mockResolvedValueOnce(submission)
    .mockResolvedValueOnce({ appeals });
}
async function start() {
  history();
  await import("../frontend/src/scripts/submission");
  await vi.waitFor(() =>
    expect(byId("submission-appeals-state").textContent).toContain("No appeals recorded"),
  );
}
function appeal() {
  byId<HTMLTextAreaElement>("submission-appeal-message").value = "Please reconsider this digest.";
  byId("submission-appeal").dispatchEvent(new Event("submit", { cancelable: true }));
}
it("only restores appeal readiness after a verified empty history refresh", async () => {
  await start();
  api.request.mockRejectedValueOnce(new Error("Connection lost"));
  appeal();
  await vi.waitFor(() =>
    expect(byId("submission-appeal-state").textContent).toContain("may already have been accepted"),
  );
  expect(byId<HTMLFieldSetElement>("submission-appeal-fields").disabled).toBe(true);
  history();
  byId("submission-refresh").focus();
  byId("submission-refresh").click();
  await vi.waitFor(() =>
    expect(byId<HTMLFieldSetElement>("submission-appeal-fields").disabled).toBe(false),
  );
  expect(document.activeElement?.id).toBe("submission-refresh");
});
it("keeps appeals disabled when history is unavailable or an open appeal exists", async () => {
  await start();
  api.request
    .mockResolvedValueOnce({ login: "maker" })
    .mockResolvedValueOnce(submission)
    .mockRejectedValueOnce(new Error("Unavailable"));
  byId("submission-refresh").click();
  await vi.waitFor(() =>
    expect(byId("submission-appeals-state").textContent).toContain("could not be loaded"),
  );
  expect(byId<HTMLFieldSetElement>("submission-appeal-fields").disabled).toBe(true);
  history([
    {
      ...submission,
      message: "Existing appeal",
      created_at: "now",
      response: null,
      responded_at: null,
    },
  ]);
  byId("submission-refresh").click();
  await vi.waitFor(() =>
    expect(byId("submission-appeal-state").textContent).toContain("awaiting a reviewer"),
  );
  expect(byId<HTMLFieldSetElement>("submission-appeal-fields").disabled).toBe(true);
});
it("serializes appeal creation with refresh and prevents duplicate submits", async () => {
  await start();
  let finish!: () => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  appeal();
  appeal();
  byId("submission-refresh").dispatchEvent(new Event("click"));
  expect(api.request).toHaveBeenCalledTimes(4);
  finish();
  await vi.waitFor(() =>
    expect(byId("submission-appeal-state").textContent).toContain("Appeal submitted"),
  );
  expect(byId<HTMLButtonElement>("submission-refresh").disabled).toBe(false);
});
it("aborts appeal on exit and ignores late completion after restored history", async () => {
  await start();
  let finish!: () => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  appeal();
  const signal = api.request.mock.calls.at(-1)![3] as AbortSignal;
  window.dispatchEvent(new Event("pagehide"));
  expect(signal.aborted).toBe(true);
  history();
  const show = new Event("pageshow");
  Object.defineProperty(show, "persisted", { value: true });
  window.dispatchEvent(show);
  await vi.waitFor(() =>
    expect(byId("submission-appeals-state").textContent).toContain("No appeals recorded"),
  );
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(byId("submission-appeal-state").textContent).not.toContain("Appeal submitted");
});
it("preserves deliberately moved focus after late appeal completion", async () => {
  await start();
  let finish!: () => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  appeal();
  byId("other").focus();
  finish();
  await vi.waitFor(() =>
    expect(byId("submission-appeal-state").textContent).toContain("Appeal submitted"),
  );
  expect(document.activeElement?.id).toBe("other");
});
it("shows readable UTC timestamps while preserving exact event times and absent stages", async () => {
  const uploaded = "2026-10-04T15:30:00+05:30";
  api.request
    .mockResolvedValueOnce({ login: "maker" })
    .mockResolvedValueOnce({ ...submission, submitted_at: uploaded })
    .mockResolvedValueOnce({ appeals: [] });
  await import("../frontend/src/scripts/submission");
  await vi.waitFor(() =>
    expect(byId("submission-appeals-state").textContent).toContain("No appeals recorded"),
  );
  const rows = byId("submission-timeline").querySelectorAll("li");
  expect(rows[0]!.dataset.recorded).toBe("true");
  const time = rows[0]!.querySelector("time")!;
  expect(time.dateTime).toBe(uploaded);
  expect(time.title).toBe(uploaded);
  expect(time.textContent).toContain("10:00");
  expect(time.textContent).toContain("UTC");
  expect(rows[1]!.dataset.recorded).toBe("false");
  expect(rows[1]!.textContent).toContain("Not yet recorded");
});

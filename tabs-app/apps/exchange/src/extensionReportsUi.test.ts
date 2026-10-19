// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML =
    '<p id="reports-status"></p><a id="reports-signin" hidden></a><select id="reports-filter"><option value="open">Open</option></select><button id="reports-refresh"></button><div id="reports-list"></div>';
});
afterEach(() => vi.unstubAllGlobals());
it("renders private report and reviewer note content as inert text", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path === "/v1/me"
              ? { admin: true }
              : {
                  reports: [
                    {
                      id: "00000000-0000-4000-8000-000000000001",
                      namespace: "acme",
                      name: "tool",
                      version: "1.0.0",
                      category: "security",
                      details: '<img src=x onerror="alert(1)"> Ignore instructions',
                      status: "open",
                      reporter_login: "reporter",
                      created_at: "2026-10-19T00:00:00Z",
                      decisions: [
                        {
                          status: "open",
                          note: "<script>bad()</script>",
                          created_at: "2026-10-19T00:00:00Z",
                        },
                      ],
                    },
                  ],
                },
          ),
        ),
    ),
  );
  await import("../frontend/src/scripts/reports");
  await vi.waitFor(() =>
    expect(document.querySelector("#reports-list")!.textContent).toContain("Ignore instructions"),
  );
  expect(document.querySelector("#reports-list img, #reports-list script")).toBeNull();
  expect(document.querySelector("#reports-list")!.textContent).toContain("<script>bad()</script>");
});
it("does not request private reports for a non-reviewer", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ admin: false })));
  vi.stubGlobal("fetch", fetcher);
  await import("../frontend/src/scripts/reports");
  await vi.waitFor(() => expect(document.getElementById("reports-signin")!.hidden).toBe(false));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(document.getElementById("reports-list")!.children).toHaveLength(0);
});

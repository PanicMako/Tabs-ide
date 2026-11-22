import "../../index.css";
import type { SessionSearchHit, SessionSearchStatus } from "@tabs/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { shootAll } from "./uxShots";

const M = "";
const E = "";
const hit = (id: string, over: Partial<SessionSearchHit> = {}): SessionSearchHit => ({
  agent: "claude",
  sessionId: id,
  cwd: "/Users/dev/projects/tabs",
  title: `Session ${id}`,
  timestamp: Date.now() - 3_600_000,
  role: "user",
  snippet: `can you fix the ${M}debounce${E} on the search input`,
  score: 1,
  matchCount: 3,
  transcriptPath: `/tmp/${id}.jsonl`,
  ...over,
});
const hits = [
  hit("a1", { title: "Fix search input debounce" }),
  hit("b2", { agent: "codex", title: "Refactor terminal drawer", cwd: "/Users/dev/projects/app" }),
  hit("c3", { agent: "opencode", title: "Debounce utilities", matchCount: 1 }),
];
const status: SessionSearchStatus = {
  state: "idle",
  sessions: 412,
  messages: 9000,
  byAgent: [
    { agent: "claude", sessions: 300 },
    { agent: "codex", sessions: 90 },
    { agent: "opencode", sessions: 22 },
  ],
  pending: 0,
  lastIndexedAt: Date.now(),
  error: null,
};
const api = {
  sessionSearch: {
    status: vi.fn(async () => status),
    query: vi.fn(async () => ({ hits, indexing: false, elapsedMs: 3 })),
    reindex: vi.fn(async () => status),
    resume: vi.fn(async () => ({
      agent: "claude" as const,
      sessionId: "a1",
      cwd: "/Users/dev/projects/tabs",
      command: "claude --resume a1",
      transcriptPath: "/tmp/a1.jsonl",
    })),
    preview: vi.fn(async () => ({
      messages: [
        { role: "user" as const, text: "The search box feels laggy", timestamp: 1, matched: false },
        {
          role: "assistant" as const,
          text: "I will add a debounce to the input so queries fire after you stop typing.",
          timestamp: 2,
          matched: true,
        },
        { role: "user" as const, text: "Great, also add tests", timestamp: 3, matched: false },
      ],
      totalMessages: 40,
      hiddenBefore: 12,
      hiddenAfter: 25,
      terms: ["debounce"],
    })),
  },
};
vi.mock("../../connection/environmentApiRegistry", () => ({
  environmentApi: async () => api,
}));
vi.mock("../../hooks/useCopyToClipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useCopyToClipboard")>()),
  writeClipboardTextWithNativeFallback: vi.fn(async () => {}),
}));

import { SessionSearchPanel } from "./SessionSearchPanel";
import { openSessionSearch, useSessionSearchStore } from "./sessionSearchStore";

const runInTerminal = vi.fn(async () => {});
beforeEach(() => {
  runInTerminal.mockClear();
  api.sessionSearch.query.mockImplementation(async () => ({
    hits,
    indexing: false,
    elapsedMs: 3,
  }));
});
afterEach(() => useSessionSearchStore.getState().closePanel());

it("searches, previews, navigates by keyboard and resumes", async () => {
  const view = await render(<SessionSearchPanel runInTerminal={runInTerminal} />);
  openSessionSearch("debounce");
  await expect.element(page.getByText("Fix search input debounce").first()).toBeVisible();
  await expect.element(page.getByTestId("session-search-preview")).toBeVisible();
  await expect.element(page.getByText("12 earlier messages")).toBeVisible();
  await shootAll("results", "session-search");
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByRole("listitem").nth(1)).toHaveAttribute("aria-current", "true");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(runInTerminal).toHaveBeenCalledWith("cd /Users/dev/projects/tabs && claude --resume a1"),
  );
  await view.unmount();
});

it("filters by agent chip and shows teaching empty states", async () => {
  const view = await render(<SessionSearchPanel runInTerminal={runInTerminal} />);
  openSessionSearch("");
  await expect.element(page.getByText("Recent sessions")).toBeVisible();
  await page.getByRole("button", { name: /^Codex/ }).click();
  await vi.waitFor(() =>
    expect(api.sessionSearch.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ agents: ["codex"] }),
    ),
  );
  api.sessionSearch.query.mockImplementation(async () => ({
    hits: [],
    indexing: false,
    elapsedMs: 1,
  }));
  await page.getByRole("textbox", { name: "Search past agent sessions" }).fill("zzzz");
  await expect.element(page.getByText('Nothing matches "zzzz"')).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await shootAll("no-match", "session-search");
  await view.unmount();
});

it("shows the error state with a retry", async () => {
  api.sessionSearch.query.mockRejectedValueOnce(new Error("Index worker crashed"));
  const view = await render(<SessionSearchPanel runInTerminal={runInTerminal} />);
  openSessionSearch("x");
  await expect.element(page.getByText("Index worker crashed")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.element(page.getByText("Fix search input debounce").first()).toBeVisible();
  await view.unmount();
});

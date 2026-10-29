import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import {
  AppAtomRegistryProvider,
  appAtomRegistry,
  resetAppAtomRegistryForTests,
} from "../../state/atomRegistry";
import { readModelStateAtom, applyShellStreamItemToAtoms } from "../../state/readModel";
import { useOlderSettledThreads } from "../../hooks/useOlderSettledThreads";

const fixture = vi.hoisted(() => ({ read: vi.fn(), environment: vi.fn() }));
vi.mock("../../connection/environmentApiRegistry", () => ({
  environmentApi: async (id: string) => {
    fixture.environment(id);
    return { orchestration: { getOlderSettledThreads: fixture.read } };
  },
}));
const environment = EnvironmentId.make("owning-machine");
const projectId = ProjectId.make("project");
const before = "2026-10-15T00:00:00.000Z";
const at = DateTime.makeUnsafe("2026-10-01T00:00:00.000Z");
const shell = (index: number): OrchestrationV2ThreadShell => {
  const id = ThreadId.make(`old-${String(index).padStart(3, "0")}`);
  return {
    id,
    projectId,
    title: id,
    createdBy: "user",
    creationSource: "web",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    lineage: { parentThreadId: null, rootThreadId: id, relationshipToParent: null },
    forkedFrom: null,
    activeProviderThreadId: null,
    activeRunId: null,
    latestRunId: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
    providerInstanceHistory: [],
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    settledOverride: "settled",
    settledAt: at,
    deletedAt: null,
  };
};
beforeEach(() => {
  resetAppAtomRegistryForTests();
  fixture.read.mockReset();
  fixture.environment.mockClear();
  appAtomRegistry.set(readModelStateAtom, {
    projects: [],
    threads: [],
    threadsHydrated: true,
    environmentSnapshots: {
      [environment]: {
        snapshotSequence: 10,
        initialized: true,
        updatedAt: before,
        olderSettled: {
          generation: 10,
          before,
          counts: [{ projectId, count: 31 }],
          countRevision: 0,
          countsRevision: 0,
          changes: {},
          pages: {},
        },
      },
    },
  });
  fixture.read.mockImplementation(async (input) => ({
    snapshotSequence: 10,
    counts: [],
    threads: Array.from({ length: input.before.threadId ? 6 : 25 }, (_, index) =>
      shell(index + (input.before.threadId ? 25 : 0)),
    ),
  }));
});
function Probe() {
  const [search, setSearch] = useState("");
  const history = useOlderSettledThreads(environment, projectId, search);
  return (
    <>
      <input
        aria-label="Search history"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <output aria-label="Remaining older tasks">{history.unloaded}</output>
      <output aria-label="History error">{history.error}</output>
      <button type="button" disabled={history.loading} onClick={history.loadMore}>
        Load older tasks
      </button>
    </>
  );
}
const mount = () =>
  render(
    <AppAtomRegistryProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <Probe />
      </QueryClientProvider>
    </AppAtomRegistryProvider>,
  );

it("loads bounded metadata pages on the owning machine without double-counting loaded rows", async () => {
  const view = await mount();
  try {
    await expect
      .element(page.getByRole("status", { name: "Remaining older tasks" }))
      .toHaveTextContent("31");
    await page.getByRole("button", { name: "Load older tasks" }).click();
    await expect.poll(() => appAtomRegistry.get(readModelStateAtom).threads.length).toBe(25);
    expect(fixture.read).toHaveBeenCalledWith({
      before: { settledAt: before },
      projectIds: [projectId],
      limit: 25,
    });
    expect(fixture.environment).toHaveBeenCalledWith(environment);
    await expect
      .element(page.getByRole("status", { name: "Remaining older tasks" }))
      .toHaveTextContent("6");
    await page.getByRole("button", { name: "Load older tasks" }).click();
    await expect.poll(() => appAtomRegistry.get(readModelStateAtom).threads.length).toBe(31);
    expect(fixture.read).toHaveBeenLastCalledWith({
      before: { settledAt: DateTime.formatIso(at), threadId: "old-024" },
      projectIds: [projectId],
      limit: 25,
    });
    await expect
      .element(page.getByRole("status", { name: "Remaining older tasks" }))
      .toHaveTextContent("0");
  } finally {
    await view.unmount();
  }
});

it("searching reads all remaining metadata pages before declaring the history covered", async () => {
  const view = await mount();
  try {
    await page.getByRole("textbox", { name: "Search history" }).fill("old-030");
    await expect.poll(() => appAtomRegistry.get(readModelStateAtom).threads.length).toBe(31);
    expect(fixture.read).toHaveBeenCalledTimes(2);
    await expect
      .element(page.getByRole("status", { name: "Remaining older tasks" }))
      .toHaveTextContent("0");
  } finally {
    await view.unmount();
  }
});

it("refreshes exact counts after an unloaded conversation is removed", async () => {
  fixture.read.mockResolvedValue({
    snapshotSequence: 11,
    threads: [],
    counts: [{ projectId, count: 30 }],
  });
  const view = await mount();
  try {
    applyShellStreamItemToAtoms(
      {
        kind: "thread.removed",
        location: "active",
        sequence: 11,
        threadId: ThreadId.make("unloaded"),
      },
      environment,
    );
    await expect
      .element(page.getByRole("status", { name: "Remaining older tasks" }))
      .toHaveTextContent("30");
    expect(fixture.read).toHaveBeenCalledWith({ before: { settledAt: before }, limit: 0 });
  } finally {
    await view.unmount();
  }
});

it("rejects a count response from before the current snapshot generation", async () => {
  fixture.read.mockResolvedValue({
    snapshotSequence: 9,
    threads: [],
    counts: [{ projectId, count: 30 }],
  });
  const view = await mount();
  try {
    applyShellStreamItemToAtoms(
      {
        kind: "thread.removed",
        location: "active",
        sequence: 11,
        threadId: ThreadId.make("unloaded"),
      },
      environment,
    );
    await expect
      .poll(() => fixture.read)
      .toHaveBeenCalledWith({ before: { settledAt: before }, limit: 0 });
    await expect
      .element(page.getByRole("status", { name: "Remaining older tasks" }))
      .toHaveTextContent("31");
    await expect
      .element(page.getByRole("status", { name: "History error" }))
      .toHaveTextContent("Could not refresh history counts.");
  } finally {
    await view.unmount();
  }
});

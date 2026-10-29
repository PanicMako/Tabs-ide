import "../index.css";
import { EnvironmentId, ProjectId, RunId, ThreadId } from "@tabs/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import BranchToolbar from "./BranchToolbar";
import { appAtomRegistry, AppAtomRegistryProvider } from "../state/atomRegistry";
import { readModelStateAtom } from "../state/readModel";
import {
  createScopedComposerDraftActions,
  initializeComposerDraftsState,
  scopedComposerThreadId,
} from "../state/composerDrafts";
import { useComposerDraftStore } from "../composerDraftStore";
import type { Project, Thread } from "../types";

const fixtures = vi.hoisted(() => ({
  checkout: vi.fn(),
  createBranch: vi.fn(),
  status: vi.fn(),
  branches: vi.fn(),
  dispatch: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("../connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({
    git: {
      checkout: fixtures.checkout,
      createBranch: fixtures.createBranch,
      status: fixtures.status,
      listBranches: fixtures.branches,
    },
    orchestration: { dispatchCommand: fixtures.dispatch },
  }),
  connectedEnvironmentIds: () => ["machine-local"],
  environmentConfig: () => ({ environment: { environmentId: "machine-local", label: "This Mac" } }),
  onEnvironmentApiRegistryEvent: () => () => {},
}));
initializeComposerDraftsState();
const env = EnvironmentId.make("machine-local");
const id = ThreadId.make("draft-scoped-toolbar");
const project: Project = {
  id: ProjectId.make("toolbar-project"),
  environmentId: env,
  name: "Toolbar project",
  cwd: "/repo",
  defaultModelSelection: null,
  expanded: true,
  scripts: [],
};
async function mount(started = false, width = 900) {
  useComposerDraftStore.setState({
    draftsByThreadId: {},
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
  });
  createScopedComposerDraftActions(env).setProjectDraftThreadId(project.id, id);
  appAtomRegistry.set(readModelStateAtom, {
    projects: [project],
    threads: started
      ? [
          {
            id,
            environmentId: env,
            projectId: project.id,
            branch: "main",
            worktreePath: null,
            activeRunId: RunId.make("active-run"),
          } as Thread,
        ]
      : [],
    threadsHydrated: true,
  });
  fixtures.status.mockResolvedValue({ branch: "main" });
  fixtures.branches.mockResolvedValue({
    isRepo: true,
    branches: [
      { name: "main", current: true, isDefault: true, worktreePath: "/repo" },
      { name: "feature/base", current: false, isDefault: false, worktreePath: null },
      {
        name: "origin/main",
        current: false,
        isRemote: true,
        remoteName: "origin",
        isDefault: false,
        worktreePath: null,
      },
    ],
  });
  fixtures.checkout.mockResolvedValue(undefined);
  fixtures.createBranch.mockResolvedValue(undefined);
  fixtures.dispatch.mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <AppAtomRegistryProvider>
      <QueryClientProvider client={client}>
        <form
          style={{ width }}
          onSubmit={(event) => {
            event.preventDefault();
            fixtures.submit();
          }}
        >
          <BranchToolbar
            threadId={id}
            environmentId={env}
            envLocked={false}
            onEnvModeChange={(mode) =>
              createScopedComposerDraftActions(env).setDraftThreadContext(id, { envMode: mode })
            }
          />
        </form>
      </QueryClientProvider>
    </AppAtomRegistryProvider>,
  );
  return { screen, client };
}
afterEach(() => {
  vi.resetAllMocks();
  document.body.innerHTML = "";
});

test("hides the redundant local machine selector and keeps scoped Git controls", async () => {
  const { screen, client } = await mount();
  await expect
    .element(page.getByRole("combobox", { name: "Run on machine" }))
    .not.toBeInTheDocument();
  await expect.element(page.getByRole("combobox", { name: "Workspace mode" })).toBeVisible();
  await expect.element(page.getByRole("combobox", { name: "Branch or worktree" })).toBeVisible();
  await screen.unmount();
  client.clear();
});

test("selecting a base for a new worktree updates the owning draft without checking out the project", async () => {
  const { screen, client } = await mount();
  await page.getByRole("combobox", { name: "Workspace mode" }).click();
  await page.getByRole("option", { name: "New worktree", exact: true }).click();
  await page.getByRole("combobox", { name: "Branch or worktree" }).click();
  await page.getByRole("option", { name: "feature/base", exact: true }).click();
  await expect
    .poll(
      () =>
        useComposerDraftStore.getState().draftThreadsByThreadId[scopedComposerThreadId(env, id)]
          ?.branch,
    )
    .toBe("feature/base");
  expect(fixtures.submit).not.toHaveBeenCalled();
  expect(fixtures.checkout).not.toHaveBeenCalled();
  expect(fixtures.dispatch).not.toHaveBeenCalled();
  await screen.unmount();
  client.clear();
});

test("stops an active run before checking out and saving branch metadata", async () => {
  const { screen, client } = await mount(true);
  await page.getByRole("combobox", { name: "Branch or worktree" }).click();
  await page.getByRole("option", { name: "feature/base", exact: true }).click();
  await expect.poll(() => fixtures.dispatch.mock.calls.length).toBe(2);
  expect(fixtures.dispatch.mock.calls[0]?.[0]).toMatchObject({
    type: "run.interrupt",
    holdQueue: true,
  });
  expect(fixtures.dispatch.mock.calls[1]?.[0]).toMatchObject({
    type: "thread.metadata.update",
    branch: "feature/base",
  });
  expect(fixtures.dispatch.mock.invocationCallOrder[0]).toBeLessThan(
    fixtures.checkout.mock.invocationCallOrder[0]!,
  );
  expect(fixtures.checkout.mock.invocationCallOrder[0]).toBeLessThan(
    fixtures.dispatch.mock.invocationCallOrder[1]!,
  );
  await screen.unmount();
  client.clear();
});
test("does not check out a branch when the active run cannot stop", async () => {
  const { screen, client } = await mount(true);
  fixtures.dispatch.mockRejectedValue(new Error("Cannot interrupt"));
  await page.getByRole("combobox", { name: "Branch or worktree" }).click();
  await page.getByRole("option", { name: "feature/base", exact: true }).click();
  await expect.poll(() => fixtures.dispatch.mock.calls.length).toBe(1);
  await expect.element(page.getByRole("combobox", { name: "Branch or worktree" })).toBeEnabled();
  expect(fixtures.submit).not.toHaveBeenCalled();
  expect(fixtures.checkout).not.toHaveBeenCalled();
  await screen.unmount();
  client.clear();
});

test("stops an active run before creating and checking out a new branch", async () => {
  const { screen, client } = await mount(true);
  await page.getByRole("combobox", { name: "Branch or worktree" }).click();
  await page.getByPlaceholder("Search branches...").fill("feature/new");
  await page.getByRole("option", { name: 'Create new branch "feature/new"' }).click();
  await expect.poll(() => fixtures.dispatch.mock.calls.length).toBe(2);
  await expect.poll(() => fixtures.checkout.mock.calls.length).toBe(1);

  expect(fixtures.dispatch.mock.calls[0]?.[0]).toMatchObject({
    type: "run.interrupt",
    holdQueue: true,
  });
  expect(fixtures.createBranch).toHaveBeenCalledWith({ cwd: "/repo", branch: "feature/new" });
  expect(fixtures.checkout).toHaveBeenCalledWith({ cwd: "/repo", branch: "feature/new" });
  expect(fixtures.dispatch.mock.calls[1]?.[0]).toMatchObject({
    type: "thread.metadata.update",
    branch: "feature/new",
  });
  expect(fixtures.dispatch.mock.invocationCallOrder[0]).toBeLessThan(
    fixtures.createBranch.mock.invocationCallOrder[0]!,
  );
  expect(fixtures.createBranch.mock.invocationCallOrder[0]).toBeLessThan(
    fixtures.checkout.mock.invocationCallOrder[0]!,
  );
  expect(fixtures.checkout.mock.invocationCallOrder[0]).toBeLessThan(
    fixtures.dispatch.mock.invocationCallOrder[1]!,
  );
  await screen.unmount();
  client.clear();
});

test("does not create, check out, or persist a branch when the active run cannot stop", async () => {
  const { screen, client } = await mount(true);
  fixtures.dispatch.mockRejectedValue(new Error("Cannot interrupt"));
  await page.getByRole("combobox", { name: "Branch or worktree" }).click();
  await page.getByPlaceholder("Search branches...").fill("feature/new");
  await page.getByRole("option", { name: 'Create new branch "feature/new"' }).click();
  await expect.poll(() => fixtures.dispatch.mock.calls.length).toBe(1);

  expect(fixtures.dispatch.mock.calls[0]?.[0]).toMatchObject({
    type: "run.interrupt",
    holdQueue: true,
  });
  expect(fixtures.createBranch).not.toHaveBeenCalled();
  expect(fixtures.checkout).not.toHaveBeenCalled();
  await expect
    .poll(
      () =>
        useComposerDraftStore.getState().draftThreadsByThreadId[scopedComposerThreadId(env, id)]
          ?.branch,
    )
    .not.toBe("feature/new");
  await screen.unmount();
  client.clear();
});

test("keeps workspace and branch targets separate in a narrow composer", async () => {
  const { screen, client } = await mount(false, 340);
  await expect.element(page.getByRole("combobox", { name: "Branch or worktree" })).toBeVisible();
  const mode = document.querySelector('[aria-label="Workspace mode"]')!.getBoundingClientRect();
  const branch = document
    .querySelector('[aria-label="Branch or worktree"]')!
    .getBoundingClientRect();
  expect(mode.right <= branch.left || mode.bottom <= branch.top || branch.bottom <= mode.top).toBe(
    true,
  );
  await page.getByRole("combobox", { name: "Workspace mode" }).click();
  await expect
    .element(page.getByRole("option", { name: "New worktree", exact: true }))
    .toBeVisible();
  await page.getByRole("option", { name: "Local", exact: true }).click();
  await screen.unmount();
  client.clear();
});

test("chooses an explicit remote base without checking out the primary repository", async () => {
  const { screen, client } = await mount();
  await page.getByRole("combobox", { name: "Workspace mode" }).click();
  await page.getByRole("option", { name: "New worktree", exact: true }).click();
  await page.getByRole("combobox", { name: "Branch or worktree" }).click();
  await page.getByRole("switch", { name: "Start from remote" }).click();
  await expect
    .poll(() => createScopedComposerDraftActions(env).getDraftThread(id)?.branch)
    .toBe("refs/remotes/origin/main");
  expect(fixtures.checkout).not.toHaveBeenCalled();
  expect(fixtures.submit).not.toHaveBeenCalled();
  await screen.unmount();
  client.clear();
});

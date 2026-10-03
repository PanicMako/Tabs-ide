import type { GitEnvironmentResult, GitStatusFile, NativeApi } from "@tabs/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import "../../index.css";
import { environmentApi } from "../../connection/environmentApiRegistry";
import { useScopedStateStore } from "../../state/scopedStateStore";
import { FileRow } from "./ChangesPanel";
import { GitEnvironmentGate } from "./GitEnvironmentGate";
import { GitApiProvider } from "./gitApiContext";
import { DeviceAuthModal, DiscardAllModal, ForcePushModal } from "./gitModals";
import { PanelErrorBoundary } from "./PanelErrorBoundary";
import { PRsPanel } from "./PRsPanel";

vi.mock("../../connection/environmentApiRegistry", () => ({
  environmentApi: vi.fn(),
}));

const environment = (authenticated: boolean): GitEnvironmentResult => ({
  git: { installed: true, version: "2.52.0" },
  gitHub: {
    cliInstalled: true,
    version: "2.80.0",
    authenticated,
    accounts: [],
    activeLogin: null,
  },
});

async function mount(content: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(content, { container: host });
  return {
    [Symbol.asyncDispose]: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

function authApi(authenticated: boolean): NativeApi {
  return {
    git: {
      environment: vi.fn().mockResolvedValue(environment(authenticated)),
    },
  } as unknown as NativeApi;
}

describe("Git workflow interaction states", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(environmentApi).mockReset();
    useScopedStateStore.setState({ gitStateByProjectId: {} });
    document.body.innerHTML = "";
  });

  it("blocks the workspace during loading and initializes an empty repository", async () => {
    const initialize = vi.fn();
    const { rerender, unmount } = await render(
      <GitEnvironmentGate
        environment={undefined}
        isRepo={undefined}
        isLoading
        initPending={false}
        onInitRepo={initialize}
      >
        <div>Repository workspace</div>
      </GitEnvironmentGate>,
    );

    expect(document.body.textContent).not.toContain("Repository workspace");

    await rerender(
      <GitEnvironmentGate
        environment={environment(false)}
        isRepo={false}
        isLoading={false}
        initPending={false}
        onInitRepo={initialize}
      >
        <div>Repository workspace</div>
      </GitEnvironmentGate>,
    );
    await page.getByRole("button", { name: "Initialize repository" }).click();
    expect(initialize).toHaveBeenCalledOnce();
    await unmount();
  });

  it("requires explicit confirmation for destructive operations", async () => {
    const discard = vi.fn();
    const forcePush = vi.fn();

    {
      await using _ = await mount(
        <DiscardAllModal count={3} onConfirm={discard} onClose={vi.fn()} />,
      );
      expect(document.body.textContent).toContain("This discards 3 files");
      await page.getByRole("button", { name: "Discard everything" }).click();
      expect(discard).toHaveBeenCalledOnce();
    }

    {
      await using _ = await mount(
        <ForcePushModal branch="feature/demo" onConfirm={forcePush} onClose={vi.fn()} />,
      );
      expect(document.body.textContent).toContain("This overwrites the remote branch");
      await page.getByRole("button", { name: "Force push anyway" }).click();
      expect(forcePush).toHaveBeenCalledOnce();
    }
  });

  it("keeps authentication open until the provider reports success", async () => {
    const confirmed = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await using _ = await mount(
      <QueryClientProvider client={queryClient}>
        <GitApiProvider api={authApi(false)} scopeKey="test">
          <DeviceAuthModal
            cwd="/workspace"
            onRunGitHubLogin={vi.fn()}
            onConfirm={confirmed}
            onClose={vi.fn()}
          />
        </GitApiProvider>
      </QueryClientProvider>,
    );

    await page.getByRole("button", { name: "I've authorized it" }).click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("GitHub is not authenticated yet");
    });
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("recovers a failed panel when the user retries", async () => {
    const boundaryRef = createRef<PanelErrorBoundary>();

    await using _ = await mount(
      <PanelErrorBoundary ref={boundaryRef} panelName="Pull requests">
        <div>Recovered panel</div>
      </PanelErrorBoundary>,
    );

    boundaryRef.current?.setState({
      hasError: true,
      error: new Error("provider temporarily unavailable"),
    });
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "Something went wrong in the Pull requests panel",
      ),
    );
    await page.getByRole("button", { name: "Try again" }).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Recovered panel"));
  });

  it("routes a change-row diff through its injected environment API", async () => {
    const diff = vi.fn().mockResolvedValue({ patch: "@@ -1 +1 @@\n-old\n+new" });
    const remoteApi = { git: { diff } } as unknown as NativeApi;
    const file: GitStatusFile = {
      path: "src/remote.ts",
      staged: false,
      unstaged: true,
      conflicted: false,
      untracked: false,
      insertions: 1,
      deletions: 1,
    };

    await using _ = await mount(
      <GitApiProvider api={remoteApi} scopeKey="remote-environment:/workspace">
        <FileRow
          cwd="/workspace"
          f={file}
          staged={false}
          onOpenDiff={vi.fn()}
          onToggleStage={vi.fn()}
          onDiscard={vi.fn()}
        />
      </GitApiProvider>,
    );

    await page.getByRole("button", { name: "Preview inline diff for src/remote.ts" }).click();
    await vi.waitFor(() =>
      expect(diff).toHaveBeenCalledWith({ cwd: "/workspace", path: file.path }),
    );
    expect(document.body.textContent).toContain("new");
  });

  it("transitions repository pull requests through provider-backed state filters", async () => {
    const capabilities = {
      provider: "azure-devops" as const,
      diff: true,
      create: true,
      actions: ["enable_auto_merge", "disable_auto_merge", "edit_pull_request"] as const,
      mergeMethods: ["merge", "squash"] as const,
    };
    const pullRequest = (state: "open" | "merged") => ({
      provider: "azure-devops" as const,
      number: state === "merged" ? 42 : 41,
      title: state === "merged" ? "Merged provider result" : "Open provider result",
      url: `https://github.com/tabs/example/pull/${state === "merged" ? 42 : 41}`,
      baseBranch: "main",
      headBranch: `feature/${state}`,
      state,
    });
    const listPullRequests = vi.fn().mockImplementation(({ state }: { state?: string }) =>
      Promise.resolve({
        pullRequests: [pullRequest(state === "merged" ? "merged" : "open")],
        hasMore: false,
        capabilities,
      }),
    );
    const mutatePullRequest = vi.fn().mockResolvedValue({ pullRequest: pullRequest("open") });
    const api = {
      git: {
        listPullRequests,
        mutatePullRequest,
        resolvePullRequest: vi.fn().mockResolvedValue({
          pullRequest: pullRequest("open"),
          capabilities,
        }),
      },
    } as unknown as NativeApi;
    vi.mocked(environmentApi).mockResolvedValue(api);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await using _ = await mount(
      <QueryClientProvider client={queryClient}>
        <GitApiProvider api={api} scopeKey="remote-pr-environment">
          <PRsPanel
            cwd="/workspace"
            environmentId="remote-pr-environment"
            branchName="feature/open"
            onOpenCreatePR={vi.fn()}
          />
        </GitApiProvider>
      </QueryClientProvider>,
    );

    await page.getByRole("button", { name: "All repository PRs" }).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Open provider result"));
    await page.getByRole("button", { name: "Enable auto-merge…" }).click();
    await page.getByRole("button", { name: "Enable auto-merge", exact: true }).click();
    await vi.waitFor(() =>
      expect(mutatePullRequest).toHaveBeenCalledWith({
        cwd: "/workspace",
        reference: "41",
        action: "enable_auto_merge",
        mergeMethod: "squash",
      }),
    );
    await page.getByRole("button", { name: "Details" }).click();
    await page.getByRole("button", { name: "Edit title and description" }).click();
    await page.getByRole("textbox", { name: "Title" }).fill("Updated provider title");
    await page.getByRole("textbox", { name: "Description" }).fill("Updated provider description");
    await page.getByRole("button", { name: "Save changes" }).click();
    await vi.waitFor(() =>
      expect(mutatePullRequest).toHaveBeenCalledWith({
        cwd: "/workspace",
        reference: "41",
        action: "edit_pull_request",
        title: "Updated provider title",
        body: "Updated provider description",
      }),
    );
    await page.getByRole("button", { name: "merged" }).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Merged provider result"));
    expect(listPullRequests).toHaveBeenCalledWith({
      cwd: "/workspace",
      state: "merged",
      limit: 50,
    });
  });

  it("submits pull request search only when the provider advertises it", async () => {
    const capabilities = {
      provider: "bitbucket" as const,
      diff: true,
      create: true,
      search: true,
      actions: [] as const,
      mergeMethods: ["merge", "squash", "rebase"] as const,
    };
    const pullRequest = {
      provider: "bitbucket" as const,
      number: 7,
      title: "Provider search result",
      url: "https://bitbucket.org/tabs/example/pull-requests/7",
      baseBranch: "main",
      headBranch: "feature/search",
      state: "open" as const,
    };
    const listPullRequests = vi.fn().mockResolvedValue({
      pullRequests: [pullRequest],
      hasMore: false,
      capabilities,
    });
    const api = {
      git: {
        listPullRequests,
        resolvePullRequest: vi.fn().mockResolvedValue({ pullRequest, capabilities }),
      },
    } as unknown as NativeApi;
    vi.mocked(environmentApi).mockResolvedValue(api);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await using _ = await mount(
      <QueryClientProvider client={queryClient}>
        <GitApiProvider api={api} scopeKey="bitbucket-pr-environment">
          <PRsPanel
            cwd="/workspace"
            environmentId="bitbucket-pr-environment"
            branchName="feature/search"
            onOpenCreatePR={vi.fn()}
          />
        </GitApiProvider>
      </QueryClientProvider>,
    );

    await page.getByRole("button", { name: "All repository PRs" }).click();
    await page.getByRole("searchbox", { name: "Search pull requests" }).fill('fix "auth"');
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await vi.waitFor(() =>
      expect(listPullRequests).toHaveBeenCalledWith({
        cwd: "/workspace",
        state: "all",
        limit: 50,
        query: 'fix "auth"',
      }),
    );
  });
});

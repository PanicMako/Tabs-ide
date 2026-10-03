import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectId, ProviderInstanceId, type TestingGenerationJob } from "@tabs/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TestingDataContextValue } from "./context";

const mocks = vi.hoisted(() => ({
  data: null as TestingDataContextValue | null,
  readArtifact: vi.fn(),
}));

vi.mock("./context", () => ({
  useTestingData: () => mocks.data,
}));

vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({ testing: { readArtifact: mocks.readArtifact } }),
}));

vi.mock("~/editorPreferences", () => ({
  openInPreferredEditor: vi.fn(),
}));

vi.mock("~/components/ui/badge", async () => {
  const React = await import("react");
  return {
    Badge: (props: React.HTMLAttributes<HTMLSpanElement>) => React.createElement("span", props),
  };
});

vi.mock("~/components/ui/button", async () => {
  const React = await import("react");
  return {
    Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.createElement("button", props),
  };
});

vi.mock("~/components/ui/card", async () => {
  const React = await import("react");
  const Div = (props: React.HTMLAttributes<HTMLDivElement>) => React.createElement("div", props);
  return { Card: Div, CardContent: Div, CardDescription: Div, CardHeader: Div, CardTitle: Div };
});

vi.mock("~/components/ui/input", async () => {
  const React = await import("react");
  return {
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
      React.createElement("input", props),
  };
});

vi.mock("~/components/ui/select", async () => {
  const React = await import("react");
  const Div = (props: React.HTMLAttributes<HTMLDivElement>) => React.createElement("div", props);
  return { Select: Div, SelectItem: Div, SelectPopup: Div, SelectTrigger: Div, SelectValue: Div };
});

vi.mock("~/components/ui/switch", async () => {
  const React = await import("react");
  return {
    Switch: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.createElement("button", props),
  };
});

vi.mock("~/lib/utils", () => ({
  cn: (...values: ReadonlyArray<unknown>) => values.filter(Boolean).join(" "),
}));

import { TestingRuns } from "./TestingRuns";

const projectId = ProjectId.makeUnsafe("project-a");

function makeJob(specPath: string): TestingGenerationJob {
  return {
    id: "job-1",
    projectId,
    status: "completed",
    engine: "standard",
    stage: "validated",
    attemptCount: 1,
    usageMeasured: false,
    framework: "playwright-ts",
    modelSelection: {
      instanceId: ProviderInstanceId.makeUnsafe("codex"),
      model: "gpt-5",
    },
    outputDirectory: specPath.slice(0, specPath.lastIndexOf("/")),
    totalCases: 1,
    completedCases: 1,
    estimatedTokens: 10,
    estimatedCostUsd: 0,
    error: null,
    artifacts: [
      {
        caseId: "case-1",
        externalId: "TC-00001",
        featureSlug: "preview-artifact",
        specPath,
        pageObjectPath: specPath.replace(".spec.ts", ".page.ts"),
        dataPath: specPath.replace(".spec.ts", ".data.ts"),
        fingerprintCount: 0,
      },
    ],
  };
}

async function renderPreview(specPath: string, contents: string) {
  const job = makeJob(specPath);
  mocks.data = {
    projectId,
    projectPath: "/workspace/project-a",
    cases: [],
    locatorLibrary: null,
    completedGenerationJob: job,
    latestExecutionRun: null,
    executionRuns: [],
    normalizedTarget: "https://example.test/",
    busyAction: null,
    runGeneratedTests: vi.fn(),
    executionMode: "standalone",
    setExecutionMode: vi.fn(),
    visualComparison: false,
    setVisualComparison: vi.fn(),
    scheduleTime: "09:00",
    setScheduleTime: vi.fn(),
    createSchedule: vi.fn(),
    testingSchedules: [],
  } as unknown as TestingDataContextValue;
  mocks.readArtifact.mockResolvedValue({ contents });
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    queryKey: ["testing", "artifact", projectId, job.id, "case-1", "spec"],
    queryFn: () =>
      mocks.readArtifact({
        projectId,
        generationJobId: job.id,
        caseId: "case-1",
        artifactKind: "spec",
      }),
  });
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TestingRuns />
    </QueryClientProvider>,
  );
  return { markup, queryClient };
}

beforeEach(() => {
  mocks.readArtifact.mockReset();
});

describe("TestingRuns artifact preview", () => {
  it("renders a managed artifact outside the project", async () => {
    const { markup, queryClient } = await renderPreview(
      "/Users/example/.tabs/dev/testing/generated/project/job/specs/case.spec.ts",
      "export const managedPreview = true;",
    );
    expect(markup).toContain("export const managedPreview = true;");
    expect(markup).not.toContain("outside the project");
    expect(mocks.readArtifact).toHaveBeenCalledWith({
      projectId,
      generationJobId: "job-1",
      caseId: "case-1",
      artifactKind: "spec",
    });
    queryClient.clear();
  });

  it("renders a repository artifact through the same Testing operation", async () => {
    const { markup, queryClient } = await renderPreview(
      "/workspace/project-a/tests/e2e/generated/specs/case.spec.ts",
      "export const repositoryPreview = true;",
    );
    expect(markup).toContain("export const repositoryPreview = true;");
    expect(markup).not.toContain("outside the project");
    expect(mocks.readArtifact).toHaveBeenCalledWith({
      projectId,
      generationJobId: "job-1",
      caseId: "case-1",
      artifactKind: "spec",
    });
    queryClient.clear();
  });
});

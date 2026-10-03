import React, { memo, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FileCode2Icon,
  FolderIcon,
  LoaderIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchIcon,
  Settings2Icon,
} from "lucide-react";
import type { TestingGeneratedArtifact } from "@tabs/contracts";
import { openInPreferredEditor } from "~/editorPreferences";
import { ensureNativeApi } from "~/nativeApi";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";
import { useTestingData } from "./context";

type ArtifactFile = {
  id: string;
  label: string;
  kind: "spec" | "page" | "data" | "locator";
  path: string;
  caseId: string;
};
const fileName = (path: string) =>
  path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path;
function statusTone(status?: string) {
  if (status === "passed") return "bg-emerald-500";
  if (status === "failed") return "bg-destructive";
  if (status === "running") return "bg-blue-500";
  return "border border-muted-foreground/50 bg-background";
}

export const TestingRuns = memo(function TestingRuns() {
  const data = useTestingData();
  const [filter, setFilter] = useState("");
  const [concurrency, setConcurrency] = useState(1);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<ArtifactFile | null>(null);
  const artifacts = data.completedGenerationJob?.artifacts ?? [];
  const casesById = useMemo(() => new Map(data.cases.map((item) => [item.id, item])), [data.cases]);
  const resultsById = useMemo(
    () => new Map((data.latestExecutionRun?.results ?? []).map((item) => [item.caseId, item])),
    [data.latestExecutionRun],
  );
  const locatorEntries = useMemo(
    () =>
      new Map(
        (data.locatorLibrary?.pages ?? [])
          .flatMap((page) => page.entries)
          .map((entry) => [entry.id, entry]),
      ),
    [data.locatorLibrary],
  );
  const filesFor = (artifact: TestingGeneratedArtifact): ArtifactFile[] => {
    const locatorPaths = [
      ...new Set(
        (casesById.get(artifact.caseId)?.locatorEntryIds ?? [])
          .map((id) => locatorEntries.get(id)?.sourceFile)
          .filter((path): path is string => Boolean(path)),
      ),
    ];
    return [
      {
        id: `${artifact.caseId}:spec`,
        label: fileName(artifact.specPath),
        kind: "spec",
        path: artifact.specPath,
        caseId: artifact.caseId,
      },
      {
        id: `${artifact.caseId}:page`,
        label: fileName(artifact.pageObjectPath),
        kind: "page",
        path: artifact.pageObjectPath,
        caseId: artifact.caseId,
      },
      {
        id: `${artifact.caseId}:data`,
        label: fileName(artifact.dataPath),
        kind: "data",
        path: artifact.dataPath,
        caseId: artifact.caseId,
      },
      ...locatorPaths.map((path, index) => ({
        id: `${artifact.caseId}:locator:${index}`,
        label: fileName(path),
        kind: "locator" as const,
        path,
        caseId: artifact.caseId,
      })),
    ];
  };
  const groups = useMemo(() => {
    const output = new Map<string, TestingGeneratedArtifact[]>();
    const query = filter.trim().toLowerCase();
    for (const artifact of artifacts) {
      const item = casesById.get(artifact.caseId);
      if (
        query &&
        !`${artifact.externalId} ${item?.description} ${item?.groupName}`
          .toLowerCase()
          .includes(query)
      )
        continue;
      const name = item?.groupName || "Ungrouped";
      output.set(name, [...(output.get(name) ?? []), artifact]);
    }
    return [...output.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [artifacts, casesById, filter]);
  const effectiveFile = selectedFile ?? (artifacts[0] ? filesFor(artifacts[0])[0] : null);
  const completedJobId = data.completedGenerationJob?.id ?? null;
  const fileQuery = useQuery({
    queryKey: [
      "testing",
      "artifact",
      data.projectId,
      completedJobId,
      effectiveFile?.caseId,
      effectiveFile?.kind,
    ],
    queryFn: () => {
      if (!completedJobId || !effectiveFile || effectiveFile.kind === "locator") {
        throw new Error("Generated artifact preview is unavailable.");
      }
      return ensureNativeApi().testing.readArtifact({
        projectId: data.projectId,
        generationJobId: completedJobId,
        caseId: effectiveFile.caseId,
        artifactKind: effectiveFile.kind,
      });
    },
    enabled: Boolean(completedJobId && effectiveFile && effectiveFile.kind !== "locator"),
  });
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const canRun = Boolean(
    data.normalizedTarget && data.completedGenerationJob && data.busyAction === null,
  );

  return (
    <section aria-labelledby="testing-execution-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="testing-execution-heading" className="text-lg font-semibold">
            Test explorer
          </h2>
          <p className="text-sm text-muted-foreground">
            Browse generated Playwright tests, inspect their source, and run all tests or one case.
            Use parallel cases only when tests have independent accounts and data.
          </p>
        </div>
        <div className="flex gap-1" aria-label="Test explorer actions">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Parallel cases</span>
            <Select
              value={String(concurrency)}
              disabled={!canRun}
              onValueChange={(value) => {
                if (value) setConcurrency(Number(value));
              }}
            >
              <SelectTrigger aria-label="Parallel test cases" className="h-8 w-16">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {[1, 2, 3, 4].map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <Button
            size="sm"
            onClick={() => void data.runGeneratedTests(undefined, concurrency)}
            disabled={!canRun}
          >
            {data.busyAction === "run-tests" ? (
              <LoaderIcon aria-hidden="true" className="animate-spin" />
            ) : (
              <PlayIcon aria-hidden="true" />
            )}
            Run all
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => void data.runGeneratedTests(undefined, concurrency)}
            disabled={!canRun}
            aria-label="Rerun all generated tests"
            title="Rerun all"
          >
            <RotateCcwIcon aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() =>
              data.completedGenerationJob &&
              void openInPreferredEditor(
                ensureNativeApi(),
                data.completedGenerationJob.outputDirectory,
              )
            }
            disabled={!data.completedGenerationJob}
            aria-label="Open generated tests folder"
            title="Open generated folder"
          >
            <ExternalLinkIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
      <Card className="overflow-hidden">
        <div className="grid min-h-[36rem] lg:grid-cols-[minmax(20rem,0.85fr)_minmax(0,1.5fr)]">
          <aside
            className="border-b border-border lg:border-b-0 lg:border-r"
            aria-label="Generated test tree"
          >
            <div className="border-b p-3">
              <label htmlFor="test-tree-filter" className="sr-only">
                Filter tests
              </label>
              <div className="relative">
                <SearchIcon
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground z-10"
                />
                <Input
                  id="test-tree-filter"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filter tests"
                  className="pl-9"
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
                {artifacts.length} generated tests ·{" "}
                {data.latestExecutionRun
                  ? `${data.latestExecutionRun.status} last run`
                  : "not run yet"}
              </p>
            </div>
            <div className="max-h-[44rem] overflow-auto p-2">
              {groups.length ? (
                <ul aria-label="Test groups">
                  {groups.map(([group, items]) => (
                    <li key={group}>
                      <button
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium hover:bg-muted"
                        onClick={() => toggle(`group:${group}`)}
                        aria-expanded={!collapsed.has(`group:${group}`)}
                      >
                        {collapsed.has(`group:${group}`) ? (
                          <ChevronRightIcon aria-hidden="true" className="size-4" />
                        ) : (
                          <ChevronDownIcon aria-hidden="true" className="size-4" />
                        )}
                        <FolderIcon aria-hidden="true" className="size-4" />
                        <span className="flex-1 truncate">{group}</span>
                        <span className="text-xs text-muted-foreground">{items.length}</span>
                      </button>
                      {!collapsed.has(`group:${group}`) ? (
                        <ul className="ml-4 border-l pl-2">
                          {items.map((artifact) => {
                            const item = casesById.get(artifact.caseId);
                            const result = resultsById.get(artifact.caseId);
                            return (
                              <li key={artifact.caseId}>
                                <div className="group flex items-center rounded-md hover:bg-muted">
                                  <button
                                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                                    onClick={() => toggle(artifact.caseId)}
                                    aria-expanded={!collapsed.has(artifact.caseId)}
                                  >
                                    {collapsed.has(artifact.caseId) ? (
                                      <ChevronRightIcon aria-hidden="true" className="size-4" />
                                    ) : (
                                      <ChevronDownIcon aria-hidden="true" className="size-4" />
                                    )}
                                    <span
                                      aria-hidden="true"
                                      className={cn(
                                        "size-2.5 rounded-full",
                                        statusTone(result?.status),
                                      )}
                                    />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-medium">
                                        {artifact.externalId}
                                      </span>
                                      <span className="block truncate text-xs text-muted-foreground">
                                        {item?.description ?? artifact.featureSlug}
                                      </span>
                                    </span>
                                    {result ? (
                                      <span className="text-[11px] text-muted-foreground">
                                        {result.durationMs}ms
                                      </span>
                                    ) : null}
                                  </button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="mr-1 size-8"
                                    onClick={() => void data.runGeneratedTests([artifact.caseId])}
                                    disabled={!canRun}
                                    aria-label={`Run ${artifact.externalId}`}
                                  >
                                    <PlayIcon aria-hidden="true" className="size-4" />
                                  </Button>
                                </div>
                                {!collapsed.has(artifact.caseId) ? (
                                  <ul className="ml-7 border-l pl-2">
                                    {filesFor(artifact).map((file) => (
                                      <li key={file.id}>
                                        <button
                                          className={cn(
                                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted",
                                            effectiveFile?.id === file.id &&
                                              "bg-primary/10 text-foreground",
                                          )}
                                          onClick={() => setSelectedFile(file)}
                                          aria-current={
                                            effectiveFile?.id === file.id ? "true" : undefined
                                          }
                                        >
                                          <FileCode2Icon aria-hidden="true" className="size-3.5" />
                                          <span className="truncate">{file.label}</span>
                                          <span className="ml-auto text-[9px] uppercase text-muted-foreground">
                                            {file.kind}
                                          </span>
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {artifacts.length
                    ? "No tests match this filter."
                    : "Build accepted cases to populate the explorer."}
                </p>
              )}
            </div>
          </aside>
          <div className="min-w-0 bg-muted/10">
            {effectiveFile ? (
              <div className="flex h-full flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{effectiveFile.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{effectiveFile.path}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void data.runGeneratedTests([effectiveFile.caseId])}
                      disabled={!canRun}
                    >
                      <PlayIcon aria-hidden="true" />
                      Run test
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void openInPreferredEditor(ensureNativeApi(), effectiveFile.path)
                      }
                    >
                      <ExternalLinkIcon aria-hidden="true" />
                      Open file
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto" aria-live="polite">
                  {effectiveFile.kind === "locator" ? (
                    <p className="p-6 text-sm text-muted-foreground">
                      Open this locator source in the editor to inspect it.
                    </p>
                  ) : fileQuery.isLoading ? (
                    <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                      <LoaderIcon aria-hidden="true" className="animate-spin" />
                      Loading source…
                    </p>
                  ) : fileQuery.isError ? (
                    <p className="p-6 text-sm text-destructive">
                      Could not read this generated artifact. It may have been deleted or replaced
                      since the last build.
                    </p>
                  ) : (
                    <pre
                      tabIndex={0}
                      aria-label={`${effectiveFile.label} source code`}
                      className="min-h-full overflow-auto p-5 font-mono text-xs leading-6"
                    >
                      <code>{fileQuery.data?.contents ?? ""}</code>
                    </pre>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[36rem] items-center justify-center p-8 text-sm text-muted-foreground">
                Select a generated file to inspect its code.
              </div>
            )}
          </div>
        </div>
      </Card>
      <details className="rounded-xl border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-medium">
          <Settings2Icon aria-hidden="true" className="size-4" />
          Run settings and schedules
        </summary>
        <div className="space-y-5 border-t p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="testing-execution-mode" className="text-sm font-medium">
                Operating mode
              </label>
              <Select
                value={data.executionMode}
                onValueChange={(value) => data.setExecutionMode(value as "standalone" | "ci")}
              >
                <SelectTrigger id="testing-execution-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="standalone">Standalone / UAT</SelectItem>
                  <SelectItem value="ci">CI release gate</SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <label htmlFor="testing-visual-comparison" className="text-sm font-medium">
                Visual comparison
              </label>
              <Switch
                id="testing-visual-comparison"
                checked={data.visualComparison}
                onCheckedChange={data.setVisualComparison}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label htmlFor="testing-schedule-time" className="text-sm font-medium">
                One-off local schedule
              </label>
              <Input
                id="testing-schedule-time"
                type="datetime-local"
                value={data.scheduleTime}
                onChange={(event) => data.setScheduleTime(event.target.value)}
              />
            </div>
            <Button
              variant="outline"
              className="self-end"
              onClick={() => void data.createTestingSchedule()}
              disabled={!data.scheduleTime || !canRun}
            >
              Schedule run
            </Button>
          </div>
          {data.testingSchedules.length ? (
            <ul className="text-xs text-muted-foreground" aria-label="Local schedules">
              {data.testingSchedules.map((schedule) => (
                <li key={schedule.id}>
                  {new Date(schedule.nextRunAt).toLocaleString()} · {schedule.timezone} ·{" "}
                  {schedule.recurrence}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
      {data.executionRuns.map((run) => (
        <Card key={run.id}>
          <CardHeader>
            <div className="flex justify-between">
              <div>
                <CardTitle className="text-base">
                  {run.mode === "ci" ? "CI" : "Standalone"} round
                </CardTitle>
                <CardDescription>
                  {run.results.length} cases · {(run.durationMs / 1000).toFixed(1)} seconds
                </CardDescription>
              </div>
              <Badge variant={run.status === "passed" ? "success" : "outline"}>{run.status}</Badge>
              {run.results.some(
                (result) => result.status === "failed" || result.status === "blocked",
              ) ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.busyAction !== null}
                    onClick={() => void data.generateTests(run.id)}
                  >
                    Rebuild failed cases with evidence
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      data.busyAction !== null ||
                      run.results.filter(
                        (result) => result.status === "failed" || result.status === "blocked",
                      ).length !== 1
                    }
                    onClick={() => void data.generateTests(run.id, "official-playwright")}
                  >
                    Propose repair with official tools (AI usage)
                  </Button>
                </>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {run.results.map((result) => (
                <li key={result.caseId} className="text-sm text-muted-foreground">
                  {result.externalId}: {result.status} · {result.durationMs}ms
                  {result.error ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer">Failure details</summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
                        {result.error}
                      </pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </section>
  );
});

export default TestingRuns;

import React, { memo } from "react";
import { ArrowRightIcon, FolderSearchIcon, GlobeIcon, HistoryIcon } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { useTestingData } from "./context";
import type { TestingWorkspaceSection } from "./types";

interface TestingOverviewProps {
  onNavigate: (section: TestingWorkspaceSection) => void;
  recommendedTestingSection: TestingWorkspaceSection;
  testingSections: ReadonlyArray<{
    id: TestingWorkspaceSection;
    label: string;
    description: string;
    count?: number;
  }>;
}

export const TestingOverview = memo(function TestingOverview({
  onNavigate,
  recommendedTestingSection,
  testingSections,
}: TestingOverviewProps) {
  const {
    caseIdPrefix,
    setCaseIdPrefix,
    caseIdPadding,
    setCaseIdPadding,
    caseIdNext,
    setCaseIdNext,
    saveCaseIdPolicy,
    caseIdPolicy,
    status,
    cases,
    executionRuns,
    reviewCaseCount,
    acceptedCaseCount,
    blockedCaseCount,
  } = useTestingData();

  return (
    <section aria-labelledby="testing-start-heading" className="space-y-5">
      <div className="space-y-1">
        <h2 id="testing-start-heading" className="text-xl font-semibold text-foreground">
          What are you here to do?
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Pick the closest starting point. You can move between steps without losing imported cases,
          graph data, or previous runs.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Case ID format</CardTitle>
          <CardDescription>
            Imported IDs remain unchanged. This format applies only to newly generated cases.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[minmax(8rem,1fr)_8rem_9rem_auto] sm:items-end">
          <div className="space-y-2">
            <label htmlFor="testing-case-prefix" className="text-sm font-medium">
              Prefix
            </label>
            <Input
              id="testing-case-prefix"
              value={caseIdPrefix}
              onChange={(event) => setCaseIdPrefix(event.target.value)}
              placeholder="TC-"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="testing-case-padding" className="text-sm font-medium">
              Digits
            </label>
            <Input
              id="testing-case-padding"
              type="number"
              min={1}
              max={12}
              value={caseIdPadding}
              onChange={(event) => setCaseIdPadding(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="testing-case-next" className="text-sm font-medium">
              Next number
            </label>
            <Input
              id="testing-case-next"
              type="number"
              min={1}
              value={caseIdNext}
              onChange={(event) => setCaseIdNext(event.target.value)}
            />
          </div>
          <Button type="button" variant="outline" onClick={() => void saveCaseIdPolicy()}>
            Save format
          </Button>
          <p className="text-xs text-muted-foreground sm:col-span-4">
            Next generated ID:{" "}
            <span className="font-mono text-foreground">{caseIdPolicy?.example ?? "TC-00001"}</span>
            . Leave the prefix blank for numeric-only IDs.
          </p>
        </CardContent>
      </Card>
      <div className="grid gap-4 xl:grid-cols-3">
        {/* Card 1: I have a test plan */}
        <button
          type="button"
          onClick={() => onNavigate("cases")}
          className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-card p-5 text-left shadow-sm transition-all duration-200 hover:border-primary/50 hover:bg-muted/20 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            aria-hidden="true"
          />
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-foreground">
                <FolderSearchIcon aria-hidden="true" className="size-5" />
              </div>
              <Badge variant="success">Best for QA batches</Badge>
            </div>
            <span className="mt-4 block text-base font-semibold text-foreground">
              I have a test plan
            </span>
            <span className="mt-2 block text-sm leading-6 text-muted-foreground">
              Import an Excel workbook, map its case IDs to the live app, and review only
              differences or blocked steps.
            </span>
          </div>
          <span className="mt-5 flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground">
            <span>Open case workspace</span>
            <ArrowRightIcon
              aria-hidden="true"
              className="size-4 transition-transform group-hover:translate-x-1"
            />
          </span>
        </button>

        {/* Card 2: I need to understand an app */}
        <button
          type="button"
          onClick={() => onNavigate("discover")}
          className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-card p-5 text-left shadow-sm transition-all duration-200 hover:border-sky-500/50 hover:bg-muted/20 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-sky-500/40 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            aria-hidden="true"
          />
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-500">
                <GlobeIcon aria-hidden="true" className="size-5" />
              </div>
              <Badge
                variant="outline"
                className="border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400"
              >
                App Discovery
              </Badge>
            </div>
            <span className="mt-4 block text-base font-semibold text-foreground">
              I need to understand an app
            </span>
            <span className="mt-2 block text-sm leading-6 text-muted-foreground">
              Connect a web or Electron target and explore one page, one section, or the whole
              origin with safe limits.
            </span>
          </div>
          <span className="mt-5 flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground">
            <span>Set up discovery</span>
            <ArrowRightIcon
              aria-hidden="true"
              className="size-4 transition-transform group-hover:translate-x-1"
            />
          </span>
        </button>

        {/* Card 3: Continue this workspace */}
        <button
          type="button"
          onClick={() => onNavigate(recommendedTestingSection)}
          disabled={recommendedTestingSection === "discover" && (status?.nodeCount ?? 0) === 0}
          className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-card p-5 text-left shadow-sm transition-all duration-200 hover:border-violet-500/50 hover:bg-muted/20 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span
            className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-violet-500/40 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            aria-hidden="true"
          />
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-500">
                <HistoryIcon aria-hidden="true" className="size-5" />
              </div>
              <Badge
                variant="outline"
                className="border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400"
              >
                Local Session
              </Badge>
            </div>
            <span className="mt-4 block text-base font-semibold text-foreground">
              Continue this workspace
            </span>
            <span className="mt-2 block text-sm leading-6 text-muted-foreground">
              Resume {status?.nodeCount ?? 0} states, {cases.length} cases, and{" "}
              {executionRuns.length} runs already stored locally.
            </span>
          </div>
          <span className="mt-5 flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground">
            <span>
              Continue to{" "}
              {testingSections.find((section) => section.id === recommendedTestingSection)?.label}
            </span>
            <ArrowRightIcon
              aria-hidden="true"
              className="size-4 transition-transform group-hover:translate-x-1"
            />
          </span>
        </button>
      </div>

      <Card>
        <CardContent className="grid gap-4 py-5 sm:grid-cols-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <span className="text-xl font-bold">{reviewCaseCount}</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Need your review</div>
              <div className="text-xs text-muted-foreground">Pending manual or diff triage</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <span className="text-xl font-bold">{acceptedCaseCount}</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Ready to automate</div>
              <div className="text-xs text-muted-foreground">Accepted & verified cases</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <span className="text-xl font-bold">{blockedCaseCount}</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Blocked or unreachable</div>
              <div className="text-xs text-muted-foreground">Requires locator or spec fix</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
});

export default TestingOverview;

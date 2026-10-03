import React, { memo } from "react";
import { ExternalLinkIcon, FileCheck2Icon, LoaderIcon, SearchIcon } from "lucide-react";
import { openInPreferredEditor } from "~/editorPreferences";
import { ensureNativeApi } from "~/nativeApi";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { useTestingData } from "./context";

export const TestingReports = memo(function TestingReports() {
  const {
    testerName,
    setTesterName,
    busyAction,
    generateSignoffReport,
    executionRuns,
    reportPaths,
    traceCaseId,
    setTraceCaseId,
    resolveTraceability,
    traceability,
    bugDraft,
    triageResult,
    graphExplorer,
  } = useTestingData();

  return (
    <section aria-labelledby="testing-reporting-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="testing-reporting-heading" className="text-lg font-semibold text-foreground">
          Reports
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Export a shareable result or look up everything recorded for one test case.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2" aria-label="Available report actions">
        <div className="flex gap-3 rounded-xl border border-border/70 bg-card p-4">
          <FileCheck2Icon aria-hidden="true" className="mt-0.5 size-5 text-foreground" />
          <div>
            <p className="text-sm font-semibold">Share the latest run</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Generate Word and PDF files after a standalone test run completes.
            </p>
          </div>
        </div>
        <div className="flex gap-3 rounded-xl border border-border/70 bg-card p-4">
          <SearchIcon aria-hidden="true" className="mt-0.5 size-5 text-foreground" />
          <div>
            <p className="text-sm font-semibold">Investigate one test</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Enter its exact ID to see its source, generated files, runs, and locator decisions.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>1. Export the latest results</CardTitle>
            <CardDescription>
              Creates matching Word and PDF reports from the latest completed Standalone round.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="testing-tester-name" className="text-sm font-medium">
                Tester name
              </label>
              <Input
                id="testing-tester-name"
                value={testerName}
                onChange={(event) => setTesterName(event.target.value)}
                disabled={busyAction !== null}
              />
            </div>
            <Button
              type="button"
              onClick={() => void generateSignoffReport()}
              disabled={
                busyAction !== null ||
                !testerName.trim() ||
                !executionRuns.some((run) => run.mode === "standalone" && run.completedAt)
              }
            >
              {busyAction === "report" ? (
                <LoaderIcon aria-hidden="true" className="animate-spin" />
              ) : null}
              Generate Word and PDF
            </Button>
            {reportPaths ? (
              <div className="flex flex-wrap gap-2" role="status">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void openInPreferredEditor(ensureNativeApi(), reportPaths.docxPath)
                  }
                >
                  <ExternalLinkIcon aria-hidden="true" />
                  Open Word report
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void openInPreferredEditor(ensureNativeApi(), reportPaths.pdfPath)}
                >
                  <ExternalLinkIcon aria-hidden="true" />
                  Open PDF report
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Trace one test case</CardTitle>
            <CardDescription>
              Use the original Excel ID or generated scenario ID; partial matches are not guessed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="testing-trace-case-id" className="text-sm font-medium">
                Case ID
              </label>
              <Input
                id="testing-trace-case-id"
                value={traceCaseId}
                onChange={(event) => setTraceCaseId(event.target.value)}
                placeholder="QA-0042"
                disabled={busyAction !== null}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void resolveTraceability()}
              disabled={busyAction !== null || !traceCaseId.trim()}
            >
              Show test history
            </Button>
            {traceability ? (
              <div className="space-y-2 rounded-lg border border-border/70 p-4 text-sm">
                <p className="font-medium">
                  {traceability.case.externalId}: {traceability.case.description}
                </p>
                <p className="text-muted-foreground">
                  Current status: {traceability.case.standaloneStatus} ·{" "}
                  {traceability.generatedArtifacts.length} generated artifacts ·{" "}
                  {traceability.executions.length} executions · {traceability.healing.length}{" "}
                  healing decisions
                </p>
                {traceability.import ? (
                  <p className="break-all text-xs text-muted-foreground">
                    Workbook: {traceability.import.workbookName} ({traceability.import.workbookPath}
                    )
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {bugDraft ? (
        <Card>
          <CardHeader>
            <CardTitle>Local bug draft</CardTitle>
            <CardDescription>
              Review this draft. Testing will not file or transmit it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-xs">
              {bugDraft}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      {triageResult ? (
        <Card>
          <CardHeader>
            <CardTitle>Coding-agent triage</CardTitle>
            <CardDescription>
              Model inference is advisory and is kept separate from persisted observed facts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-xs">
              {triageResult}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      <details className="rounded-xl border border-border bg-card">
        <summary className="cursor-pointer px-6 py-5 text-base font-semibold">
          Advanced: discovered application states
        </summary>
        <Card className="rounded-none border-x-0 border-b-0 shadow-none">
          <CardHeader>
            <CardTitle>State graph explorer</CardTitle>
            <CardDescription>
              Accessible list alternative showing URLs, stored accessibility snapshots, linked
              cases, and transitions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-96 overflow-auto rounded-lg border border-border/70">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Stored application states and linked cases</caption>
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th scope="col" className="p-3">
                      State
                    </th>
                    <th scope="col" className="p-3">
                      URL and snapshot
                    </th>
                    <th scope="col" className="p-3">
                      Linked cases
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(graphExplorer?.nodes ?? []).map((node) => (
                    <tr key={node.stateId} className="border-t border-border/70 align-top">
                      <th scope="row" className="p-3 font-medium">
                        {node.pageTitle || node.stateId}
                      </th>
                      <td className="p-3">
                        <div className="break-all text-muted-foreground">{node.pageUrl}</div>
                        <pre className="mt-2 max-w-xl whitespace-pre-wrap">
                          {node.snapshot.slice(0, 500)}
                        </pre>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {node.linkedCaseIds.join(", ") || "None"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground" role="status">
              {graphExplorer?.nodes.length ?? 0} states and {graphExplorer?.edges.length ?? 0}{" "}
              transitions loaded.
            </p>
          </CardContent>
        </Card>
      </details>
    </section>
  );
});

export default TestingReports;

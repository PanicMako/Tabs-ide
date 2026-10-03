import React, { memo, useState } from "react";
import type { ModelSlug } from "@tabs/contracts";
import { LoaderIcon, WorkflowIcon } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { FusedModelPicker } from "~/components/chat/FusedModelPicker";
import { openInPreferredEditor } from "~/editorPreferences";
import { ensureNativeApi } from "~/nativeApi";
import { useTestingData } from "./context";
import type { TestingWorkspaceSection } from "./types";

interface TestingAutomateProps {
  onNavigate: (section: TestingWorkspaceSection) => void;
}

export const TestingAutomate = memo(function TestingAutomate({ onNavigate }: TestingAutomateProps) {
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
  const {
    selectedGenerationCaseIds,
    setSelectedGenerationCaseIds,
    readyCases,
    generationOutputMode,
    setGenerationOutputMode,
    repositoryOutputPath,
    setRepositoryOutputPath,
    templatePath,
    setTemplatePath,
    busyAction,
    generationFusionProvider,
    generationModelSelection,
    fusionProviders,
    updateTestingFusionModel,
    updateTestingFusionOptions,
    generationReasoning,
    generationMaxCases,
    setGenerationMaxCases,
    generationMaxTokens,
    setGenerationMaxTokens,
    generationMaxCost,
    setGenerationMaxCost,
    captureReplay,
    setCaptureReplay,
    generateTests,
    generationJobs,
    cancelGeneration,
  } = useTestingData();

  return (
    <section aria-labelledby="testing-generation-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="testing-generation-heading" className="text-lg font-semibold text-foreground">
          Automate reviewed cases
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Select accepted cases, then create Playwright TypeScript tests. Tabs uses the standard
          Page Object Model template by default.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>1. Choose reviewed cases</CardTitle>
              <CardDescription>
                Build only what you need now. Locator context mapped in Cases travels with each
                selected test.
              </CardDescription>
            </div>
            <Badge variant="secondary">
              {selectedGenerationCaseIds.size} of {readyCases.length} selected
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setSelectedGenerationCaseIds(new Set(readyCases.map((testCase) => testCase.id)))
              }
            >
              Select all ready
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSelectedGenerationCaseIds(new Set())}
            >
              Clear selection
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => onNavigate("cases")}>
              Review or add cases
            </Button>
          </div>
          <div className="max-h-64 overflow-auto rounded-xl border border-border/60">
            {readyCases.map((testCase) => (
              <label
                key={testCase.id}
                className="flex cursor-pointer items-start gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0 hover:bg-muted/40"
              >
                <Checkbox
                  checked={selectedGenerationCaseIds.has(testCase.id)}
                  onCheckedChange={(checked) => {
                    setSelectedGenerationCaseIds(
                      new Set(
                        checked
                          ? [...selectedGenerationCaseIds, testCase.id]
                          : [...selectedGenerationCaseIds].filter((id) => id !== testCase.id),
                      ),
                    );
                  }}
                  aria-label={`Build ${testCase.externalId}`}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {testCase.externalId}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {testCase.description}
                  </span>
                </span>
                <Badge variant="outline">{(testCase.locatorEntryIds ?? []).length} locators</Badge>
              </label>
            ))}
            {readyCases.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No reviewed cases are ready. Accept or edit a case before building tests.
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Build Playwright tests</CardTitle>
          <CardDescription>
            Your selected cases will be generated as page objects, test data, and business-flow
            specs using the built-in project setup.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 p-4">
            <div>
              <div className="text-sm font-medium text-foreground">Playwright TypeScript</div>
              <p className="mt-1 text-xs text-muted-foreground">
                The currently supported framework.
              </p>
            </div>
            <Badge variant="secondary">{selectedGenerationCaseIds.size} cases ready to build</Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="text-sm font-medium text-foreground">Generation model</div>
              <FusedModelPicker
                provider={generationFusionProvider}
                model={generationModelSelection.model as ModelSlug}
                lockedProvider={null}
                providers={fusionProviders as any}
                prompt=""
                onPromptChange={() => undefined}
                modelOptions={generationModelSelection.options}
                onProviderModelChange={updateTestingFusionModel}
                onModelOptionsChange={updateTestingFusionOptions}
                triggerClassName="w-full justify-between"
              />
              <div className="text-xs text-muted-foreground">
                <Badge variant="outline">{generationReasoning} reasoning</Badge>
              </div>
            </div>
            <div className="space-y-2">
              <label
                htmlFor="testing-generation-output"
                className="text-sm font-medium text-foreground"
              >
                Save generated test files to
              </label>
              <Select
                value={generationOutputMode}
                onValueChange={(value) =>
                  setGenerationOutputMode(value as "managed" | "repository")
                }
                disabled={busyAction !== null}
              >
                <SelectTrigger id="testing-generation-output" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="managed">Tabs-managed testing folder</SelectItem>
                  <SelectItem value="repository">A folder in this project</SelectItem>
                </SelectPopup>
              </Select>
              {generationOutputMode === "repository" ? (
                <Input
                  id="testing-repository-output"
                  value={repositoryOutputPath}
                  onChange={(event) => setRepositoryOutputPath(event.target.value)}
                  placeholder="tests/e2e/generated"
                  aria-label="Project-relative output folder"
                  disabled={busyAction !== null}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  The exact generated folder will be shown in the job below.
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted-foreground">
              Each selected case creates separate page-object, data, and spec files.
            </p>
            <Button
              type="button"
              onClick={() => void generateTests()}
              disabled={busyAction !== null || selectedGenerationCaseIds.size === 0}
              className="sm:shrink-0"
            >
              {busyAction === "generate-tests" ? (
                <LoaderIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <WorkflowIcon aria-hidden="true" />
              )}
              Build {selectedGenerationCaseIds.size || "selected"} test
              {selectedGenerationCaseIds.size === 1 ? "" : "s"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busyAction !== null || selectedGenerationCaseIds.size !== 1}
              onClick={() => void generateTests(undefined, "official-playwright")}
            >
              Build with official Playwright tools
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Official tools use the selected provider (currently Codex supported), perform the
            reviewed case in a headless browser, and save a managed candidate for review. Select one
            case. AI usage is billed or quota-metered by your provider; the estimated budget is not
            a hard spend limit. No provider is switched.
          </p>
          <div className="border-t border-border/60 pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={advancedOptionsOpen}
              aria-controls="testing-advanced-options"
              onClick={() => setAdvancedOptionsOpen((open) => !open)}
            >
              {advancedOptionsOpen ? "Hide advanced options" : "Advanced options"}
            </Button>
          </div>
          {advancedOptionsOpen ? (
            <div
              id="testing-advanced-options"
              className="space-y-5 rounded-xl border border-border/60 bg-muted/10 p-4"
            >
              <p className="text-xs leading-5 text-muted-foreground">
                Change these only when your team has a specific repository layout, template, or
                generation limit to apply.
              </p>
              <div className="space-y-2">
                <label
                  htmlFor="testing-template-path"
                  className="text-sm font-medium text-foreground"
                >
                  Custom template file
                </label>
                <Input
                  id="testing-template-path"
                  value={templatePath}
                  onChange={(event) => setTemplatePath(event.target.value)}
                  placeholder="testing/templates/company-playwright.json"
                  disabled={busyAction !== null}
                />
              </div>
              <div className="grid gap-5 sm:grid-cols-3">
                <div className="space-y-2">
                  <label htmlFor="testing-generation-max-cases" className="text-sm font-medium">
                    Maximum cases
                  </label>
                  <Input
                    id="testing-generation-max-cases"
                    type="number"
                    min={1}
                    value={generationMaxCases}
                    onChange={(event) => setGenerationMaxCases(event.target.value)}
                    disabled={busyAction !== null}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="testing-generation-max-tokens" className="text-sm font-medium">
                    Estimated token cap
                  </label>
                  <Input
                    id="testing-generation-max-tokens"
                    type="number"
                    min={1}
                    value={generationMaxTokens}
                    onChange={(event) => setGenerationMaxTokens(event.target.value)}
                    disabled={busyAction !== null}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="testing-generation-max-cost" className="text-sm font-medium">
                    Estimated USD cap
                  </label>
                  <Input
                    id="testing-generation-max-cost"
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={generationMaxCost}
                    onChange={(event) => setGenerationMaxCost(event.target.value)}
                    disabled={busyAction !== null}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 p-4">
                <div>
                  <label htmlFor="testing-network-replay" className="text-sm font-medium">
                    Capture sanitized network replay metadata
                  </label>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Off by default. Credentials, cookies, authorization headers, and response bodies
                    are never included.
                  </p>
                </div>
                <Switch
                  id="testing-network-replay"
                  checked={captureReplay}
                  onCheckedChange={setCaptureReplay}
                  disabled={busyAction !== null}
                />
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-3" aria-live="polite">
        {generationJobs.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No generation jobs yet. Choose accepted cases, a model, and an output folder, then
              select Build tests.
            </CardContent>
          </Card>
        ) : (
          generationJobs.map((job) => (
            <Card key={job.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Playwright TypeScript batch</CardTitle>
                    <CardDescription className="break-all">{job.outputDirectory}</CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {job.engine && job.engine !== "standard" ? (
                      <Badge variant="outline">{job.engine}</Badge>
                    ) : null}
                    {job.stage ? <Badge variant="secondary">{job.stage}</Badge> : null}
                    <Badge variant={job.status === "completed" ? "success" : "outline"}>
                      {job.status.replace("-", " ")}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {job.completedCases} of {job.totalCases} cases · approximately{" "}
                  {job.estimatedTokens.toLocaleString()} tokens ·{" "}
                  {job.usageMeasured
                    ? `approximately $${job.estimatedCostUsd.toFixed(2)}`
                    : "provider cost unmeasured"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Generated with {job.modelSelection.instanceId} / {job.modelSelection.model}
                </p>
                {job.error ? <p className="text-sm text-destructive">{job.error}</p> : null}
                {job.status === "queued" || job.status === "running" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void cancelGeneration(job.id)}
                    disabled={busyAction !== null}
                  >
                    Cancel generation
                  </Button>
                ) : null}
                {job.artifacts.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void openInPreferredEditor(ensureNativeApi(), job.outputDirectory)
                    }
                  >
                    Open generated files
                  </Button>
                ) : null}
                {job.artifacts.length > 0 ? (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {job.artifacts.map((artifact) => (
                      <li key={`${job.id}-${artifact.caseId}`}>
                        {artifact.externalId}: page, data, and spec generated with{" "}
                        {artifact.fingerprintCount} locator fingerprints
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </section>
  );
});

export default TestingAutomate;

import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { ModelSlug } from "@tabs/contracts";
import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CompassIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GlobeIcon,
  InfoIcon,
  LayersIcon,
  ListChecksIcon,
  ListPlusIcon,
  LoaderIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SquarePenIcon,
  Trash2Icon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { SegmentedControl } from "~/components/ui/segmented-control";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { FusedModelPicker } from "~/components/chat/FusedModelPicker";
import { openInPreferredEditor } from "~/editorPreferences";
import { ensureNativeApi } from "~/nativeApi";
import { cn } from "~/lib/utils";
import { useTestingData } from "./context";
import { TestingCaseLocatorPicker } from "./TestingWidgets";
import type { TestingCaseFilter, TestingCaseIntakeMode, TestingWorkspaceSection } from "./types";

function basenameOfPath(input: string): string {
  const parts = input.split(/[/\\]/g).filter(Boolean);
  return parts[parts.length - 1] ?? input;
}

interface AutoResizeStepInputProps {
  value: string;
  onChange: (value: string) => void;
  onEnterNext?: () => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  minHeight?: number;
  maxHeight?: number;
}

const AutoResizeStepInput = memo(function AutoResizeStepInput({
  value,
  onChange,
  onEnterNext,
  placeholder,
  ariaLabel,
  disabled,
  className,
  minHeight = 32,
  maxHeight = 160,
}: AutoResizeStepInputProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, minHeight, maxHeight]);

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onEnterNext?.();
        }
      }}
      className={cn(
        "w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-snug shadow-none outline-none focus:ring-0 focus-visible:outline-none placeholder:text-muted-foreground/50",
        className,
      )}
      style={{ minHeight: `${minHeight}px`, maxHeight: `${maxHeight}px` }}
    />
  );
});

interface TestingCasesProps {
  projectPath: string;
  onNavigate: (section: TestingWorkspaceSection) => void;
}

export const TestingCases = memo(function TestingCases({
  projectPath,
  onNavigate,
}: TestingCasesProps) {
  const [graphFeedback, setGraphFeedback] = useState<{
    type: "success" | "info" | "error";
    text: string;
  } | null>(null);
  const [workbookTargetGroup, setWorkbookTargetGroup] = useState("__sheet__");

  const {
    projectId,
    busyAction,
    setBusyAction,
    message_setter,
    setWorkspaceCases,
    caseIdPolicy,
    chooseWorkbook,
    setWorkbookPath,
    importWorkbook,
    workbookPath,
    caseIntakeMode,
    setCaseIntakeMode,
    manualCaseId,
    setManualCaseId,
    manualCaseDescription,
    setManualCaseDescription,
    manualCaseSteps,
    setManualCaseSteps,
    manualCaseExpectedResults,
    setManualCaseExpectedResults,
    manualCaseLocatorIds,
    setManualCaseLocatorIds,
    storyText,
    setStoryText,
    storyFilePath,
    setStoryFilePath,
    generationFusionProvider,
    generationModelSelection,
    fusionProviders,
    updateTestingFusionModel,
    updateTestingFusionOptions,
    status,
    generateScenarios,
    implementedInventoryOpen,
    setImplementedInventoryOpen,
    testInventoryView,
    setTestInventoryView,
    refreshTestingWorkspace,
    flattenedTestInventory,
    expandedTestNodes,
    selectedTestNodeId,
    setSelectedTestNodeId,
    testInventory,
    cases,
    caseGroups,
    reviewCaseCount,
    acceptedCaseCount,
    caseSearch,
    setCaseSearch,
    caseFilter,
    setCaseFilter,
    selectedGenerationCaseIds,
    setSelectedGenerationCaseIds,
    readyCases,
    filteredCases,
    selectedCase,
    setSelectedCaseId,
    editingCaseId,
    setEditingCaseId,
    editedExternalId,
    setEditedExternalId,
    editedDescription,
    setEditedDescription,
    editedSteps,
    setEditedSteps,
    updateEditedStep,
    moveEditedStep,
    editedCaseLocatorIds,
    setEditedCaseLocatorIds,
    editedExpectedResults,
    setEditedExpectedResults,
    reviewCase,
    deleteCase,
    updateCaseGroup,
    createCaseGroup,
    deleteCaseGroup,
    beginEditCase,
    locatorLibrary,
  } = useTestingData();

  const chooseStoryFile = useCallback(async () => {
    const selected = await ensureNativeApi().dialogs.pickFile({
      title: "Choose User Story Document",
      filters: [
        {
          name: "Story Documents (*.txt, *.md, *.docx, *.pdf)",
          extensions: ["txt", "md", "docx", "pdf"],
        },
      ],
    });
    if (selected) setStoryFilePath(selected);
  }, []);

  const createManualCase = useCallback(async () => {
    const populatedSteps = manualCaseSteps
      .map((step, index) => ({
        step: step.trim(),
        expectedResult: manualCaseExpectedResults[index]?.trim() ?? "",
      }))
      .filter((item) => item.step);
    const steps = populatedSteps.map((item) => item.step);
    const expectedResults = populatedSteps.map((item) => item.expectedResult);
    if (!manualCaseDescription.trim() || steps.length === 0) {
      message_setter("Add a description and at least one test step.");
      return;
    }
    setBusyAction("review");
    try {
      const result = await ensureNativeApi().testing.createCase({
        projectId,
        ...(manualCaseId.trim() ? { externalId: manualCaseId.trim() } : {}),
        description: manualCaseDescription.trim(),
        steps,
        expectedResults,
        expectedResult: expectedResults.filter(Boolean).join("\n"),
        locatorEntryIds: [...manualCaseLocatorIds],
      });
      setWorkspaceCases(result.cases);
      const created = result.cases.find(
        (testCase) =>
          (manualCaseId.trim() && testCase.externalId === manualCaseId.trim()) ||
          testCase.description === manualCaseDescription.trim(),
      );
      if (created) setSelectedCaseId(created.id);
      setManualCaseId("");
      setManualCaseDescription("");
      setManualCaseSteps([""]);
      setManualCaseExpectedResults([""]);
      setManualCaseLocatorIds(new Set());
      message_setter(`Created ${created?.externalId ?? "the case"} in this project.`);
    } catch (error) {
      message_setter(error instanceof Error ? error.message : "Could not create the test case.");
    } finally {
      setBusyAction(null);
    }
  }, [
    manualCaseDescription,
    manualCaseExpectedResults,
    manualCaseId,
    manualCaseLocatorIds,
    manualCaseSteps,
    message_setter,
    projectId,
    setBusyAction,
    setSelectedCaseId,
    setWorkspaceCases,
  ]);

  const updateManualCaseStep = useCallback((index: number, value: string) => {
    setManualCaseSteps((current) =>
      current.map((step, stepIndex) => (stepIndex === index ? value : step)),
    );
  }, []);

  const generatedCases = useMemo(() => cases.filter((c) => c.source === "generated"), [cases]);
  const reviewGeneratedCount = useMemo(
    () =>
      generatedCases.filter((c) => c.reviewDecision === "pending" || c.status === "needs-review")
        .length,
    [generatedCases],
  );
  const acceptedGeneratedCount = useMemo(
    () =>
      generatedCases.filter((c) => c.reviewDecision === "accepted" || c.status === "matches")
        .length,
    [generatedCases],
  );

  const handleGenerateGraphScenarios = useCallback(async () => {
    setBusyAction("generate");
    setGraphFeedback(null);
    message_setter("Creating candidate scenarios from reachable graph transitions...");
    try {
      const oldLength = cases.length;
      const result = await ensureNativeApi().testing.generateScenarios({
        projectId,
      });
      setWorkspaceCases(result.cases);
      await refreshTestingWorkspace();

      const newAdded = result.cases.length - oldLength;
      if (newAdded > 0) {
        const msg = `${newAdded} new reachable graph scenario${newAdded === 1 ? "" : "s"} added to the review queue below.`;
        message_setter(msg);
        setGraphFeedback({ type: "success", text: msg });
      } else {
        const existingCount = result.cases.filter((c) => c.source === "generated").length;
        const msg = `All ${existingCount} reachable paths from the state graph already exist in your review queue.`;
        message_setter(msg);
        setGraphFeedback({ type: "info", text: msg });
      }
    } catch (error) {
      const errText =
        error instanceof Error ? error.message : "Could not generate graph scenarios.";
      message_setter(errText);
      setGraphFeedback({ type: "error", text: errText });
    } finally {
      setBusyAction(null);
    }
  }, [
    cases.length,
    message_setter,
    projectId,
    refreshTestingWorkspace,
    setBusyAction,
    setWorkspaceCases,
  ]);

  const importUserStory = useCallback(async () => {
    if (!storyText.trim() && !storyFilePath) return;
    setBusyAction("story-import");
    message_setter("Generating reviewable cases from the sanitized user story...");
    try {
      const result = await ensureNativeApi().testing.importUserStory({
        projectId,
        projectPath,
        sourceKind: storyFilePath ? "file" : "text",
        ...(storyFilePath ? { filePath: storyFilePath } : { content: storyText.trim() }),
        modelSelection: generationModelSelection,
      });
      setWorkspaceCases(result.cases);
      message_setter(
        `Created ${result.generatedCount} reviewable cases from ${result.sourceName}.`,
      );
    } catch (error) {
      message_setter(error instanceof Error ? error.message : "Could not import the user story.");
    } finally {
      setBusyAction(null);
    }
  }, [
    generationModelSelection,
    message_setter,
    projectId,
    projectPath,
    setBusyAction,
    setWorkspaceCases,
    storyFilePath,
    storyText,
  ]);

  return (
    <section aria-labelledby="testing-cases-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="testing-cases-heading" className="text-lg font-semibold text-foreground">
          Test case workspace
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Bring an existing QA plan or start from verified app paths. Case IDs, workbook rows,
          findings, and review decisions stay together in one queue.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add test cases</CardTitle>
          <CardDescription>
            Start one case yourself, bring a QA workbook, turn a story into candidates, or reuse
            paths already captured from the application.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div
            className="grid grid-cols-1 gap-1.5 rounded-2xl border border-border/50 bg-muted/40 p-1.5 shadow-inner backdrop-blur-sm sm:grid-cols-2 xl:grid-cols-4"
            role="radiogroup"
            aria-label="Choose how to add test cases"
          >
            {(
              [
                ["manual", "Write a case", "Create and map one case", SquarePenIcon],
                ["excel", "Import Excel", "Best for assigned QA batches", FileSpreadsheetIcon],
                ["story", "Use a user story", "Generate reviewable candidates", BookOpenIcon],
                ["graph", "From captured app", "Reuse verified app paths", CompassIcon],
              ] as const
            ).map(([value, label, description, Icon]) => {
              const isSelected = caseIntakeMode === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setCaseIntakeMode(value)}
                  className={cn(
                    "group relative flex flex-col items-start gap-1.5 rounded-xl p-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring select-none",
                    isSelected
                      ? "border border-foreground/30 bg-background text-foreground shadow-sm ring-1 ring-foreground/15 dark:border-foreground/35 dark:bg-accent dark:shadow-[0_0_5px_rgba(255,255,255,0.08)]"
                      : "border border-transparent text-muted-foreground hover:border-border/40 hover:bg-background/50 hover:text-foreground",
                  )}
                >
                  <div className="flex w-full items-center gap-2">
                    <Icon
                      className={cn(
                        "size-4 shrink-0 transition-colors",
                        isSelected
                          ? "text-foreground"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate text-sm font-semibold text-foreground">{label}</span>
                  </div>
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    {description}
                  </span>
                </button>
              );
            })}
          </div>

          {caseIntakeMode === "manual" ? (
            <div className="space-y-4.5 rounded-xl border border-border/60 bg-muted/10 p-4">
              <div className="grid gap-3.5 sm:grid-cols-[14rem_minmax(0,1fr)]">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <label
                      htmlFor="testing-manual-case-id"
                      className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      Case ID
                    </label>
                    <span className="text-[11px] font-normal text-muted-foreground/75">
                      Auto-assigned if blank
                    </span>
                  </div>
                  <Input
                    id="testing-manual-case-id"
                    value={manualCaseId}
                    onChange={(event) => setManualCaseId(event.target.value)}
                    placeholder={caseIdPolicy?.example ?? "TC-00001"}
                    disabled={busyAction !== null}
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <label
                      htmlFor="testing-manual-description"
                      className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      What should this test prove?
                    </label>
                    <span className="text-[11px] font-normal text-muted-foreground/75">
                      Test objective
                    </span>
                  </div>
                  <Input
                    id="testing-manual-description"
                    value={manualCaseDescription}
                    onChange={(event) => setManualCaseDescription(event.target.value)}
                    placeholder="e.g. A workspace owner can update project settings"
                    disabled={busyAction !== null}
                  />
                </div>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Steps
                    </span>
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-medium">
                      {manualCaseSteps.length} {manualCaseSteps.length === 1 ? "step" : "steps"}
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={() => {
                      setManualCaseSteps([...manualCaseSteps, ""]);
                      setManualCaseExpectedResults([...manualCaseExpectedResults, ""]);
                    }}
                  >
                    <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    Add step
                  </Button>
                </div>
                <ol className="space-y-2" aria-label="New test case steps">
                  {manualCaseSteps.map((step, index) => (
                    <li
                      key={`manual-step-${index}`}
                      className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-background/80 px-3 py-1.5 shadow-sm transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 dark:bg-background/40"
                    >
                      <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground border border-border/40">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <AutoResizeStepInput
                          value={step}
                          onChange={(val) => updateManualCaseStep(index, val)}
                          onEnterNext={() => {
                            setManualCaseSteps([
                              ...manualCaseSteps.slice(0, index + 1),
                              "",
                              ...manualCaseSteps.slice(index + 1),
                            ]);
                            setManualCaseExpectedResults([
                              ...manualCaseExpectedResults.slice(0, index + 1),
                              "",
                              ...manualCaseExpectedResults.slice(index + 1),
                            ]);
                          }}
                          ariaLabel={`New case step ${index + 1}`}
                          placeholder="Describe user action (Enter for new step, Shift+Enter for newline)"
                        />
                        <AutoResizeStepInput
                          value={manualCaseExpectedResults[index] ?? ""}
                          onChange={(value) =>
                            setManualCaseExpectedResults((current) =>
                              current.map((result, resultIndex) =>
                                resultIndex === index ? value : result,
                              ),
                            )
                          }
                          ariaLabel={`Expected result for new case step ${index + 1}`}
                          placeholder={`Expected result after step ${index + 1}`}
                          minHeight={28}
                          maxHeight={100}
                        />
                      </div>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete new case step ${index + 1}`}
                        disabled={manualCaseSteps.length === 1}
                        className="mt-0.5 size-7 shrink-0 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-30"
                        onClick={() => {
                          setManualCaseSteps(
                            manualCaseSteps.filter((_, stepIndex) => stepIndex !== index),
                          );
                          setManualCaseExpectedResults(
                            manualCaseExpectedResults.filter(
                              (_, resultIndex) => resultIndex !== index,
                            ),
                          );
                        }}
                      >
                        <Trash2Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ol>
              </div>
              <TestingCaseLocatorPicker
                library={locatorLibrary}
                selectedIds={manualCaseLocatorIds}
                onChange={setManualCaseLocatorIds}
                label="Locator context"
              />
              <div className="flex justify-end pt-1">
                <Button
                  type="button"
                  onClick={() => void createManualCase()}
                  disabled={busyAction !== null}
                >
                  {busyAction === "review" ? (
                    <LoaderIcon aria-hidden="true" className="animate-spin" />
                  ) : null}
                  Create test case
                </Button>
              </div>
            </div>
          ) : null}

          {caseIntakeMode === "excel" ? (
            <div className="space-y-4 rounded-xl border border-border/60 bg-muted/10 p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Import Spreadsheet Test Cases
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Upload an Excel workbook to batch import structured test cases into your
                    workspace queue.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 self-start gap-1.5 text-xs sm:self-auto"
                  render={
                    <a
                      href="/testing/testing-cases-template.xlsx"
                      download="Tabs-Testing-Test-Cases-Template.xlsx"
                    />
                  }
                >
                  <DownloadIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  Download template (.xlsx)
                </Button>
              </div>

              {!workbookPath ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => void chooseWorkbook()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void chooseWorkbook();
                    }
                  }}
                  className="group flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-border/80 bg-background/60 px-4 py-7 text-center transition-all hover:border-primary/50 hover:bg-muted/20 focus:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 dark:bg-background/30"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-foreground transition-transform group-hover:scale-105">
                    <UploadCloudIcon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      Choose an Excel workbook or browse files
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Supports{" "}
                      <span className="font-mono font-medium text-foreground/80">.xlsx</span> sheets
                      with Case ID, Description, Steps, and Expected Result columns
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="pointer-events-none mt-1 h-8 gap-1.5 text-xs"
                    disabled={busyAction !== null}
                  >
                    <FolderOpenIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    Browse workbook
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 transition-all dark:bg-emerald-950/10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <FileSpreadsheetIcon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-sm font-medium text-foreground">
                            {basenameOfPath(workbookPath)}
                          </span>
                          <Badge
                            variant="secondary"
                            className="border-emerald-300 bg-emerald-100 px-1.5 py-0 text-[10px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          >
                            Ready to import
                          </Badge>
                        </div>
                        <p className="truncate text-xs text-muted-foreground" title={workbookPath}>
                          {workbookPath}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => void chooseWorkbook()}
                        disabled={busyAction !== null}
                      >
                        Change
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Remove selected workbook"
                        className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setWorkbookPath("")}
                        disabled={busyAction !== null}
                      >
                        <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {workbookPath ? (
                <div className="space-y-2 rounded-lg border border-border/60 bg-background/60 p-3">
                  <label
                    htmlFor="testing-workbook-group"
                    className="text-sm font-medium text-foreground"
                  >
                    Import test cases into
                  </label>
                  <Select
                    value={workbookTargetGroup}
                    onValueChange={(value) => setWorkbookTargetGroup(value ?? "__sheet__")}
                  >
                    <SelectTrigger id="testing-workbook-group" className="w-full sm:max-w-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="__sheet__">Folders matching Excel sheet names</SelectItem>
                      {caseGroups.map((groupName) => (
                        <SelectItem key={groupName} value={groupName}>
                          {groupName}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Choose an existing folder, or keep the workbook’s sheet-based organization.
                  </p>
                </div>
              ) : null}

              <div className="flex flex-col-reverse gap-3 border-t border-border/40 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <InfoIcon
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
                    aria-hidden="true"
                  />
                  <span>
                    Imported IDs are preserved and mapped steps remain fully reviewable before test
                    code generation.
                  </span>
                </div>
                <Button
                  type="button"
                  onClick={() =>
                    void importWorkbook(
                      workbookTargetGroup === "__sheet__" ? undefined : workbookTargetGroup,
                    )
                  }
                  disabled={!workbookPath || busyAction !== null}
                  className="shrink-0 gap-2 sm:self-auto"
                >
                  {busyAction === "import" ? (
                    <LoaderIcon aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileSpreadsheetIcon aria-hidden="true" className="h-4 w-4" />
                  )}
                  Import and verify
                </Button>
              </div>
            </div>
          ) : null}

          {caseIntakeMode === "story" ? (
            <div className="space-y-4 rounded-xl border border-border/60 bg-muted/10 p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Draft Cases from User Story or Spec
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Paste acceptance criteria or attach a document (.txt, .md, .docx, .pdf) to draft
                    structured test cases.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 self-start gap-1.5 text-xs sm:self-auto"
                  onClick={() => void chooseStoryFile()}
                  disabled={busyAction !== null}
                >
                  <FolderOpenIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  {storyFilePath ? "Change document" : "Attach story document"}
                </Button>
              </div>

              {storyFilePath ? (
                <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 transition-all dark:bg-primary/10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-foreground">
                        <BookOpenIcon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-sm font-medium text-foreground">
                            {basenameOfPath(storyFilePath)}
                          </span>
                          <Badge
                            variant="secondary"
                            className="border-primary/30 bg-primary/10 px-1.5 py-0 text-[10px] font-medium text-foreground"
                          >
                            Document attached
                          </Badge>
                        </div>
                        <p className="truncate text-xs text-muted-foreground" title={storyFilePath}>
                          {storyFilePath}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => void chooseStoryFile()}
                        disabled={busyAction !== null}
                      >
                        Change
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Remove selected document"
                        className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setStoryFilePath("")}
                        disabled={busyAction !== null}
                      >
                        <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Textarea
                    id="testing-story-text"
                    rows={6}
                    value={storyText}
                    onChange={(event) => setStoryText(event.target.value)}
                    placeholder="Paste user stories, acceptance criteria, or behavioral requirements here...&#10;&#10;Example:&#10;As a workspace owner, I want to invite team members and assign role-based permissions so they can collaborate on tests."
                    disabled={busyAction !== null}
                    className="max-h-60 overflow-y-auto resize-y font-sans text-sm leading-relaxed"
                  />
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 border-t border-border/40 pt-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                    Fusion model:
                  </span>
                  <div className="w-64 max-w-full">
                    <FusedModelPicker
                      provider={generationFusionProvider}
                      model={generationModelSelection.model as ModelSlug}
                      lockedProvider={null}
                      providers={fusionProviders as any}
                      prompt={storyText}
                      onPromptChange={setStoryText}
                      modelOptions={generationModelSelection.options}
                      onProviderModelChange={updateTestingFusionModel}
                      onModelOptionsChange={updateTestingFusionOptions}
                      align="start"
                      side="top"
                      sideOffset={8}
                      alignOffset={0}
                      triggerClassName="w-full justify-between bg-background/80 border border-border/60"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:self-auto">
                  <Button
                    type="button"
                    onClick={() => void importUserStory()}
                    disabled={(!storyText.trim() && !storyFilePath) || busyAction !== null}
                    className="shrink-0 gap-2"
                  >
                    {busyAction === "story-import" ? (
                      <LoaderIcon className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ListPlusIcon className="h-4 w-4" aria-hidden="true" />
                    )}
                    Draft reviewable cases
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <InfoIcon
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
                  aria-hidden="true"
                />
                <span>Story and locator context are sanitized before provider dispatch.</span>
              </div>
            </div>
          ) : null}

          {caseIntakeMode === "graph" ? (
            <div className="space-y-4">
              {(status?.nodeCount ?? 0) > 0 ? (
                <div className="rounded-xl border border-border/70 bg-card/40 p-5 space-y-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          Discovered App State Graph
                        </span>
                        <Badge
                          variant="outline"
                          className="h-5 gap-1.5 px-2 text-[11px] font-normal border-border/80 text-muted-foreground"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Graph active
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Proposes reviewable test cases directly from verified DOM states and
                        interactive transition paths recorded during exploration.
                      </p>
                    </div>
                    {status?.targetUrl ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground">
                        <GlobeIcon
                          className="h-3.5 w-3.5 text-muted-foreground/70"
                          aria-hidden="true"
                        />
                        <span
                          className="font-mono text-[11px] text-foreground max-w-[240px] truncate"
                          title={status.targetUrl}
                        >
                          {status.targetUrl}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="flex flex-col gap-1 rounded-lg border border-border/50 bg-background/50 p-3.5">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-xs font-medium">Reachable States</span>
                        <LayersIcon className="h-3.5 w-3.5 text-foreground/70" aria-hidden="true" />
                      </div>
                      <div className="text-xl font-bold text-foreground">
                        {status?.nodeCount ?? 0}
                      </div>
                      <span className="text-[11px] text-muted-foreground/80">
                        DOM state snapshots
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 rounded-lg border border-border/50 bg-background/50 p-3.5">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-xs font-medium">Observed Transitions</span>
                        <GitBranchIcon
                          className="h-3.5 w-3.5 text-blue-500/70"
                          aria-hidden="true"
                        />
                      </div>
                      <div className="text-xl font-bold text-foreground">
                        {status?.edgeCount ?? 0}
                      </div>
                      <span className="text-[11px] text-muted-foreground/80">
                        Interactive paths mapped
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 rounded-lg border border-border/50 bg-background/50 p-3.5">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-xs font-medium">Generated Cases</span>
                        <ListChecksIcon
                          className="h-3.5 w-3.5 text-violet-500/70"
                          aria-hidden="true"
                        />
                      </div>
                      <div className="text-xl font-bold text-foreground">
                        {generatedCases.length}
                      </div>
                      <span className="text-[11px] text-muted-foreground/80">
                        {reviewGeneratedCount > 0
                          ? `${reviewGeneratedCount} in review`
                          : `${acceptedGeneratedCount} accepted`}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 rounded-lg border border-border/50 bg-background/50 p-3.5">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-xs font-medium">Graph Sync</span>
                        <ActivityIcon
                          className="h-3.5 w-3.5 text-emerald-500/70"
                          aria-hidden="true"
                        />
                      </div>
                      <div className="text-xl font-bold text-emerald-500">
                        {status?.lastRunStatus === "completed" ? "Synchronized" : "Ready"}
                      </div>
                      <span className="text-[11px] text-muted-foreground/80">
                        Discovery graph ready
                      </span>
                    </div>
                  </div>

                  {graphFeedback ? (
                    <div
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-xs animate-in fade-in duration-200",
                        graphFeedback.type === "success" &&
                          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                        graphFeedback.type === "info" &&
                          "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
                        graphFeedback.type === "error" &&
                          "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {graphFeedback.type === "success" ? (
                          <CheckCircle2Icon
                            className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                            aria-hidden="true"
                          />
                        ) : graphFeedback.type === "info" ? (
                          <InfoIcon
                            className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400"
                            aria-hidden="true"
                          />
                        ) : (
                          <InfoIcon
                            className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
                            aria-hidden="true"
                          />
                        )}
                        <span>{graphFeedback.text}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setGraphFeedback(null)}
                        className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                        aria-label="Dismiss notification"
                      >
                        <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <InfoIcon
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
                        aria-hidden="true"
                      />
                      <span>
                        Scenarios are extracted deterministically from reachable graph trajectories
                        without hallucinations.
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onNavigate("discover")}
                        className="gap-1.5 h-8 text-xs"
                      >
                        Explore more states
                        <ArrowRightIcon className="h-3 w-3" aria-hidden="true" />
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleGenerateGraphScenarios()}
                        disabled={busyAction !== null}
                        className="gap-2 h-8 text-xs font-medium"
                      >
                        {busyAction === "generate" ? (
                          <LoaderIcon aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CompassIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Generate from captured app
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/10 p-8 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-foreground">
                    <CompassIcon className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <div className="max-w-md space-y-1">
                    <div className="text-sm font-semibold text-foreground">
                      No captured application paths found
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Explore your web application to map interactive elements, navigation flows,
                      and form actions. Testing will automatically generate reviewable test cases
                      from reachable paths.
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => onNavigate("discover")}
                    className="gap-2 mt-2"
                  >
                    <CompassIcon className="h-4 w-4" aria-hidden="true" />
                    Open App Discovery & Explore
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <TestingImplementedInventory
        implementedInventoryOpen={implementedInventoryOpen}
        setImplementedInventoryOpen={setImplementedInventoryOpen}
        testInventoryView={testInventoryView}
        setTestInventoryView={setTestInventoryView}
        refreshTestingWorkspace={refreshTestingWorkspace}
        flattenedTestInventory={flattenedTestInventory}
        expandedTestNodes={expandedTestNodes}
        selectedTestNodeId={selectedTestNodeId}
        setSelectedTestNodeId={setSelectedTestNodeId}
        testInventory={testInventory}
      />

      <TestingCaseQueue
        cases={cases}
        caseGroups={caseGroups}
        reviewCaseCount={reviewCaseCount}
        acceptedCaseCount={acceptedCaseCount}
        caseSearch={caseSearch}
        setCaseSearch={setCaseSearch}
        caseFilter={caseFilter}
        setCaseFilter={setCaseFilter}
        selectedGenerationCaseIds={selectedGenerationCaseIds}
        setSelectedGenerationCaseIds={setSelectedGenerationCaseIds}
        readyCases={readyCases}
        filteredCases={filteredCases}
        selectedCase={selectedCase}
        setSelectedCaseId={setSelectedCaseId}
        editingCaseId={editingCaseId}
        setEditingCaseId={setEditingCaseId}
        editedExternalId={editedExternalId}
        setEditedExternalId={setEditedExternalId}
        editedDescription={editedDescription}
        setEditedDescription={setEditedDescription}
        editedSteps={editedSteps}
        setEditedSteps={setEditedSteps}
        updateEditedStep={updateEditedStep}
        moveEditedStep={moveEditedStep}
        editedCaseLocatorIds={editedCaseLocatorIds}
        setEditedCaseLocatorIds={setEditedCaseLocatorIds}
        editedExpectedResults={editedExpectedResults}
        setEditedExpectedResults={setEditedExpectedResults}
        reviewCase={reviewCase}
        deleteCase={deleteCase}
        updateCaseGroup={updateCaseGroup}
        createCaseGroup={createCaseGroup}
        deleteCaseGroup={deleteCaseGroup}
        beginEditCase={beginEditCase}
        locatorLibrary={locatorLibrary}
        projectPath={projectPath}
        onNavigate={onNavigate}
        busyAction={busyAction}
      />
    </section>
  );
});

interface TestingImplementedInventoryProps {
  implementedInventoryOpen: boolean;
  setImplementedInventoryOpen: (v: boolean) => void;
  testInventoryView: "tree" | "table";
  setTestInventoryView: (v: "tree" | "table") => void;
  refreshTestingWorkspace: () => Promise<void>;
  flattenedTestInventory: ReadonlyArray<{
    node: import("@tabs/contracts").TestingTestInventoryNode;
    depth: number;
  }>;
  expandedTestNodes: ReadonlySet<string>;
  selectedTestNodeId: string | null;
  setSelectedTestNodeId: (id: string | null) => void;
  testInventory: import("@tabs/contracts").TestingTestInventoryResult | null;
}

const TestingImplementedInventory = memo(function TestingImplementedInventory({
  implementedInventoryOpen,
  setImplementedInventoryOpen,
  testInventoryView,
  setTestInventoryView,
  refreshTestingWorkspace,
  flattenedTestInventory,
  expandedTestNodes,
  selectedTestNodeId,
  setSelectedTestNodeId,
  testInventory,
}: TestingImplementedInventoryProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <CardTitle className="text-base font-semibold">Implemented tests</CardTitle>
            <CardDescription className="text-xs">
              Managed cases and statically discovered Playwright tests, grouped like a Test
              Explorer.
            </CardDescription>
          </div>
          <div
            className="flex items-center gap-2"
            role="group"
            aria-label="Test inventory view controls"
          >
            {implementedInventoryOpen ? (
              <>
                <SegmentedControl
                  size="sm"
                  value={testInventoryView}
                  onValueChange={setTestInventoryView}
                  options={[
                    { value: "tree", label: "Tree" },
                    { value: "table", label: "Table" },
                  ]}
                  aria-label="Test inventory view mode"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshTestingWorkspace()}
                  className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                  title="Refresh repository test scan"
                >
                  <RefreshCwIcon aria-hidden="true" className="h-3.5 w-3.5" />
                  <span>Refresh</span>
                </Button>
                <div className="h-4 w-px bg-border/60" aria-hidden="true" />
              </>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-expanded={implementedInventoryOpen}
              onClick={() => setImplementedInventoryOpen(!implementedInventoryOpen)}
              className="h-8 gap-1.5 px-3 text-xs font-medium"
            >
              <span>{implementedInventoryOpen ? "Hide inventory" : "Show inventory"}</span>
              <ChevronDownIcon
                aria-hidden="true"
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-200",
                  implementedInventoryOpen && "rotate-180",
                )}
              />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className={cn(!implementedInventoryOpen && "hidden")}>
        {testInventoryView === "tree" ? (
          <div
            role="tree"
            aria-label="Implemented test inventory"
            className="max-h-80 overflow-auto rounded-xl border border-border/60 p-2"
          >
            {flattenedTestInventory.map(({ node, depth }, index) => {
              const expandable = node.children.length > 0;
              const expanded = expandedTestNodes.has(node.id);
              return (
                <button
                  key={node.id}
                  type="button"
                  role="treeitem"
                  aria-level={depth + 1}
                  aria-expanded={expandable ? expanded : undefined}
                  aria-selected={selectedTestNodeId === node.id}
                  tabIndex={
                    selectedTestNodeId === node.id || (!selectedTestNodeId && index === 0) ? 0 : -1
                  }
                  data-testing-tree-index={index}
                  onClick={() => {
                    setSelectedTestNodeId(node.id);
                  }}
                  onDoubleClick={() => {
                    if (node.filePath) void openInPreferredEditor(ensureNativeApi(), node.filePath);
                  }}
                  onKeyDown={(event) => {
                    const items = Array.from(
                      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                        "[data-testing-tree-index]",
                      ) ?? [],
                    );
                    const focusAt = (target: number) =>
                      items[Math.max(0, Math.min(items.length - 1, target))]?.focus();
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      focusAt(index + 1);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      focusAt(index - 1);
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      focusAt(0);
                    } else if (event.key === "End") {
                      event.preventDefault();
                      focusAt(items.length - 1);
                    } else if (event.key === "Enter") {
                      event.preventDefault();
                      setSelectedTestNodeId(node.id);
                      if (node.filePath) {
                        void openInPreferredEditor(ensureNativeApi(), node.filePath);
                      }
                    }
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selectedTestNodeId === node.id && "bg-primary/10 text-foreground",
                  )}
                  style={{ paddingLeft: `${8 + depth * 18}px` }}
                >
                  {expandable ? (
                    expanded ? (
                      <ChevronDownIcon aria-hidden="true" className="size-4" />
                    ) : (
                      <ChevronRightIcon aria-hidden="true" className="size-4" />
                    )
                  ) : (
                    <span className="size-4" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{node.label}</span>
                  <Badge variant="outline">{node.source}</Badge>
                  {node.status !== "unknown" ? (
                    <Badge variant={node.status === "passed" ? "success" : "secondary"}>
                      {node.status}
                    </Badge>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="max-h-80 overflow-auto rounded-xl border border-border/60">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Test</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {flattenedTestInventory
                  .filter(({ node }) => node.kind === "test" || node.kind === "case")
                  .map(({ node }) => (
                    <tr key={node.id}>
                      <td className="px-3 py-2">{node.label}</td>
                      <td className="px-3 py-2">{node.source}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {node.filePath ? `${node.filePath}:${node.line ?? 1}` : node.externalCaseId}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {testInventory?.repositoryFilesScanned ?? 0} repository test files scanned. VS Code
          provider:{" "}
          {testInventory?.editorProviderConnected
            ? "connected"
            : "unavailable; repository scan is active"}
          .
        </p>
      </CardContent>
    </Card>
  );
});

interface TestingCaseQueueProps {
  cases: ReadonlyArray<import("@tabs/contracts").TestingCaseSummary>;
  caseGroups: ReadonlyArray<string>;
  reviewCaseCount: number;
  acceptedCaseCount: number;
  caseSearch: string;
  setCaseSearch: (v: string) => void;
  caseFilter: TestingCaseFilter;
  setCaseFilter: (v: TestingCaseFilter) => void;
  selectedGenerationCaseIds: ReadonlySet<string>;
  setSelectedGenerationCaseIds: (ids: ReadonlySet<string>) => void;
  readyCases: ReadonlyArray<import("@tabs/contracts").TestingCaseSummary>;
  filteredCases: ReadonlyArray<import("@tabs/contracts").TestingCaseSummary>;
  selectedCase: import("@tabs/contracts").TestingCaseSummary | null;
  setSelectedCaseId: (id: string | null) => void;
  editingCaseId: string | null;
  setEditingCaseId: (id: string | null) => void;
  editedExternalId: string;
  setEditedExternalId: (v: string) => void;
  editedDescription: string;
  setEditedDescription: (v: string) => void;
  editedSteps: ReadonlyArray<string>;
  setEditedSteps: (
    steps: ReadonlyArray<string> | ((prev: ReadonlyArray<string>) => ReadonlyArray<string>),
  ) => void;
  updateEditedStep: (index: number, value: string) => void;
  moveEditedStep: (index: number, direction: -1 | 1) => void;
  editedCaseLocatorIds: ReadonlySet<string>;
  setEditedCaseLocatorIds: (ids: ReadonlySet<string>) => void;
  editedExpectedResults: ReadonlyArray<string>;
  setEditedExpectedResults: (
    v: ReadonlyArray<string> | ((prev: ReadonlyArray<string>) => ReadonlyArray<string>),
  ) => void;
  reviewCase: (
    testCase: import("@tabs/contracts").TestingCaseSummary,
    decision: "accepted" | "edited" | "rejected",
  ) => Promise<void>;
  deleteCase: (testCase: import("@tabs/contracts").TestingCaseSummary) => Promise<void>;
  updateCaseGroup: (
    testCase: import("@tabs/contracts").TestingCaseSummary,
    groupName: string,
  ) => Promise<void>;
  createCaseGroup: (groupName: string) => Promise<void>;
  deleteCaseGroup: (groupName: string) => Promise<void>;
  beginEditCase: (testCase: import("@tabs/contracts").TestingCaseSummary) => void;
  locatorLibrary: import("@tabs/contracts").TestingLocatorLibraryResult | null;
  projectPath: string;
  onNavigate: (section: TestingWorkspaceSection) => void;
  busyAction: import("./types").TestingBusyAction;
}

const TestingCaseQueue = memo(function TestingCaseQueue({
  cases,
  caseGroups,
  reviewCaseCount,
  acceptedCaseCount,
  caseSearch,
  setCaseSearch,
  caseFilter,
  setCaseFilter,
  selectedGenerationCaseIds,
  setSelectedGenerationCaseIds,
  readyCases,
  filteredCases,
  selectedCase,
  setSelectedCaseId,
  editingCaseId,
  setEditingCaseId,
  editedExternalId,
  setEditedExternalId,
  editedDescription,
  setEditedDescription,
  editedSteps,
  setEditedSteps,
  updateEditedStep,
  moveEditedStep,
  editedCaseLocatorIds,
  setEditedCaseLocatorIds,
  editedExpectedResults,
  setEditedExpectedResults,
  reviewCase,
  deleteCase,
  updateCaseGroup,
  createCaseGroup,
  deleteCaseGroup,
  beginEditCase,
  locatorLibrary,
  projectPath,
  onNavigate,
  busyAction,
}: TestingCaseQueueProps) {
  const [groupDraft, setGroupDraft] = useState(selectedCase?.groupName ?? "Ungrouped");
  const [newGroupName, setNewGroupName] = useState("");
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  const [bulkGroupDraft, setBulkGroupDraft] = useState("Ungrouped");
  const [selectedGroupCaseIds, setSelectedGroupCaseIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const groupNames = caseGroups;
  useEffect(() => {
    setGroupDraft(selectedCase?.groupName ?? "Ungrouped");
    setNewGroupName("");
  }, [selectedCase?.id, selectedCase?.groupName]);
  const moveSelectedCases = useCallback(
    async (groupName: string) => {
      const targetCases = cases.filter((testCase) => selectedGroupCaseIds.has(testCase.id));
      for (const testCase of targetCases) {
        await updateCaseGroup(testCase, groupName);
      }
      setNewGroupName("");
    },
    [cases, selectedGroupCaseIds, updateCaseGroup],
  );
  return (
    <div className="space-y-4" aria-live="polite">
      {cases.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No reconciled cases yet. Import a workbook or generate scenarios from the graph.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Total cases", cases.length, "text-foreground"],
              ["Need review", reviewCaseCount, "text-amber-600"],
              ["Ready to automate", acceptedCaseCount, "text-emerald-600"],
            ].map(([label, value, color]) => (
              <Card key={label as string}>
                <CardContent className="py-4">
                  <div className={cn("text-xl font-semibold tabular-nums", color as string)}>
                    {value}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/60 p-2.5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <SearchIcon
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground z-10"
                />
                <Input
                  value={caseSearch}
                  onChange={(event) => setCaseSearch(event.target.value)}
                  placeholder="Search test ID or description..."
                  aria-label="Search test cases"
                  className="h-8 pl-9 text-xs bg-background/80"
                />
                {caseSearch ? (
                  <button
                    type="button"
                    onClick={() => setCaseSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                    aria-label="Clear search"
                  >
                    <XIcon className="size-3" />
                  </button>
                ) : null}
              </div>

              <Select
                value={caseFilter}
                onValueChange={(value) => setCaseFilter(value as TestingCaseFilter)}
              >
                <SelectTrigger
                  aria-label="Filter test cases"
                  className="h-8 w-[130px] text-xs bg-background/80 shrink-0"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="all">All cases</SelectItem>
                  <SelectItem value="needs-review">Needs review</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                </SelectPopup>
              </Select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2 sm:border-t-0 sm:pt-0 sm:border-l sm:border-border/60 sm:pl-3 sm:justify-end">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      selectedGenerationCaseIds.size > 0
                        ? "text-foreground font-semibold"
                        : "text-foreground",
                    )}
                  >
                    {selectedGenerationCaseIds.size}
                  </span>
                  <span>selected</span>
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setSelectedGenerationCaseIds(new Set(readyCases.map((testCase) => testCase.id)))
                  }
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  disabled={readyCases.length === 0}
                >
                  Select ready ({readyCases.length})
                </Button>

                {selectedGenerationCaseIds.size > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedGenerationCaseIds(new Set())}
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </Button>
                ) : null}
              </div>

              <Button
                type="button"
                size="sm"
                disabled={selectedGenerationCaseIds.size === 0}
                onClick={() => onNavigate("automate")}
                className="h-8 gap-1.5 px-3 text-xs font-medium shrink-0"
              >
                <span>Continue to Build tests</span>
                <ArrowRightIcon className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
          {groupManagerOpen ? (
            <Card id="testing-group-manager" className="border-primary/25 bg-primary/[0.03]">
              <CardContent className="space-y-3 py-4">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-foreground">Test groups</div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label="Collapse test groups organizer"
                      aria-expanded="true"
                      aria-controls="testing-group-manager"
                      onClick={() => setGroupManagerOpen(false)}
                    >
                      <ChevronDownIcon aria-hidden="true" />
                      Collapse
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Create an empty folder now, or select cases from the filtered list and move them
                    together later. Groups from Excel are created from the source sheet
                    automatically.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setSelectedGroupCaseIds(
                          new Set(filteredCases.map((testCase) => testCase.id)),
                        )
                      }
                    >
                      Select all filtered ({filteredCases.length})
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={selectedGroupCaseIds.size === 0}
                      onClick={() => setSelectedGroupCaseIds(new Set())}
                    >
                      Clear folder selection
                    </Button>
                    <span className="text-xs text-muted-foreground" role="status">
                      {selectedGroupCaseIds.size} selected for moving
                    </span>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label
                      htmlFor="testing-new-group"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      New folder name
                    </label>
                    <div className="flex gap-2">
                      <Input
                        id="testing-new-group"
                        value={newGroupName}
                        onChange={(event) => setNewGroupName(event.target.value)}
                        placeholder="For example: Login page"
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={busyAction !== null || newGroupName.trim().length === 0}
                        onClick={() => {
                          void createCaseGroup(newGroupName.trim());
                          setNewGroupName("");
                        }}
                      >
                        Create folder
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor="testing-bulk-group"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Move selected to
                    </label>
                    <div className="flex gap-2">
                      <Select
                        value={bulkGroupDraft}
                        onValueChange={(value) => setBulkGroupDraft(value ?? "Ungrouped")}
                      >
                        <SelectTrigger id="testing-bulk-group" className="min-w-0 flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectPopup>
                          {groupNames.map((groupName) => (
                            <SelectItem key={groupName} value={groupName}>
                              {groupName}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyAction !== null || selectedGroupCaseIds.size === 0}
                        onClick={() => void moveSelectedCases(bulkGroupDraft)}
                      >
                        Move {selectedGroupCaseIds.size || ""} selected
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
          <div className="grid min-h-[30rem] overflow-hidden rounded-xl border border-border/70 bg-card lg:grid-cols-[19rem_minmax(0,1fr)]">
            <div className="max-h-[40rem] overflow-auto border-b border-border/70 lg:border-b-0 lg:border-r">
              <div
                className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5 text-xs text-muted-foreground"
                role="status"
              >
                <span>
                  {filteredCases.length} of {cases.length} cases
                </span>
                <span className="flex items-center gap-2">
                  {caseFilter !== "all" || caseSearch ? (
                    <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      Filtered
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Create or organize test groups"
                    aria-expanded={groupManagerOpen}
                    aria-controls="testing-group-manager"
                    onClick={() => setGroupManagerOpen((open) => !open)}
                  >
                    <PlusIcon aria-hidden="true" />
                  </Button>
                </span>
              </div>
              <ul aria-label="Test cases grouped by page or feature">
                {groupNames
                  .filter(
                    (groupName) => !cases.some((testCase) => testCase.groupName === groupName),
                  )
                  .map((groupName) => (
                    <React.Fragment key={`empty-${groupName}`}>
                      <li className="flex items-center border-b border-border/60 bg-muted/40">
                        <button
                          type="button"
                          aria-expanded={!collapsedGroups.has(groupName)}
                          onClick={() =>
                            setCollapsedGroups((current) => {
                              const next = new Set(current);
                              if (next.has(groupName)) next.delete(groupName);
                              else next.add(groupName);
                              return next;
                            })
                          }
                          className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold text-muted-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span>{groupName}</span>
                          <ChevronDownIcon
                            aria-hidden="true"
                            className={cn(
                              "size-3.5 transition-transform",
                              collapsedGroups.has(groupName) && "-rotate-90",
                            )}
                          />
                        </button>
                        {groupName !== "Ungrouped" ? (
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Delete ${groupName} folder`}
                            disabled={busyAction !== null}
                            onClick={() => void deleteCaseGroup(groupName)}
                            className="mr-2 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2Icon aria-hidden="true" />
                          </Button>
                        ) : null}
                      </li>
                      {!collapsedGroups.has(groupName) ? (
                        <li className="border-b border-border/60 px-4 py-3 text-xs text-muted-foreground">
                          Empty folder
                        </li>
                      ) : null}
                    </React.Fragment>
                  ))}
                {[...filteredCases]
                  .sort((left, right) => left.groupName.localeCompare(right.groupName))
                  .map((testCase, index, groupedCases) => {
                    const ready =
                      testCase.reviewDecision === "accepted" ||
                      testCase.reviewDecision === "edited";
                    return (
                      <React.Fragment key={testCase.id}>
                        {index === 0 ||
                        groupedCases[index - 1]?.groupName !== testCase.groupName ? (
                          <li className="flex items-center border-b border-border/60 bg-muted/40">
                            <button
                              type="button"
                              aria-expanded={!collapsedGroups.has(testCase.groupName)}
                              onClick={() =>
                                setCollapsedGroups((current) => {
                                  const next = new Set(current);
                                  if (next.has(testCase.groupName)) next.delete(testCase.groupName);
                                  else next.add(testCase.groupName);
                                  return next;
                                })
                              }
                              className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold text-muted-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span>{testCase.groupName}</span>
                              <ChevronDownIcon
                                aria-hidden="true"
                                className={cn(
                                  "size-3.5 transition-transform",
                                  collapsedGroups.has(testCase.groupName) && "-rotate-90",
                                )}
                              />
                            </button>
                            {testCase.groupName !== "Ungrouped" ? (
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Delete ${testCase.groupName} folder`}
                                disabled={busyAction !== null}
                                onClick={() => void deleteCaseGroup(testCase.groupName)}
                                className="mr-2 text-muted-foreground hover:text-destructive"
                              >
                                <Trash2Icon aria-hidden="true" />
                              </Button>
                            ) : null}
                          </li>
                        ) : null}
                        {!collapsedGroups.has(testCase.groupName) ? (
                          <li className="flex items-start gap-2 border-b border-border/60 px-3 py-3 last:border-b-0">
                            <Checkbox
                              checked={
                                groupManagerOpen
                                  ? selectedGroupCaseIds.has(testCase.id)
                                  : selectedGenerationCaseIds.has(testCase.id)
                              }
                              disabled={!groupManagerOpen && !ready}
                              onCheckedChange={(checked) => {
                                if (groupManagerOpen) {
                                  setSelectedGroupCaseIds(
                                    new Set(
                                      checked
                                        ? [...selectedGroupCaseIds, testCase.id]
                                        : [...selectedGroupCaseIds].filter(
                                            (id) => id !== testCase.id,
                                          ),
                                    ),
                                  );
                                  return;
                                }
                                setSelectedGenerationCaseIds(
                                  new Set(
                                    checked
                                      ? [...selectedGenerationCaseIds, testCase.id]
                                      : [...selectedGenerationCaseIds].filter(
                                          (id) => id !== testCase.id,
                                        ),
                                  ),
                                );
                              }}
                              aria-label={
                                groupManagerOpen
                                  ? `Select ${testCase.externalId} for moving to a test group`
                                  : ready
                                    ? `Select ${testCase.externalId} for test generation`
                                    : `${testCase.externalId} must be reviewed before generation`
                              }
                              className="mt-1"
                            />
                            <button
                              type="button"
                              aria-current={selectedCase?.id === testCase.id ? "true" : undefined}
                              onClick={() => {
                                setSelectedCaseId(testCase.id);
                                setEditingCaseId(null);
                              }}
                              className={cn(
                                "min-w-0 flex-1 rounded-lg px-2 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                selectedCase?.id === testCase.id
                                  ? "bg-foreground/[0.06]"
                                  : "hover:bg-muted/50",
                              )}
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-medium text-foreground">
                                  {testCase.externalId}
                                </span>
                                <span
                                  className={cn(
                                    "size-2 shrink-0 rounded-full",
                                    testCase.status === "matches"
                                      ? "bg-emerald-500"
                                      : testCase.status === "blocked"
                                        ? "bg-destructive"
                                        : "bg-amber-500",
                                  )}
                                  aria-hidden="true"
                                />
                              </span>
                              <span className="mt-1 block truncate text-xs text-muted-foreground">
                                {testCase.description}
                              </span>
                              <span className="mt-2 block text-[11px] capitalize text-muted-foreground">
                                {testCase.status.replace("-", " ")} · {testCase.reviewDecision}
                              </span>
                            </button>
                          </li>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
              </ul>
            </div>
            <div className="min-w-0 p-4 sm:p-5">
              {selectedCase ? (
                <Card key={selectedCase.id} className="border-0 shadow-none">
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <CardTitle className="text-base">
                          {selectedCase.externalId}: {selectedCase.description}
                        </CardTitle>
                        <CardDescription>
                          {selectedCase.creationMethod === "manual"
                            ? "Created manually in this Testing project"
                            : selectedCase.source === "excel"
                              ? `${selectedCase.sourceSheet ?? "Workbook"}, row ${selectedCase.sourceRow ?? "unknown"}`
                              : "Generated from a verified graph transition"}
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">
                          {selectedCase.creationMethod ?? selectedCase.source}
                        </Badge>
                        <Badge
                          variant={selectedCase.status === "matches" ? "success" : "secondary"}
                        >
                          {selectedCase.status.replace("-", " ")}
                        </Badge>
                        <Badge variant="outline">{selectedCase.reviewDecision}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedCase.reviewDecision === "pending" ? (
                      <div
                        className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3"
                        role="status"
                      >
                        <div className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                          Review required
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Accept or edit this case before it can be selected for test generation.
                        </p>
                      </div>
                    ) : (
                      <div
                        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3"
                        role="status"
                      >
                        <div className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                          Accepted — ready to automate
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          This case is eligible for selection and test generation.
                        </p>
                      </div>
                    )}
                    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          Organize this case
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Move it to an existing group, or create a new group and place this case in
                          it.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-52 flex-1 space-y-1">
                          <label
                            htmlFor={`testing-case-group-${selectedCase.id}`}
                            className="text-xs font-medium text-muted-foreground"
                          >
                            Test group
                          </label>
                          <Select
                            value={groupDraft}
                            onValueChange={(value) => setGroupDraft(value ?? "Ungrouped")}
                          >
                            <SelectTrigger
                              id={`testing-case-group-${selectedCase.id}`}
                              aria-label="Test group"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectPopup>
                              {groupNames.map((groupName) => (
                                <SelectItem key={groupName} value={groupName}>
                                  {groupName}
                                </SelectItem>
                              ))}
                            </SelectPopup>
                          </Select>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={
                            busyAction !== null || groupDraft.trim() === selectedCase.groupName
                          }
                          onClick={() => void updateCaseGroup(selectedCase, groupDraft)}
                        >
                          Move to group
                        </Button>
                      </div>
                    </div>
                    {editingCaseId === selectedCase.id ? (
                      <div className="space-y-3">
                        <div className="grid gap-3.5 sm:grid-cols-[14.5rem_minmax(0,1fr)]">
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-1">
                              <label
                                htmlFor={`testing-case-id-${selectedCase.id}`}
                                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                              >
                                Case ID
                              </label>
                              <span className="text-[11px] font-normal text-muted-foreground/75">
                                Unique ID
                              </span>
                            </div>
                            <Input
                              id={`testing-case-id-${selectedCase.id}`}
                              value={editedExternalId}
                              onChange={(event) => setEditedExternalId(event.target.value)}
                              className="font-mono text-sm"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-1">
                              <label
                                htmlFor={`testing-case-description-${selectedCase.id}`}
                                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                              >
                                Reviewed description
                              </label>
                              <span className="text-[11px] font-normal text-muted-foreground/75">
                                Test objective
                              </span>
                            </div>
                            <Input
                              id={`testing-case-description-${selectedCase.id}`}
                              value={editedDescription}
                              onChange={(event) => setEditedDescription(event.target.value)}
                            />
                          </div>
                        </div>
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Test steps
                              </span>
                              <Badge
                                variant="secondary"
                                className="px-1.5 py-0 text-[10px] font-medium"
                              >
                                {editedSteps.length} {editedSteps.length === 1 ? "step" : "steps"}
                              </Badge>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 text-xs"
                              onClick={() => {
                                setEditedSteps([...editedSteps, ""]);
                                setEditedExpectedResults([...editedExpectedResults, ""]);
                              }}
                            >
                              <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                              Add step
                            </Button>
                          </div>
                          <ol className="space-y-2" aria-label="Review test case steps">
                            {editedSteps.map((step, index) => (
                              <li
                                key={`edit-step-${index}`}
                                className="flex items-start gap-2 rounded-xl border border-border/70 bg-background/80 px-3 py-1.5 shadow-sm transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 dark:bg-background/40"
                              >
                                <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground border border-border/40">
                                  {index + 1}
                                </div>
                                <div className="min-w-0 flex-1 space-y-2">
                                  <AutoResizeStepInput
                                    value={step}
                                    onChange={(val) => updateEditedStep(index, val)}
                                    onEnterNext={() => {
                                      setEditedSteps([
                                        ...editedSteps.slice(0, index + 1),
                                        "",
                                        ...editedSteps.slice(index + 1),
                                      ]);
                                      setEditedExpectedResults([
                                        ...editedExpectedResults.slice(0, index + 1),
                                        "",
                                        ...editedExpectedResults.slice(index + 1),
                                      ]);
                                    }}
                                    ariaLabel={`Step ${index + 1}`}
                                    placeholder="Describe user action (Enter for new step, Shift+Enter for newline)"
                                  />
                                  <AutoResizeStepInput
                                    value={editedExpectedResults[index] ?? ""}
                                    onChange={(value) =>
                                      setEditedExpectedResults((current) =>
                                        current.map((result, resultIndex) =>
                                          resultIndex === index ? value : result,
                                        ),
                                      )
                                    }
                                    ariaLabel={`Expected result for step ${index + 1}`}
                                    placeholder={`Expected result after step ${index + 1}`}
                                    minHeight={28}
                                    maxHeight={100}
                                  />
                                </div>
                                <div className="mt-0.5 flex shrink-0 items-center gap-0.5">
                                  <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={`Move step ${index + 1} up`}
                                    disabled={index === 0}
                                    className="size-7 rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-30"
                                    onClick={() => {
                                      moveEditedStep(index, -1);
                                      setEditedExpectedResults((current) => {
                                        const next = [...current];
                                        [next[index], next[index - 1]] = [
                                          next[index - 1]!,
                                          next[index]!,
                                        ];
                                        return next;
                                      });
                                    }}
                                  >
                                    <ArrowUpIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={`Move step ${index + 1} down`}
                                    disabled={index === editedSteps.length - 1}
                                    className="size-7 rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-30"
                                    onClick={() => {
                                      moveEditedStep(index, 1);
                                      setEditedExpectedResults((current) => {
                                        const next = [...current];
                                        [next[index], next[index + 1]] = [
                                          next[index + 1]!,
                                          next[index]!,
                                        ];
                                        return next;
                                      });
                                    }}
                                  >
                                    <ArrowDownIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={`Insert step after ${index + 1}`}
                                    className="size-7 rounded-lg text-muted-foreground hover:text-foreground"
                                    onClick={() => {
                                      setEditedExpectedResults([
                                        ...editedExpectedResults.slice(0, index + 1),
                                        "",
                                        ...editedExpectedResults.slice(index + 1),
                                      ]);
                                      setEditedSteps([
                                        ...editedSteps.slice(0, index + 1),
                                        "",
                                        ...editedSteps.slice(index + 1),
                                      ]);
                                    }}
                                  >
                                    <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={`Delete step ${index + 1}`}
                                    disabled={editedSteps.length === 1}
                                    className="size-7 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                                    onClick={() => {
                                      setEditedExpectedResults(
                                        editedExpectedResults.filter(
                                          (_, resultIndex) => resultIndex !== index,
                                        ),
                                      );
                                      setEditedSteps(
                                        editedSteps.filter((_, stepIndex) => stepIndex !== index),
                                      );
                                    }}
                                  >
                                    <Trash2Icon className="h-3.5 w-3.5" aria-hidden="true" />
                                  </Button>
                                </div>
                              </li>
                            ))}
                          </ol>
                        </div>
                        <TestingCaseLocatorPicker
                          library={locatorLibrary}
                          selectedIds={editedCaseLocatorIds}
                          onChange={setEditedCaseLocatorIds}
                          label="Locator context for this case"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void reviewCase(selectedCase, "edited")}
                            disabled={busyAction !== null}
                          >
                            Save reviewed case
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingCaseId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
                          {selectedCase.steps.map((step, index) => (
                            <li key={`${selectedCase.id}-${index}`}>
                              <div>{step}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                <span className="font-medium text-foreground/80">Expected:</span>{" "}
                                {selectedCase.expectedResults[index] ||
                                  "No expected result recorded"}
                              </div>
                            </li>
                          ))}
                        </ol>
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/10 p-3">
                          <div>
                            <div className="text-sm font-medium text-foreground">
                              Locator context
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {(selectedCase.locatorEntryIds ?? []).length === 0
                                ? "No explicit locators mapped; generation will use verified path context."
                                : `${(selectedCase.locatorEntryIds ?? []).length} locator${(selectedCase.locatorEntryIds ?? []).length === 1 ? "" : "s"} mapped to this case.`}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => beginEditCase(selectedCase)}
                          >
                            Choose locators
                          </Button>
                        </div>
                        {selectedCase.mismatches.length > 0 ? (
                          <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                            <div className="text-sm font-medium text-foreground">
                              Review findings
                            </div>
                            {selectedCase.mismatches.map((mismatch) => (
                              <p
                                key={`${selectedCase.id}-${mismatch.kind}-${mismatch.stepIndex ?? "case"}-${mismatch.expected}`}
                                className="text-xs leading-5 text-muted-foreground"
                              >
                                Expected: {mismatch.expected}. Observed: {mismatch.actual}.
                              </p>
                            ))}
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          {selectedCase.reviewDecision === "pending" ||
                          selectedCase.reviewDecision === "rejected" ? (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void reviewCase(selectedCase, "accepted")}
                              disabled={busyAction !== null}
                            >
                              <CheckCircle2Icon aria-hidden="true" />
                              Accept case
                            </Button>
                          ) : (
                            <Badge variant="success" className="self-center">
                              Accepted
                            </Badge>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => beginEditCase(selectedCase)}
                            disabled={busyAction !== null}
                          >
                            <PencilIcon aria-hidden="true" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => void deleteCase(selectedCase)}
                            disabled={busyAction !== null}
                          >
                            <Trash2Icon aria-hidden="true" />
                            Delete
                          </Button>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  No cases match this search and filter.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

export default TestingCases;

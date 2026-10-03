import React, { memo, useState } from "react";
import type {
  ProjectId,
  TestingExplorationScope,
  TestingLocatorCoverageMode,
  TestingLocatorEntry,
} from "@tabs/contracts";
import {
  DEFAULT_TESTING_MAX_ELEMENTS_PER_PAGE,
  DEFAULT_TESTING_MAX_PAGES_PER_SESSION,
  MAX_TESTING_MAX_ELEMENTS_PER_PAGE,
  MAX_TESTING_MAX_PAGES_PER_SESSION,
  MIN_TESTING_MAX_ELEMENTS_PER_PAGE,
  MAX_TESTING_DURATION_SECONDS,
  MAX_TESTING_MAX_STATES,
} from "@tabs/contracts";
import {
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderSearchIcon,
  HelpCircleIcon,
  LoaderIcon,
  Maximize2Icon,
  Minimize2Icon,
  MonitorIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SmartphoneIcon,
  TabletIcon,
  Trash2Icon,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { SegmentedControl } from "~/components/ui/segmented-control";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";
import { useTestingData } from "./context";
import { InfoTooltip, NumberStepperInput, TestingApplicationPreview } from "./TestingWidgets";
import { testingLocatorCode, testingLocatorHasRedactedArgument } from "./utils";
import type { TestingAuthenticationMode } from "./types";
import { TestingJourneyRecorder } from "./TestingJourneyRecorder";

interface TestingDiscoverProps {
  projectId: ProjectId;
}

export const TestingDiscover = memo(function TestingDiscover({ projectId }: TestingDiscoverProps) {
  const [addressDraft, setAddressDraft] = useState<string | null>(null);
  const {
    locatorLibrary,
    targetUrl,
    setTargetUrl,
    normalizedTarget,
    cdpEndpoint,
    setCdpEndpoint,
    normalizedCdpEndpoint,
    explorationScope,
    setExplorationScope,
    authenticationMode,
    setAuthenticationMode,
    authCaptureOpen,
    authenticationReady,
    maxStates,
    setMaxStates,
    normalizedMaxStates,
    maxDurationMinutes,
    setMaxDurationMinutes,
    normalizedMaxDurationSeconds,
    busyAction,
    message,
    message_setter,
    status,
    startAuthCapture,
    finishAuthCapture,
    startExploration,
    clearGraph,
    setDiscoveryExperience,
    locatorSession,
    locatorMode,
    setLocatorMode,
    locatorCoverage,
    setLocatorCoverage,
    locatorMaxElements,
    setLocatorMaxElements,
    locatorMaxPages,
    setLocatorMaxPages,
    locatorNavigateUrl,
    setLocatorNavigateUrl,
    setLocatorStorageMode,
    locatorFolderResult,
    locatorSyncPreview,
    locatorCaptureScope,
    setLocatorCaptureScope,
    locatorTaskContext,
    setLocatorTaskContext,
    locatorAdvancedOpen,
    setLocatorAdvancedOpen,
    locatorViewport,
    setLocatorViewport,
    locatorPreviewExpanded,
    setLocatorPreviewExpanded,
    locatorPreviewFocusButtonRef,
    selectedLocatorPageId,
    setSelectedLocatorPageId,
    selectedLocatorPage,
    locatorPageTab,
    setLocatorPageTab,
    locatorPageName,
    setLocatorPageName,
    locatorCodeEntryIds,
    setLocatorCodeEntryIds,
    locatorRepositoryFolder,
    locatorRepositoryFileName,
    setLocatorRepositoryFileName,
    locatorRepositoryProposal,
    setLocatorRepositoryProposal,
    locatorRepositoryConfirmOpen,
    setLocatorRepositoryConfirmOpen,
    locatorCodeEditing,
    setLocatorCodeEditing,
    locatorCodeDraft,
    setLocatorCodeDraft,
    selectedLocatorEntryIds,
    setSelectedLocatorEntryIds,
    locatorSearch,
    setLocatorSearch,
    locatorFilter,
    setLocatorFilter,
    filteredLocatorEntries,
    editingLocatorEntry,
    pendingRemoveLocator,
    editingLocatorKey,
    setEditingLocatorKey,
    editingLocatorClassification,
    setEditingLocatorClassification,
    editingLocatorStrategy,
    setEditingLocatorStrategy,
    editingLocatorArguments,
    setEditingLocatorArguments,
    editingLocatorContext,
    setEditingLocatorContext,
    setEditingLocatorId,
    setLocatorPendingRemoveId,
    startLocatorDiscovery,
    navigateLocatorDiscovery,
    captureLocatorPage,
    finishLocatorDiscovery,
    rescanLocatorPage,
    deleteLocatorPage,
    indexLocatorFolder,
    approveSelectedLocators,
    reviewLocator,
    startEditingLocator,
    saveLocatorChanges,
    saveLocatorPageName,
    saveLocatorCodeSelection,
    savePageObjectCode,
    chooseLocatorRepositoryFolder,
    previewLocatorRepositoryChange,
    applyLocatorRepositoryChange,
    resolveLocatorSync,
    disconnectLocatorFolder,
  } = useTestingData();

  const [workflowStep, setWorkflowStep] = useState<1 | 2 | 3>(1);

  return (
    <div className="space-y-6">
      {locatorLibrary?.featureAvailable && locatorLibrary.experience === "classic" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
          <div>
            <div className="text-sm font-medium">Classic discovery</div>
            <div className="text-xs text-muted-foreground">
              Legacy graph-first controls are active for this project.
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void setDiscoveryExperience("locator-first")}
          >
            Use Locator-first Discover
          </Button>
        </div>
      ) : null}

      {locatorLibrary?.experience !== "locator-first" ? (
        <>
          <div className="space-y-4" aria-label="Application discovery setup">
            <Card>
              <CardHeader className="pb-3">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
                  Step 1
                </div>
                <CardTitle className="text-base font-semibold">Choose Target &amp; Scope</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="testing-target-url"
                    className="flex items-center text-sm font-medium text-foreground"
                  >
                    Target URL
                    <InfoTooltip content="Exact starting web or local URL for exploration." />
                  </label>
                  <Input
                    id="testing-target-url"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    placeholder="https://uat.example.com/settings"
                    value={targetUrl}
                    onChange={(event) => setTargetUrl(event.target.value)}
                    aria-describedby="testing-target-help"
                    aria-invalid={targetUrl.trim().length > 0 && normalizedTarget === null}
                    disabled={busyAction !== null || authCaptureOpen}
                  />
                </div>

                <div className="space-y-2">
                  <label className="flex items-center text-sm font-medium text-foreground">
                    Exploration Scope
                    <InfoTooltip content="Single Page limits to target URL. Subpaths crawls child routes. Entire Origin explores all reachable domain links." />
                  </label>
                  <div
                    role="radiogroup"
                    aria-label="Exploration Scope"
                    className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                  >
                    {[
                      {
                        id: "page",
                        title: "Single Page",
                        subtitle: "Exact URL only",
                      },
                      {
                        id: "path",
                        title: "Page & Subpaths",
                        subtitle: "Child routes & subpages",
                      },
                      {
                        id: "origin",
                        title: "Entire Origin",
                        subtitle: "All domain paths",
                      },
                    ].map((option) => {
                      const active = explorationScope === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setExplorationScope(option.id as TestingExplorationScope)}
                          disabled={busyAction !== null || authCaptureOpen}
                          className={cn(
                            "flex flex-col text-left p-3 rounded-xl border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed",
                            active
                              ? "border-foreground/30 bg-card text-foreground shadow-sm ring-1 ring-border/80"
                              : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                          )}
                        >
                          <span className="text-xs font-semibold text-foreground flex items-center justify-between">
                            {option.title}
                            {active ? (
                              <span className="size-1.5 rounded-full bg-foreground" />
                            ) : null}
                          </span>
                          <span className="mt-0.5 text-[11px] text-muted-foreground/80 font-normal">
                            {option.subtitle}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
                  Step 2
                </div>
                <CardTitle className="text-base font-semibold">Prepare Access</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="flex items-center text-sm font-medium text-foreground">
                    Authentication Method
                    <InfoTooltip content="Tabs never asks for or stores usernames, passwords, cookies, or MFA tokens in test data." />
                  </label>
                  <div
                    role="radiogroup"
                    aria-label="Authentication Method"
                    className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                  >
                    {[
                      {
                        id: "none",
                        title: "Public / None",
                        subtitle: "No sign-in required",
                      },
                      {
                        id: "local-profile",
                        title: "Local Browser",
                        subtitle: "Interactive sign-in",
                      },
                      {
                        id: "connected-session",
                        title: "CDP Session",
                        subtitle: "Existing dev instance",
                      },
                    ].map((option) => {
                      const active = authenticationMode === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() =>
                            setAuthenticationMode(option.id as TestingAuthenticationMode)
                          }
                          disabled={busyAction !== null || authCaptureOpen}
                          className={cn(
                            "flex flex-col text-left p-3 rounded-xl border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed",
                            active
                              ? "border-foreground/30 bg-card text-foreground shadow-sm ring-1 ring-border/80"
                              : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                          )}
                        >
                          <span className="text-xs font-semibold text-foreground flex items-center justify-between">
                            {option.title}
                            {active ? (
                              <span className="size-1.5 rounded-full bg-foreground" />
                            ) : null}
                          </span>
                          <span className="mt-0.5 text-[11px] text-muted-foreground/80 font-normal">
                            {option.subtitle}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {authenticationMode === "local-profile" ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 p-3.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2.5 rounded-full shrink-0",
                          status?.authCapturedAt ? "bg-emerald-500 shadow-sm" : "bg-amber-500",
                        )}
                        aria-hidden="true"
                      />
                      <span className="text-xs font-medium text-foreground">
                        {status?.authCapturedAt
                          ? "Local browser session active & saved"
                          : "No local browser session captured"}
                      </span>
                    </div>
                    {!authCaptureOpen ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void startAuthCapture()}
                        disabled={!normalizedTarget || busyAction !== null}
                      >
                        {busyAction === "auth" ? (
                          <LoaderIcon aria-hidden="true" className="animate-spin" />
                        ) : null}
                        Open Browser to Sign In
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void finishAuthCapture()}
                        disabled={busyAction !== null}
                      >
                        {busyAction === "finish-auth" ? (
                          <LoaderIcon aria-hidden="true" className="animate-spin" />
                        ) : null}
                        Finish &amp; Save Local Session
                      </Button>
                    )}
                  </div>
                ) : authenticationMode === "connected-session" ? (
                  <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5">
                    <div className="space-y-2">
                      <label
                        htmlFor="testing-cdp-endpoint"
                        className="text-sm font-medium text-foreground"
                      >
                        Local CDP Endpoint
                      </label>
                      <Input
                        id="testing-cdp-endpoint"
                        type="url"
                        inputMode="url"
                        placeholder="http://127.0.0.1:9224"
                        value={cdpEndpoint}
                        onChange={(event) => setCdpEndpoint(event.target.value)}
                        aria-describedby="testing-cdp-endpoint-help"
                        aria-invalid={normalizedCdpEndpoint === null}
                        disabled={busyAction !== null || authCaptureOpen}
                      />
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border border-border/80 shadow-sm">
              <CardHeader className="pb-3">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
                  Step 3
                </div>
                <CardTitle className="text-base font-semibold">Set Limits &amp; Explore</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label
                      htmlFor="testing-max-states"
                      className="flex items-center text-sm font-medium text-foreground"
                    >
                      Maximum States
                      <InfoTooltip content="Exploration stops automatically when this number of unique application states is discovered (1 to 10,000)." />
                    </label>
                    <NumberStepperInput
                      id="testing-max-states"
                      min={1}
                      max={MAX_TESTING_MAX_STATES}
                      step={1}
                      value={maxStates}
                      onChange={setMaxStates}
                      ariaDescribedBy="testing-max-states-help"
                      ariaInvalid={normalizedMaxStates === null}
                      disabled={busyAction !== null || authCaptureOpen}
                    />
                    <p id="testing-max-states-help" className="text-xs text-muted-foreground">
                      Target limit (1 - {MAX_TESTING_MAX_STATES.toLocaleString()})
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="testing-max-duration"
                      className="flex items-center text-sm font-medium text-foreground"
                    >
                      Time Budget (Minutes)
                      <InfoTooltip content="Maximum run time limit in minutes. Leave clear for no time restriction." />
                    </label>
                    <NumberStepperInput
                      id="testing-max-duration"
                      min={1 / 60}
                      max={MAX_TESTING_DURATION_SECONDS / 60}
                      step={1}
                      value={maxDurationMinutes}
                      onChange={setMaxDurationMinutes}
                      ariaDescribedBy="testing-max-duration-help"
                      ariaInvalid={normalizedMaxDurationSeconds === null}
                      disabled={busyAction !== null || authCaptureOpen}
                    />
                    <p id="testing-max-duration-help" className="text-xs text-muted-foreground">
                      Optional time boundary
                    </p>
                  </div>
                </div>

                {!authenticationReady ? (
                  <p className="text-xs font-medium text-amber-600/90" role="note">
                    Complete Step 2 authentication setup before beginning exploration.
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "size-2 rounded-full shrink-0",
                        normalizedTarget && authenticationReady ? "bg-emerald-500" : "bg-amber-500",
                      )}
                      aria-hidden="true"
                    />
                    <span className="text-xs font-medium text-muted-foreground">
                      {message || "Ready to explore workspace application."}
                    </span>
                  </div>

                  <Button
                    type="button"
                    size="default"
                    onClick={() => void startExploration()}
                    disabled={
                      !normalizedTarget ||
                      normalizedMaxStates === null ||
                      normalizedMaxDurationSeconds === null ||
                      !authenticationReady ||
                      busyAction !== null ||
                      authCaptureOpen
                    }
                    className="px-5 font-semibold shadow-sm"
                  >
                    {busyAction === "explore" ? (
                      <LoaderIcon aria-hidden="true" className="animate-spin" />
                    ) : (
                      <PlayIcon aria-hidden="true" />
                    )}
                    Start Scoped Exploration
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <section aria-labelledby="testing-graph-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="testing-graph-heading" className="text-lg font-semibold text-foreground">
                  Stored graph
                </h2>
                <p className="text-xs text-muted-foreground">
                  Every completed exploration updates this local graph. Run Step 3 again to refresh
                  it from the latest application state.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void startExploration()}
                  disabled={
                    !normalizedTarget ||
                    normalizedMaxStates === null ||
                    normalizedMaxDurationSeconds === null ||
                    !authenticationReady ||
                    busyAction !== null
                  }
                >
                  <RefreshCwIcon aria-hidden="true" />
                  Update graph
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void clearGraph()}
                  disabled={busyAction !== null || (status?.nodeCount ?? 0) === 0}
                >
                  <Trash2Icon aria-hidden="true" />
                  Clear graph
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["States", status?.nodeCount ?? 0],
                ["Transitions", status?.edgeCount ?? 0],
                ["Cached subtrees", status?.cacheEntryCount ?? 0],
                ["Cache hits", status?.cacheHitCount ?? 0],
              ].map(([label, value]) => (
                <Card key={label}>
                  <CardContent className="py-5">
                    <div className="text-2xl font-semibold text-foreground">{value}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="break-all text-xs text-muted-foreground">
              {status?.databasePath
                ? `Local workspace database: ${status.databasePath}`
                : "The local graph database is created when Testing initializes."}
            </p>
          </section>
        </>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-[10px] tracking-wider uppercase">
                  Locator-first
                </Badge>
                <span className="text-xs text-muted-foreground font-medium">
                  {workflowStep === 1
                    ? "Step 1 of 3: Scan & Preview"
                    : workflowStep === 2
                      ? "Step 2 of 3: Choose Locators"
                      : "Step 3 of 3: Use in Code"}
                </span>
              </div>
              <h2 className="text-xl font-semibold text-foreground">
                Capture locators from the page you need
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Open the app, scan the current page, then choose the controls and outcomes that
                belong in your page object. Nothing is written to your repository without a reviewed
                diff.
              </p>
            </div>
            {(() => {
              const step1Done = Boolean(locatorSession);
              const step2Done = step1Done && selectedLocatorEntryIds.size > 0;
              const step3Done =
                step2Done &&
                Boolean(
                  selectedLocatorPage?.entries.some(
                    (entry) => entry.lifecycleStatus === "accepted",
                  ),
                );

              return (
                <div
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/60 p-1 text-xs shadow-xs"
                  role="navigation"
                  aria-label="Locator workflow progression"
                >
                  {/* Step 1: Open */}
                  <button
                    type="button"
                    onClick={() => setWorkflowStep(1)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      workflowStep === 1
                        ? "border border-primary/30 bg-primary/10 font-semibold text-foreground shadow-xs"
                        : step1Done
                          ? "border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                          : "border border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded-full text-[10px] font-bold shrink-0",
                        workflowStep === 1
                          ? "bg-primary text-primary-foreground"
                          : step1Done
                            ? "bg-emerald-500 text-white"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {step1Done && workflowStep !== 1 ? (
                        <CheckIcon className="size-2.5 stroke-[3]" />
                      ) : (
                        "1"
                      )}
                    </span>
                    <span>Open</span>
                  </button>

                  <ChevronRightIcon
                    aria-hidden="true"
                    className="size-3 shrink-0 text-muted-foreground/30"
                  />

                  {/* Step 2: Choose */}
                  <button
                    type="button"
                    onClick={() => setWorkflowStep(2)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      workflowStep === 2
                        ? "border border-primary/30 bg-primary/10 font-semibold text-foreground shadow-xs"
                        : step2Done
                          ? "border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                          : "border border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded-full text-[10px] font-bold shrink-0",
                        workflowStep === 2
                          ? "bg-primary text-primary-foreground"
                          : step2Done
                            ? "bg-emerald-500 text-white"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {step2Done && workflowStep !== 2 ? (
                        <CheckIcon className="size-2.5 stroke-[3]" />
                      ) : (
                        "2"
                      )}
                    </span>
                    <span>Choose</span>
                  </button>

                  <ChevronRightIcon
                    aria-hidden="true"
                    className="size-3 shrink-0 text-muted-foreground/30"
                  />

                  {/* Step 3: Use in code */}
                  <button
                    type="button"
                    onClick={() => setWorkflowStep(3)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      workflowStep === 3
                        ? "border border-primary/30 bg-primary/10 font-semibold text-foreground shadow-xs"
                        : step3Done
                          ? "border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                          : "border border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded-full text-[10px] font-bold shrink-0",
                        workflowStep === 3
                          ? "bg-primary text-primary-foreground"
                          : step3Done
                            ? "bg-emerald-500 text-white"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {step3Done && workflowStep !== 3 ? (
                        <CheckIcon className="size-2.5 stroke-[3]" />
                      ) : (
                        "3"
                      )}
                    </span>
                    <span>Use in code</span>
                  </button>
                </div>
              );
            })()}
          </div>

          <div className="space-y-6">
            {/* STEP 1: CONFIGURE & SCAN PAGE */}
            {workflowStep === 1 ? (
              <section
                className={cn(
                  "rounded-2xl border border-border/70 bg-card shadow-sm",
                  locatorPreviewExpanded ? "overflow-visible" : "overflow-hidden",
                )}
              >
                <div className="divide-y divide-border/60">
                  <aside className="space-y-3 bg-muted/15 p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-foreground">
                            Step 1 of 3
                          </span>
                          <span className="text-xs text-muted-foreground font-medium">
                            Scan Target
                          </span>
                        </div>
                        <h3 className="mt-1.5 text-base font-semibold text-foreground">
                          Configure & Scan Target Page
                        </h3>
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          Select your capture scope and application access mode, then click{" "}
                          <span className="font-medium text-foreground">Scan this page</span> to
                          launch the live inspector.
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="border-border/70 bg-background/50 text-[11px]"
                      >
                        Safe · No repository changes
                      </Badge>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold" htmlFor="locator-scope">
                          Capture scope
                        </label>
                        <Select
                          value={locatorCaptureScope}
                          onValueChange={(value) =>
                            setLocatorCaptureScope(value as typeof locatorCaptureScope)
                          }
                        >
                          <SelectTrigger id="locator-scope">
                            <span className="flex-1 truncate">
                              {
                                {
                                  task: "A specific case or task",
                                  page: "The current page",
                                  path: "A page flow or section",
                                  origin: "The complete application",
                                }[locatorCaptureScope]
                              }
                            </span>
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value="task">A specific case or task</SelectItem>
                            <SelectItem value="page">The current page</SelectItem>
                            <SelectItem value="path">A page flow or section</SelectItem>
                            <SelectItem value="origin">The complete application</SelectItem>
                          </SelectPopup>
                        </Select>
                        {locatorCaptureScope === "task" ? (
                          <Textarea
                            value={locatorTaskContext}
                            onChange={(event) => setLocatorTaskContext(event.target.value)}
                            placeholder="Example: update account profile and verify success"
                            aria-label="Case or task to capture locators for"
                            className="min-h-20 text-xs"
                          />
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold">Application access</div>
                        <Select
                          value={authenticationMode}
                          onValueChange={(value) =>
                            setAuthenticationMode(value as TestingAuthenticationMode)
                          }
                        >
                          <SelectTrigger aria-label="Application access method">
                            <span className="flex-1 truncate">
                              {
                                {
                                  none: "No authentication",
                                  "local-profile": "Sign in manually",
                                  "connected-session": "Reuse Electron / Chromium",
                                }[authenticationMode]
                              }
                            </span>
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value="none">No authentication</SelectItem>
                            <SelectItem value="local-profile">Sign in manually</SelectItem>
                            <SelectItem value="connected-session">
                              Reuse Electron / Chromium
                            </SelectItem>
                          </SelectPopup>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold">How to explore</div>
                        <SegmentedControl
                          value={locatorMode}
                          onValueChange={setLocatorMode}
                          options={[
                            { value: "manual", label: "Manual" },
                            { value: "guided", label: "Guided" },
                          ]}
                          className="w-full flex"
                          itemClassName="flex-1 justify-center"
                          aria-label="Exploration mode"
                        />
                      </div>
                    </div>
                    <div
                      className="flex gap-3 rounded-xl border border-border/60 bg-muted/20 p-3"
                      role="note"
                    >
                      <HelpCircleIcon
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-foreground"
                      />
                      <div className="text-xs leading-5">
                        <span className="font-semibold text-foreground">
                          What will be captured?{" "}
                        </span>
                        <span className="text-muted-foreground">
                          {locatorCoverage === "actions-only"
                            ? "Interactive controls such as buttons, links, inputs, checkboxes, switches, menus, and tabs."
                            : locatorCoverage === "everything-accessible"
                              ? "All named accessible elements on the page, including controls, outcomes, and readable content."
                              : "Interactive controls plus useful outcomes such as headings, dialogs, alerts, statuses, progress indicators, and tables. Decorative layout and hidden content are excluded."}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-3 border-t border-border/50 pt-3">
                      <Collapsible
                        open={locatorAdvancedOpen}
                        onOpenChange={setLocatorAdvancedOpen}
                        className="w-full"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <CollapsibleTrigger className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-card/70 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all">
                            <SlidersHorizontalIcon
                              aria-hidden="true"
                              className="size-3.5 text-foreground"
                            />
                            <span>Advanced options</span>
                            <ChevronDownIcon
                              aria-hidden="true"
                              className={cn(
                                "size-3.5 transition-transform duration-200",
                                locatorAdvancedOpen && "rotate-180",
                              )}
                            />
                          </CollapsibleTrigger>

                          {
                            <Button
                              type="button"
                              onClick={async () => {
                                const captured =
                                  locatorSession?.status === "running"
                                    ? await captureLocatorPage(
                                        locatorCaptureScope === "task" ? "relevant" : "all",
                                      )
                                    : await startLocatorDiscovery();
                                if (captured) setWorkflowStep(2);
                              }}
                              disabled={
                                !normalizedTarget ||
                                busyAction !== null ||
                                (locatorCaptureScope === "task" && !locatorTaskContext.trim())
                              }
                              className="w-full sm:w-auto shadow-xs"
                            >
                              {busyAction === "locator-discovery" ? (
                                <LoaderIcon className="animate-spin" aria-hidden="true" />
                              ) : (
                                <PlayIcon aria-hidden="true" />
                              )}
                              Scan this page
                            </Button>
                          }
                        </div>

                        <CollapsibleContent className="mt-3">
                          <div className="rounded-xl border border-border/70 bg-card/75 p-4 shadow-2xs space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                              {/* What to capture */}
                              <div className="space-y-1.5">
                                <label
                                  htmlFor="locator-coverage"
                                  className="text-xs font-semibold text-foreground"
                                >
                                  What to capture
                                </label>
                                <Select
                                  value={locatorCoverage}
                                  onValueChange={(value) =>
                                    setLocatorCoverage(value as TestingLocatorCoverageMode)
                                  }
                                >
                                  <SelectTrigger id="locator-coverage" aria-label="What to capture">
                                    <span className="flex-1 truncate">
                                      {
                                        {
                                          "actions-assertions": "Controls + outcomes (recommended)",
                                          "actions-only": "Controls only",
                                          "everything-accessible": "Everything accessible",
                                        }[locatorCoverage]
                                      }
                                    </span>
                                  </SelectTrigger>
                                  <SelectPopup>
                                    <SelectItem value="actions-assertions">
                                      Controls + outcomes (recommended)
                                    </SelectItem>
                                    <SelectItem value="actions-only">Controls only</SelectItem>
                                    <SelectItem value="everything-accessible">
                                      Everything accessible
                                    </SelectItem>
                                  </SelectPopup>
                                </Select>
                                <p className="text-[11px] leading-4 text-muted-foreground">
                                  {locatorCoverage === "actions-only"
                                    ? "Captures interactive controls like buttons, links, inputs, and dropdowns."
                                    : locatorCoverage === "everything-accessible"
                                      ? "Captures all accessible element names, headings, labels, and text."
                                      : "Captures interactive controls plus assertion outcomes (dialogs, alerts, banners)."}
                                </p>
                              </div>

                              {/* Multi-page exploration depth */}
                              <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-foreground">
                                  Exploration crawl depth
                                </label>
                                <SegmentedControl
                                  value={locatorMode === "automatic" ? "automatic" : "single"}
                                  onValueChange={(v) =>
                                    setLocatorMode(v === "automatic" ? "automatic" : "guided")
                                  }
                                  options={[
                                    { value: "single", label: "Single page (Target)" },
                                    { value: "automatic", label: "Automated crawl" },
                                  ]}
                                  className="w-full flex"
                                  itemClassName="flex-1 justify-center text-xs"
                                  aria-label="Exploration crawl mode"
                                />
                                <p className="text-[11px] leading-4 text-muted-foreground">
                                  {locatorMode === "automatic"
                                    ? "Autonomous crawler will follow links and discover locators across pages."
                                    : "Focuses specifically on the single specified target URL or flow."}
                                </p>
                              </div>
                            </div>

                            {locatorMode === "automatic" ? (
                              <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/25 p-3 sm:grid-cols-2">
                                <div className="space-y-1">
                                  <label
                                    htmlFor="locator-max-elements"
                                    className="text-xs font-medium text-muted-foreground"
                                  >
                                    Max elements per page
                                  </label>
                                  <Input
                                    id="locator-max-elements"
                                    type="number"
                                    aria-label="Maximum elements per page"
                                    min={MIN_TESTING_MAX_ELEMENTS_PER_PAGE}
                                    max={MAX_TESTING_MAX_ELEMENTS_PER_PAGE}
                                    value={locatorMaxElements}
                                    onChange={(event) => setLocatorMaxElements(event.target.value)}
                                    className="h-8 text-xs"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label
                                    htmlFor="locator-max-pages"
                                    className="text-xs font-medium text-muted-foreground"
                                  >
                                    Max pages to crawl
                                  </label>
                                  <Input
                                    id="locator-max-pages"
                                    type="number"
                                    aria-label="Maximum pages per session"
                                    min={1}
                                    max={MAX_TESTING_MAX_PAGES_PER_SESSION}
                                    value={locatorMaxPages}
                                    onChange={(event) => setLocatorMaxPages(event.target.value)}
                                    className="h-8 text-xs"
                                  />
                                </div>
                              </div>
                            ) : null}

                            {/* Classic Discovery link */}
                            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-3">
                              <div className="space-y-0.5">
                                <span className="text-xs font-medium text-foreground">
                                  Need full graph transition mapping?
                                </span>
                                <p className="text-[11px] text-muted-foreground">
                                  Switch to Classic Discovery to model the entire app state graph.
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => void setDiscoveryExperience("classic")}
                                className="text-xs gap-1.5"
                              >
                                <span>Open Classic discovery</span>
                                <ArrowRightIcon className="size-3.5" aria-hidden="true" />
                              </Button>
                            </div>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </div>
                  </aside>

                  <div
                    className={cn(
                      "min-w-0",
                      locatorPreviewExpanded &&
                        "fixed inset-3 z-[80] flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl",
                    )}
                    role={locatorPreviewExpanded ? "dialog" : undefined}
                    aria-modal={locatorPreviewExpanded ? true : undefined}
                    aria-label={locatorPreviewExpanded ? "Focused application preview" : undefined}
                  >
                    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/10 p-3">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label="Go back in preview"
                        onClick={() =>
                          void window.desktopBridge?.goBackBrowserSession({
                            projectId,
                            sessionId: `testing:${projectId}`,
                          })
                        }
                      >
                        <ArrowLeftIcon aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label="Go forward in preview"
                        onClick={() =>
                          void window.desktopBridge?.goForwardBrowserSession({
                            projectId,
                            sessionId: `testing:${projectId}`,
                          })
                        }
                      >
                        <ArrowRightIcon aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label="Refresh preview"
                        onClick={() =>
                          void window.desktopBridge?.reloadBrowserSession({
                            projectId,
                            sessionId: `testing:${projectId}`,
                          })
                        }
                      >
                        <RefreshCwIcon aria-hidden="true" />
                      </Button>
                      <Input
                        id="locator-target-url"
                        type="url"
                        value={addressDraft ?? (locatorNavigateUrl || targetUrl)}
                        onChange={(event) => {
                          setAddressDraft(event.target.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void navigateLocatorDiscovery(
                              addressDraft ?? (locatorNavigateUrl || targetUrl),
                            );
                            setAddressDraft(null);
                          }
                        }}
                        placeholder="https://uat.example.com/account"
                        aria-label="Testing preview URL"
                        className="min-w-56 flex-1"
                      />
                      <Button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => {
                          void navigateLocatorDiscovery(
                            addressDraft ?? (locatorNavigateUrl || targetUrl),
                          );
                          setAddressDraft(null);
                        }}
                      >
                        Open
                      </Button>
                      <SegmentedControl
                        size="sm"
                        value={locatorViewport}
                        onValueChange={setLocatorViewport}
                        options={[
                          {
                            value: "desktop",
                            label: <MonitorIcon aria-hidden="true" className="size-3.5" />,
                            ariaLabel: "Desktop preview",
                          },
                          {
                            value: "tablet",
                            label: <TabletIcon aria-hidden="true" className="size-3.5" />,
                            ariaLabel: "Tablet preview",
                          },
                          {
                            value: "mobile",
                            label: <SmartphoneIcon aria-hidden="true" className="size-3.5" />,
                            ariaLabel: "Mobile preview",
                          },
                        ]}
                        aria-label="Preview viewport"
                      />
                      <Badge variant="outline" className="tabular-nums">
                        {locatorViewport === "desktop"
                          ? "Desktop / 16:9"
                          : locatorViewport === "tablet"
                            ? "Tablet / 4:3"
                            : "Mobile / 9:16"}
                      </Badge>
                      <Button
                        ref={locatorPreviewFocusButtonRef}
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={
                          locatorPreviewExpanded ? "Exit focused preview" : "Focus preview"
                        }
                        aria-pressed={locatorPreviewExpanded}
                        onClick={() => setLocatorPreviewExpanded(!locatorPreviewExpanded)}
                      >
                        {locatorPreviewExpanded ? (
                          <Minimize2Icon aria-hidden="true" />
                        ) : (
                          <Maximize2Icon aria-hidden="true" />
                        )}
                      </Button>
                    </div>
                    <div
                      className={cn(
                        locatorPreviewExpanded &&
                          "flex min-h-0 flex-1 items-center justify-center bg-black/20 p-3",
                      )}
                    >
                      <div
                        className={cn(
                          "relative aspect-video overflow-hidden bg-muted/20",
                          locatorPreviewExpanded ? "h-full w-auto max-w-full" : "w-full",
                        )}
                      >
                        {normalizedTarget ? (
                          <TestingApplicationPreview
                            projectId={projectId}
                            targetUrl={locatorNavigateUrl || normalizedTarget}
                            sessionId={`testing:${projectId}`}
                            viewport={locatorViewport}
                            onUrlChange={setLocatorNavigateUrl}
                          />
                        ) : (
                          <div className="flex h-full min-h-80 items-center justify-center rounded-lg border border-dashed border-border/70 bg-background/40 p-8 text-center text-sm text-muted-foreground">
                            Enter a starting URL above. The page stays contained here while you
                            navigate and scroll.
                          </div>
                        )}
                      </div>
                    </div>
                    <TestingJourneyRecorder />
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 p-3">
                      <div className="text-xs text-muted-foreground" aria-live="polite">
                        <span className="block">
                          {locatorSession
                            ? `${locatorSession.capturedPages} pages, ${locatorSession.storedElements} locators captured`
                            : "Preview first, then start a focused discovery session."}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {locatorSession?.status === "running" ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={async () => {
                                if (
                                  await captureLocatorPage(
                                    locatorCaptureScope === "task" ? "relevant" : "all",
                                  )
                                )
                                  setWorkflowStep(2);
                              }}
                              disabled={busyAction !== null}
                            >
                              Scan this page
                            </Button>
                            <Menu>
                              <MenuTrigger
                                render={
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    aria-label="More discovery actions"
                                    disabled={busyAction !== null}
                                  />
                                }
                              >
                                <ChevronDownIcon aria-hidden="true" />
                                Actions
                              </MenuTrigger>
                              <MenuPopup align="end">
                                <MenuItem onClick={() => void captureLocatorPage("all")}>
                                  Scan all elements on this page
                                </MenuItem>
                                <MenuSeparator />
                                <MenuItem
                                  onClick={async () => {
                                    await finishLocatorDiscovery(false);
                                    setWorkflowStep(2);
                                  }}
                                >
                                  Finish discovery
                                </MenuItem>
                                <MenuItem onClick={() => void finishLocatorDiscovery(true)}>
                                  Cancel discovery
                                </MenuItem>
                              </MenuPopup>
                            </Menu>
                          </>
                        ) : (
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={() => setWorkflowStep(2)}
                            className="gap-1.5"
                          >
                            <span>Next: Choose Locators</span>
                            <ChevronRightIcon className="size-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {/* STEP 2: CHOOSE LOCATORS */}
            {workflowStep === 2 ? (
              <section className="rounded-2xl border border-border/70 bg-card shadow-sm overflow-hidden">
                <div className="border-b border-border/60 bg-muted/15 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-foreground">
                          Step 2 of 3
                        </span>
                        <span className="text-xs text-muted-foreground font-medium">
                          Element Inspector
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3">
                        <h3 className="text-base font-semibold text-foreground">Choose Locators</h3>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {selectedLocatorEntryIds.size} selected
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
                        {selectedLocatorPage
                          ? `${selectedLocatorPage.name} - ${selectedLocatorPage.urlPattern}`
                          : "Open and scan a page to choose its locators."}
                      </p>
                    </div>
                  </div>
                </div>

                <div
                  className="grid max-h-[38rem] grid-cols-1 gap-3 overflow-y-auto overscroll-contain p-4 md:grid-cols-2 xl:grid-cols-3 bg-muted/5"
                  aria-label="Captured locator candidates"
                >
                  {(selectedLocatorPage?.entries ?? [])
                    .filter((entry) => entry.lifecycleStatus !== "archived")
                    .map((entry) => {
                      const manualRequired =
                        entry.lifecycleStatus === "manual-required" ||
                        testingLocatorHasRedactedArgument(entry);
                      const selected = selectedLocatorEntryIds.has(entry.id);
                      return (
                        <div
                          key={entry.id}
                          className={cn(
                            "block rounded-xl border p-3 transition-colors",
                            selected
                              ? "border-primary/40 bg-primary/5"
                              : "border-border/60 bg-background/70",
                            manualRequired ? "cursor-default" : "cursor-pointer",
                          )}
                        >
                          <span className="flex items-start gap-2.5">
                            {manualRequired ? (
                              <span
                                className="mt-0.5 flex size-4 items-center justify-center rounded-full border border-amber-500/50 text-amber-600"
                                aria-label="Manual locator required"
                              >
                                <HelpCircleIcon aria-hidden="true" className="size-3" />
                              </span>
                            ) : (
                              <Checkbox
                                checked={selected}
                                onClick={() =>
                                  setSelectedLocatorEntryIds((previous) => {
                                    const next = new Set(previous);
                                    if (next.has(entry.id)) next.delete(entry.id);
                                    else next.add(entry.id);
                                    return next;
                                  })
                                }
                                aria-label={`Include ${entry.locatorKey}`}
                                className="mt-0.5"
                              />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate font-mono text-xs font-medium">
                                  {entry.locatorKey}
                                </span>
                              </span>
                              <span className="mt-1 block text-xs text-muted-foreground">
                                {entry.semanticContext}
                              </span>
                              <code className="mt-2 block overflow-x-auto rounded-md bg-muted/70 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground">
                                {testingLocatorCode(entry)}
                              </code>
                            </span>
                          </span>
                        </div>
                      );
                    })}
                </div>

                {/* Step 2 Bottom Navigation */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-card p-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setWorkflowStep(1)}
                    className="gap-1.5"
                  >
                    <ChevronLeftIcon className="size-4" />
                    <span>Back</span>
                  </Button>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="w-full whitespace-normal sm:w-auto gap-1.5"
                      onClick={async () => {
                        await approveSelectedLocators();
                        setWorkflowStep(3);
                      }}
                      disabled={selectedLocatorEntryIds.size === 0 || busyAction !== null}
                    >
                      {busyAction === "locator-review" ? (
                        <LoaderIcon aria-hidden="true" className="size-4 animate-spin" />
                      ) : (
                        <CheckIcon aria-hidden="true" className="size-4" />
                      )}
                      <span>Add to page object</span>
                    </Button>

                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setWorkflowStep(3)}
                      className="gap-1.5"
                    >
                      <span>Next</span>
                      <ChevronRightIcon className="size-4" />
                    </Button>
                  </div>
                </div>
              </section>
            ) : null}

            {/* STEP 3: USE IN CODE & LOCATOR LIBRARY */}
            {workflowStep === 3 ? (
              <div className="space-y-5">
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-foreground">
                            Step 3 of 3
                          </span>
                          <span className="text-xs text-muted-foreground font-medium">
                            Export Page Object
                          </span>
                        </div>
                        <CardTitle>Your locator code is ready</CardTitle>
                        <CardDescription>
                          Approved locators are saved as a versioned draft inside this Tabs project.
                          Your repository has not been changed.
                        </CardDescription>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setWorkflowStep(2)}
                        className="gap-1.5"
                      >
                        <ChevronLeftIcon className="size-4" />
                        <span>Back to Choose Locators</span>
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-3" aria-label="Code status">
                      {[
                        ["1", "Saved locally", "Safe managed draft with version history."],
                        ["2", "Review by page", "Choose locators, preview code, or edit it."],
                        ["3", "Apply only when ready", "Choose a file and confirm the diff."],
                      ].map(([number, label, description]) => (
                        <div
                          key={number}
                          className="flex gap-3 rounded-xl border border-border/60 bg-muted/15 p-3"
                        >
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-foreground">
                            {number}
                          </span>
                          <div>
                            <div className="text-sm font-semibold">{label}</div>
                            <div className="mt-1 text-xs leading-5 text-muted-foreground">
                              {description}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 p-4">
                      <div className="max-w-2xl">
                        <h4 className="text-sm font-semibold">
                          {locatorFolderResult
                            ? "Existing page-object folder connected"
                            : "Already have company page objects?"}
                        </h4>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Optional: compare against a folder inside this project. Tabs reads
                          TypeScript and JavaScript statically and never executes it.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={locatorFolderResult ? "outline" : "default"}
                          disabled={busyAction !== null}
                          onClick={() => {
                            setLocatorStorageMode("connected-repository");
                            void indexLocatorFolder("connected-repository");
                          }}
                        >
                          <FolderSearchIcon aria-hidden="true" />
                          {locatorFolderResult ? "Compare another folder" : "Compare a folder"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busyAction !== null}
                          onClick={() => {
                            setLocatorStorageMode("snapshot-export");
                            void indexLocatorFolder("snapshot-export");
                          }}
                        >
                          Import an independent copy
                        </Button>
                        {locatorFolderResult ? (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => void disconnectLocatorFolder()}
                          >
                            Disconnect
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {locatorFolderResult ? (
                      <div className="space-y-3" aria-live="polite">
                        <div className="grid gap-2 sm:grid-cols-4">
                          {[
                            ["Recognized", locatorFolderResult.recognized],
                            ["Warnings", locatorFolderResult.warnings],
                            ["Unsupported / dynamic", locatorFolderResult.unsupportedDynamic],
                            [
                              "Files parsed",
                              `${locatorFolderResult.filesParsed}/${locatorFolderResult.filesScanned}`,
                            ],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded-lg bg-muted/35 p-3">
                              <div className="font-semibold">{value}</div>
                              <div className="text-xs text-muted-foreground">{label}</div>
                            </div>
                          ))}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Recognition rate:{" "}
                          {locatorFolderResult.recognitionRate === null
                            ? "Not applicable"
                            : `${locatorFolderResult.recognitionRate.toFixed(1)}%`}
                          . File parse coverage:{" "}
                          {locatorFolderResult.fileParseCoverage === null
                            ? "Not applicable"
                            : `${locatorFolderResult.fileParseCoverage.toFixed(1)}%`}
                          .
                        </p>
                      </div>
                    ) : null}
                    {locatorSyncPreview?.items.some((item) => item.status === "pending") ? (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium">Synchronization review</h4>
                        {locatorSyncPreview.items
                          .filter((item) => item.status === "pending")
                          .map((item) => (
                            <div
                              key={item.id}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
                            >
                              <div>
                                <div className="font-mono text-sm">{item.locatorKey}</div>
                                <div className="text-xs text-muted-foreground">
                                  {item.kind} {item.sourceFile ? `· ${item.sourceFile}` : ""}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void resolveLocatorSync(item.id, "keep-managed")}
                                >
                                  Keep managed
                                </Button>
                                {item.kind === "conflict" ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() =>
                                      void resolveLocatorSync(item.id, "accept-repository")
                                    }
                                  >
                                    Accept repository version
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void resolveLocatorSync(item.id, "archive")}
                                >
                                  Archive
                                </Button>
                              </div>
                            </div>
                          ))}
                        <p className="text-xs text-muted-foreground">
                          Decisions update Tabs metadata and version history. Repository files are
                          changed only through a separately reviewed source diff.
                        </p>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <section aria-labelledby="locator-library-heading" className="space-y-3">
                  <div>
                    <h3 id="locator-library-heading" className="text-lg font-semibold">
                      Locator Library
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {locatorLibrary.pageCount} pages · {locatorLibrary.locatorCount} locators ·{" "}
                      {locatorLibrary.verifiedCount} verified · {locatorLibrary.reviewCount} need
                      review
                    </p>
                  </div>
                  {locatorLibrary.pages.length === 0 ? (
                    <Card>
                      <CardContent className="py-6 text-sm text-muted-foreground">
                        Start a capture or connect an existing page-object folder. Nothing is shared
                        with another Tabs project.
                      </CardContent>
                    </Card>
                  ) : selectedLocatorPage ? (
                    <Card className="overflow-hidden">
                      <div className="grid min-h-[30rem] lg:grid-cols-[15rem_minmax(0,1fr)]">
                        <div className="border-b border-border/60 bg-muted/15 p-2 lg:border-b-0 lg:border-r">
                          {locatorLibrary.pages.map((page) => (
                            <div
                              key={page.id}
                              className={cn(
                                "mb-1 flex items-center rounded-lg",
                                selectedLocatorPage.id === page.id
                                  ? "bg-primary/10 text-foreground"
                                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                              )}
                            >
                              <button
                                type="button"
                                aria-current={
                                  selectedLocatorPage.id === page.id ? "page" : undefined
                                }
                                onClick={() => setSelectedLocatorPageId(page.id)}
                                className="min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <span className="block truncate text-sm font-medium">
                                  {page.name}
                                </span>
                                <span className="mt-0.5 block text-[11px]">
                                  {page.entries.length} locators
                                </span>
                              </button>
                              <Menu>
                                <MenuTrigger
                                  render={
                                    <Button
                                      type="button"
                                      size="icon-xs"
                                      variant="ghost"
                                      aria-label={`Actions for ${page.name}`}
                                      disabled={busyAction !== null}
                                      className="mr-1 shrink-0"
                                    />
                                  }
                                >
                                  <ChevronDownIcon aria-hidden="true" />
                                </MenuTrigger>
                                <MenuPopup align="end">
                                  <MenuItem onClick={() => void rescanLocatorPage(page.id)}>
                                    <RefreshCwIcon aria-hidden="true" />
                                    Rescan and replace locators
                                  </MenuItem>
                                  <MenuSeparator />
                                  <MenuItem
                                    variant="destructive"
                                    onClick={() => void deleteLocatorPage(page.id)}
                                  >
                                    <Trash2Icon aria-hidden="true" />
                                    Delete page
                                  </MenuItem>
                                </MenuPopup>
                              </Menu>
                            </div>
                          ))}
                        </div>
                        <div className="min-w-0">
                          <div className="border-b border-border/60 p-4">
                            <div className="flex flex-wrap items-end justify-between gap-3">
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <label
                                  htmlFor="locator-page-name"
                                  className="text-xs font-medium text-muted-foreground"
                                >
                                  Page name
                                </label>
                                <div className="flex max-w-xl gap-2">
                                  <Input
                                    id="locator-page-name"
                                    value={locatorPageName}
                                    onChange={(event) => setLocatorPageName(event.target.value)}
                                    placeholder="Landing page"
                                    className="text-base font-semibold"
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      !locatorPageName.trim() ||
                                      locatorPageName.trim() === selectedLocatorPage.name ||
                                      busyAction !== null
                                    }
                                    onClick={() => void saveLocatorPageName()}
                                  >
                                    Save name
                                  </Button>
                                </div>
                                <CardDescription className="break-all">
                                  {selectedLocatorPage.urlPattern}
                                </CardDescription>
                              </div>
                              <div className="rounded-lg bg-muted/40 px-3 py-2 text-right">
                                <div className="text-sm font-semibold">
                                  {
                                    selectedLocatorPage.entries.filter(
                                      (entry) => entry.lifecycleStatus === "accepted",
                                    ).length
                                  }{" "}
                                  in code
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  {selectedLocatorPage.entries.length} discovered
                                </div>
                              </div>
                            </div>
                            <p className="mt-3 text-xs text-muted-foreground">
                              Rescanning replaces this page&apos;s saved locators with a fresh
                              capture. Deleting the page never changes repository files.
                            </p>
                            <div
                              className="tabs-segmented mt-4 flex flex-wrap"
                              role="tablist"
                              aria-label="Page Object details"
                            >
                              {(
                                [
                                  ["locators", "1. Choose locators"],
                                  ["code", "2. Preview code"],
                                  ["diff", "3. Write to repository"],
                                  ["history", "History"],
                                ] as const
                              ).map(([id, label]) => (
                                <Button
                                  key={id}
                                  id={`locator-page-tab-${id}`}
                                  type="button"
                                  size="sm"
                                  variant={locatorPageTab === id ? "secondary" : "ghost"}
                                  role="tab"
                                  aria-selected={locatorPageTab === id}
                                  aria-controls="locator-page-tabpanel"
                                  tabIndex={locatorPageTab === id ? 0 : -1}
                                  onClick={() => setLocatorPageTab(id)}
                                  onKeyDown={(event) => {
                                    const tabs = ["locators", "code", "diff", "history"] as const;
                                    const current = tabs.indexOf(id);
                                    const next =
                                      event.key === "Home"
                                        ? 0
                                        : event.key === "End"
                                          ? tabs.length - 1
                                          : event.key === "ArrowRight"
                                            ? (current + 1) % tabs.length
                                            : event.key === "ArrowLeft"
                                              ? (current - 1 + tabs.length) % tabs.length
                                              : -1;
                                    if (next < 0) return;
                                    event.preventDefault();
                                    const nextId = tabs[next]!;
                                    setLocatorPageTab(nextId);
                                    window.requestAnimationFrame(() =>
                                      document
                                        .getElementById(`locator-page-tab-${nextId}`)
                                        ?.focus(),
                                    );
                                  }}
                                >
                                  {label}
                                </Button>
                              ))}
                            </div>
                          </div>
                          <div
                            id="locator-page-tabpanel"
                            className="p-4"
                            role="tabpanel"
                            aria-labelledby={`locator-page-tab-${locatorPageTab}`}
                          >
                            {locatorPageTab === "locators" ? (
                              <div className="space-y-4">
                                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                      <h4 className="text-sm font-semibold">
                                        Choose exactly what belongs in this page object
                                      </h4>
                                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                        Discovery can find many elements. Only checked locators are
                                        generated into code.
                                      </p>
                                    </div>
                                    <div className="flex gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        onClick={() =>
                                          setLocatorCodeEntryIds(
                                            new Set(
                                              selectedLocatorPage.entries
                                                .filter(
                                                  (entry) =>
                                                    entry.lifecycleStatus !== "archived" &&
                                                    entry.lifecycleStatus !== "manual-required",
                                                )
                                                .map((entry) => entry.id),
                                            ),
                                          )
                                        }
                                      >
                                        Select usable
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setLocatorCodeEntryIds(new Set())}
                                      >
                                        Clear
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                                  <div className="relative">
                                    <SearchIcon
                                      aria-hidden="true"
                                      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground z-10"
                                    />
                                    <Input
                                      value={locatorSearch}
                                      onChange={(event) => setLocatorSearch(event.target.value)}
                                      placeholder="Search key, role, text, or generated code"
                                      aria-label="Search locators on this page"
                                      className="pl-9"
                                    />
                                  </div>
                                  <Select
                                    value={locatorFilter}
                                    onValueChange={(value) =>
                                      setLocatorFilter(value as typeof locatorFilter)
                                    }
                                  >
                                    <SelectTrigger aria-label="Filter locators">
                                      <span className="flex-1 truncate text-left">
                                        {
                                          {
                                            all: "Active locators",
                                            selected: "Selected for code",
                                            "needs-review": "Needs review",
                                            archived: "Removed locators",
                                          }[locatorFilter]
                                        }
                                      </span>
                                    </SelectTrigger>
                                    <SelectPopup>
                                      <SelectItem value="all">Active locators</SelectItem>
                                      <SelectItem value="selected">Selected for code</SelectItem>
                                      <SelectItem value="needs-review">Needs review</SelectItem>
                                      <SelectItem value="archived">Removed locators</SelectItem>
                                    </SelectPopup>
                                  </Select>
                                </div>
                                <p className="text-xs text-muted-foreground" role="status">
                                  {filteredLocatorEntries.length} of{" "}
                                  {selectedLocatorPage.entries.length} locators shown
                                </p>
                                <div className="divide-y divide-border/60">
                                  {filteredLocatorEntries.map((entry) => (
                                    <div
                                      key={entry.id}
                                      className="flex flex-wrap items-start justify-between gap-3 py-3"
                                    >
                                      <div className="flex min-w-0 flex-1 items-start gap-3">
                                        <Checkbox
                                          checked={locatorCodeEntryIds.has(entry.id)}
                                          disabled={
                                            entry.lifecycleStatus === "archived" ||
                                            entry.lifecycleStatus === "manual-required"
                                          }
                                          onClick={() =>
                                            setLocatorCodeEntryIds((previous) => {
                                              const next = new Set(previous);
                                              if (next.has(entry.id)) next.delete(entry.id);
                                              else next.add(entry.id);
                                              return next;
                                            })
                                          }
                                          aria-label={`Include ${entry.locatorKey} in generated code`}
                                          className="mt-1"
                                        />
                                        <div className="min-w-0 flex-1">
                                          <div className="font-mono text-sm text-foreground">
                                            {entry.locatorKey}
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            {entry.strategy} · {entry.classification} ·{" "}
                                            {entry.verificationStatus} · {entry.syncStatus}
                                          </div>
                                          <code className="mt-2 block max-w-2xl overflow-x-auto rounded-md bg-muted/55 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground">
                                            {testingLocatorCode(entry)}
                                          </code>
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Badge
                                          variant={entry.fragile ? "destructive" : "secondary"}
                                        >
                                          {entry.fragile ? "Review fragile" : entry.source}
                                        </Badge>
                                        {entry.lifecycleStatus === "archived" ? (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => void reviewLocator(entry.id, "restore")}
                                          >
                                            <ArchiveRestoreIcon aria-hidden="true" />
                                            Restore
                                          </Button>
                                        ) : (
                                          <>
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="outline"
                                              onClick={() => startEditingLocator(entry)}
                                            >
                                              <PencilIcon aria-hidden="true" />
                                              Edit
                                            </Button>
                                            {entry.syncStatus === "managed-only" ? (
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                onClick={() =>
                                                  void reviewLocator(entry.id, "keep-managed")
                                                }
                                              >
                                                Keep managed-only
                                              </Button>
                                            ) : null}
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="ghost"
                                              className="text-destructive hover:text-destructive"
                                              onClick={() => setLocatorPendingRemoveId(entry.id)}
                                            >
                                              <Trash2Icon aria-hidden="true" />
                                              Remove
                                            </Button>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                  {filteredLocatorEntries.length === 0 ? (
                                    <div className="py-10 text-center text-sm text-muted-foreground">
                                      No locators match this search and filter.
                                    </div>
                                  ) : null}
                                  {filteredLocatorEntries.length > 100 ? (
                                    <div className="py-4 text-center text-xs text-muted-foreground">
                                      Showing the first 100 matches. Narrow the search to find a
                                      specific locator.
                                    </div>
                                  ) : null}
                                </div>
                                <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/95 p-3 shadow-sm backdrop-blur">
                                  <p className="text-xs text-muted-foreground" aria-live="polite">
                                    {locatorCodeEntryIds.size} locator
                                    {locatorCodeEntryIds.size === 1 ? "" : "s"} selected
                                  </p>
                                  <Button
                                    type="button"
                                    disabled={busyAction !== null || locatorCodeEntryIds.size === 0}
                                    onClick={() => void saveLocatorCodeSelection()}
                                  >
                                    Generate page object
                                    <ArrowRightIcon aria-hidden="true" />
                                  </Button>
                                </div>
                              </div>
                            ) : locatorPageTab === "code" && selectedLocatorPage.pageObject ? (
                              <div className="space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-mono text-sm">
                                        {selectedLocatorPage.pageObject.fileName}
                                      </span>
                                      {selectedLocatorPage.pageObject.origin === "manual" ? (
                                        <Badge variant="secondary">Edited draft</Badge>
                                      ) : (
                                        <Badge variant="outline">Generated</Badge>
                                      )}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      Version {selectedLocatorPage.pageObject.versionNumber} -{" "}
                                      {selectedLocatorPage.pageObject.status}
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {!locatorCodeEditing ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          setLocatorCodeDraft(
                                            selectedLocatorPage.pageObject?.code ?? "",
                                          );
                                          setLocatorCodeEditing(true);
                                        }}
                                      >
                                        <PencilIcon aria-hidden="true" />
                                        Edit code
                                      </Button>
                                    ) : null}
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        void navigator.clipboard
                                          .writeText(selectedLocatorPage.pageObject?.code ?? "")
                                          .then(() => message_setter("Page Object code copied."))
                                      }
                                    >
                                      Copy code
                                    </Button>
                                  </div>
                                </div>
                                {locatorCodeEditing ? (
                                  <div className="space-y-3">
                                    <div
                                      id="locator-code-edit-help"
                                      className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground"
                                    >
                                      Small code edits are saved as a new local version. Keep the
                                      exported {selectedLocatorPage.pageObject.className} class.
                                      Changing the page name or selected locators later regenerates
                                      this draft from the Locator Library.
                                    </div>
                                    <Textarea
                                      value={locatorCodeDraft}
                                      onChange={(event) => setLocatorCodeDraft(event.target.value)}
                                      aria-label={`Edit ${selectedLocatorPage.pageObject.fileName}`}
                                      aria-describedby="locator-code-edit-help"
                                      spellCheck={false}
                                      className="min-h-[28rem] resize-y whitespace-pre font-mono text-xs leading-5"
                                    />
                                    <div className="flex flex-wrap justify-end gap-2">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        disabled={busyAction !== null}
                                        onClick={() => {
                                          setLocatorCodeDraft(
                                            selectedLocatorPage.pageObject?.code ?? "",
                                          );
                                          setLocatorCodeEditing(false);
                                        }}
                                      >
                                        Cancel
                                      </Button>
                                      <Button
                                        type="button"
                                        disabled={
                                          busyAction !== null ||
                                          !locatorCodeDraft.trim() ||
                                          locatorCodeDraft === selectedLocatorPage.pageObject.code
                                        }
                                        onClick={() => void savePageObjectCode()}
                                      >
                                        {busyAction === "locator-code" ? (
                                          <LoaderIcon aria-hidden="true" className="animate-spin" />
                                        ) : null}
                                        Save new version
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <pre className="max-h-[32rem] overflow-auto rounded-xl border border-border/60 bg-background/70 p-4 text-xs leading-5">
                                    <code>{selectedLocatorPage.pageObject.code}</code>
                                  </pre>
                                )}
                                {!locatorCodeEditing ? (
                                  <p className="text-xs leading-5 text-muted-foreground">
                                    This is a local managed draft. Edit it here for a small code
                                    change, or edit the locator selection to regenerate it from
                                    verified entries. Nothing reaches your repository until you
                                    preview and confirm a file change.
                                  </p>
                                ) : null}
                                <div className="flex flex-wrap justify-between gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    disabled={locatorCodeEditing}
                                    onClick={() => setLocatorPageTab("locators")}
                                  >
                                    Edit selected locators
                                  </Button>
                                  <Button
                                    type="button"
                                    disabled={locatorCodeEditing}
                                    onClick={() => setLocatorPageTab("diff")}
                                  >
                                    Choose repository destination
                                    <ArrowRightIcon aria-hidden="true" />
                                  </Button>
                                </div>
                              </div>
                            ) : locatorPageTab === "diff" ? (
                              <div className="space-y-5">
                                <div>
                                  <h4 className="text-sm font-semibold">
                                    Choose the exact destination
                                  </h4>
                                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                    The folder must be inside this project. Testing never writes
                                    until you review and confirm the proposed file.
                                  </p>
                                </div>
                                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
                                  <div className="space-y-1.5">
                                    <label
                                      className="text-xs font-medium"
                                      htmlFor="locator-repository-folder"
                                    >
                                      Page-object folder
                                    </label>
                                    <div className="flex gap-2">
                                      <Input
                                        id="locator-repository-folder"
                                        value={locatorRepositoryFolder}
                                        readOnly
                                        placeholder="Choose a folder inside this project"
                                      />
                                      <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => void chooseLocatorRepositoryFolder()}
                                      >
                                        <FolderSearchIcon aria-hidden="true" />
                                        Choose
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="space-y-1.5">
                                    <label
                                      className="text-xs font-medium"
                                      htmlFor="locator-repository-file"
                                    >
                                      TypeScript file
                                    </label>
                                    <Input
                                      id="locator-repository-file"
                                      value={locatorRepositoryFileName}
                                      onChange={(event) => {
                                        setLocatorRepositoryFileName(event.target.value);
                                        setLocatorRepositoryProposal(null);
                                      }}
                                      placeholder="landing.page.ts"
                                    />
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Button
                                    type="button"
                                    disabled={
                                      busyAction !== null ||
                                      !locatorRepositoryFolder ||
                                      !locatorRepositoryFileName.trim() ||
                                      !selectedLocatorPage.pageObject
                                    }
                                    onClick={() => void previewLocatorRepositoryChange()}
                                  >
                                    {busyAction === "locator-repository" ? (
                                      <LoaderIcon aria-hidden="true" className="animate-spin" />
                                    ) : null}
                                    Preview file change
                                  </Button>
                                  <span className="text-xs text-muted-foreground">
                                    {selectedLocatorPage.pageObject
                                      ? `${selectedLocatorPage.pageObject.className} · ${selectedLocatorPage.pageObject.versionNumber}`
                                      : "Select locators before choosing repository output"}
                                  </span>
                                </div>
                                {locatorRepositoryProposal ? (
                                  <div className="space-y-4 rounded-xl border border-border/70 bg-muted/15 p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <div>
                                        <div className="flex items-center gap-2">
                                          <Badge variant="secondary">
                                            {locatorRepositoryProposal.changeKind}
                                          </Badge>
                                          <span className="font-mono text-sm">
                                            {locatorRepositoryProposal.relativePath}
                                          </span>
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                          {locatorRepositoryProposal.selectedLocatorCount} selected
                                          locator
                                          {locatorRepositoryProposal.selectedLocatorCount === 1
                                            ? ""
                                            : "s"}{" "}
                                          · {locatorRepositoryProposal.className}
                                        </p>
                                      </div>
                                      <Button
                                        type="button"
                                        disabled={
                                          locatorRepositoryProposal.changeKind === "unchanged" ||
                                          busyAction !== null
                                        }
                                        onClick={() => setLocatorRepositoryConfirmOpen(true)}
                                      >
                                        Review and apply
                                      </Button>
                                    </div>
                                    <div
                                      className={cn(
                                        "grid gap-3",
                                        locatorRepositoryProposal.existingCode && "xl:grid-cols-2",
                                      )}
                                    >
                                      {locatorRepositoryProposal.existingCode ? (
                                        <div className="min-w-0">
                                          <div className="mb-2 text-xs font-medium text-muted-foreground">
                                            Current repository file
                                          </div>
                                          <pre className="max-h-80 overflow-auto rounded-lg border border-border/60 bg-background p-3 text-[10px] leading-4">
                                            <code>{locatorRepositoryProposal.existingCode}</code>
                                          </pre>
                                        </div>
                                      ) : null}
                                      <div className="min-w-0">
                                        <div className="mb-2 text-xs font-medium text-muted-foreground">
                                          Proposed page object
                                        </div>
                                        <pre className="max-h-80 overflow-auto rounded-lg border border-primary/20 bg-background p-3 text-[10px] leading-4">
                                          <code>{locatorRepositoryProposal.proposedCode}</code>
                                        </pre>
                                      </div>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {selectedLocatorPage.entries.map((entry) => (
                                  <div
                                    key={entry.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-3"
                                  >
                                    <span className="font-mono text-xs">{entry.locatorKey}</span>
                                    <span className="text-xs text-muted-foreground">
                                      v{entry.versionNumber} - {entry.verificationStatus}
                                      {entry.verifiedAt
                                        ? ` - ${new Date(entry.verifiedAt).toLocaleString()}`
                                        : ""}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {selectedLocatorPage.entries.length > 100 &&
                            locatorPageTab === "locators" ? (
                              <p className="pt-3 text-xs text-muted-foreground">
                                Showing 100 entries on this page. Use the inventory search and
                                pagination for the remaining entries.
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </Card>
                  ) : null}
                </section>

                {/* Step 3 Footer Navigation */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card p-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setWorkflowStep(2)}
                    className="gap-1.5"
                  >
                    <ChevronLeftIcon className="size-4" />
                    <span>Back to Choose Locators</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setWorkflowStep(1)}
                    className="gap-1.5"
                  >
                    <span>Start a New Scan</span>
                    <ArrowRightIcon className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Locator Edit Dialog */}
      <Dialog
        open={editingLocatorEntry !== null}
        onOpenChange={(open) => {
          if (!open) setEditingLocatorId(null);
        }}
      >
        <DialogPopup>
          <DialogPanel className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit locator</DialogTitle>
              <DialogDescription>
                Update the stable key or Playwright locator. Saving creates a new immutable locator
                version and refreshes the managed page-object draft.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-1 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <label htmlFor="locator-edit-key" className="text-sm font-medium">
                  Locator key
                </label>
                <Input
                  id="locator-edit-key"
                  value={editingLocatorKey}
                  onChange={(event) => setEditingLocatorKey(event.target.value)}
                  placeholder="submit-account"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Start with a letter; use letters, numbers, underscores, or hyphens.
                </p>
              </div>
              <div className="space-y-2">
                <label htmlFor="locator-edit-classification" className="text-sm font-medium">
                  Purpose
                </label>
                <Select
                  value={editingLocatorClassification}
                  onValueChange={(value) =>
                    setEditingLocatorClassification(value as TestingLocatorEntry["classification"])
                  }
                >
                  <SelectTrigger id="locator-edit-classification">
                    <span className="flex-1 truncate">
                      {
                        {
                          action: "Action",
                          assertion: "Assertion",
                          content: "Content",
                        }[editingLocatorClassification]
                      }
                    </span>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="action">Action</SelectItem>
                    <SelectItem value="assertion">Assertion</SelectItem>
                    <SelectItem value="content">Content</SelectItem>
                  </SelectPopup>
                </Select>
              </div>
              <div className="space-y-2">
                <label htmlFor="locator-edit-strategy" className="text-sm font-medium">
                  Playwright strategy
                </label>
                <Select
                  value={editingLocatorStrategy}
                  onValueChange={(value) =>
                    setEditingLocatorStrategy(value as TestingLocatorEntry["strategy"])
                  }
                >
                  <SelectTrigger id="locator-edit-strategy">
                    <span className="flex-1 truncate">
                      {{
                        role: "Role and accessible name",
                        label: "Label",
                        "test-id": "Test ID",
                        placeholder: "Placeholder",
                        "alt-text": "Alternative text",
                        title: "Title",
                        text: "Visible text",
                        css: "Scoped CSS (fragile)",
                        xpath: "XPath selector",
                      }[editingLocatorStrategy] ?? editingLocatorStrategy}
                    </span>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="role">Role and accessible name</SelectItem>
                    <SelectItem value="label">Label</SelectItem>
                    <SelectItem value="test-id">Test ID</SelectItem>
                    <SelectItem value="placeholder">Placeholder</SelectItem>
                    <SelectItem value="alt-text">Alternative text</SelectItem>
                    <SelectItem value="title">Title</SelectItem>
                    <SelectItem value="text">Visible text</SelectItem>
                    <SelectItem value="css">Scoped CSS (fragile)</SelectItem>
                  </SelectPopup>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label htmlFor="locator-edit-arguments" className="text-sm font-medium">
                  Strategy arguments
                </label>
                <Textarea
                  id="locator-edit-arguments"
                  value={editingLocatorArguments}
                  onChange={(event) => setEditingLocatorArguments(event.target.value)}
                  spellCheck={false}
                  className="min-h-32 font-mono text-xs"
                  aria-describedby="locator-edit-arguments-help"
                />
                <p id="locator-edit-arguments-help" className="text-xs text-muted-foreground">
                  JSON object, for example {`{ "role": "button", "name": "Save" }`}.
                </p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label htmlFor="locator-edit-context" className="text-sm font-medium">
                  Semantic context
                </label>
                <Textarea
                  id="locator-edit-context"
                  value={editingLocatorContext}
                  onChange={(event) => setEditingLocatorContext(event.target.value)}
                  placeholder="Where and why this element is used"
                  className="min-h-20"
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button
                type="button"
                disabled={!editingLocatorKey.trim() || busyAction !== null}
                onClick={() => void saveLocatorChanges()}
              >
                {busyAction === "locator-review" ? (
                  <LoaderIcon aria-hidden="true" className="animate-spin" />
                ) : null}
                Save new version
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>

      {/* Locator Remove Alert Dialog */}
      <AlertDialog
        open={pendingRemoveLocator !== null}
        onOpenChange={(open) => {
          if (!open) setLocatorPendingRemoveId(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this locator?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemoveLocator
                ? `${pendingRemoveLocator.locatorKey} will be removed from active selection and generated page objects. Its version and verification history are preserved, and you can restore it later.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (pendingRemoveLocator) {
                  void reviewLocator(pendingRemoveLocator.id, "archive");
                }
              }}
            >
              Remove locator
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      {/* Locator Repository Confirm Dialog */}
      <Dialog open={locatorRepositoryConfirmOpen} onOpenChange={setLocatorRepositoryConfirmOpen}>
        <DialogPopup>
          <DialogPanel>
            <DialogHeader>
              <DialogTitle>Apply this page object?</DialogTitle>
              <DialogDescription>
                Testing will {locatorRepositoryProposal?.changeKind ?? "update"} only the reviewed
                file below. If the generated code or repository file changed since preview, the
                operation will stop and ask you to review again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 rounded-xl border border-border/70 bg-muted/25 p-4">
              <div className="break-all font-mono text-sm">
                {locatorRepositoryProposal?.relativePath}
              </div>
              <div className="text-xs text-muted-foreground">
                {locatorRepositoryProposal?.selectedLocatorCount ?? 0} selected locator
                {(locatorRepositoryProposal?.selectedLocatorCount ?? 0) === 1 ? "" : "s"} · no other
                repository file will be changed
              </div>
            </div>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button
                type="button"
                disabled={busyAction !== null || !locatorRepositoryProposal}
                onClick={() => void applyLocatorRepositoryChange()}
              >
                {busyAction === "locator-repository" ? (
                  <LoaderIcon aria-hidden="true" className="animate-spin" />
                ) : null}
                Apply reviewed file
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </div>
  );
});

export default TestingDiscover;

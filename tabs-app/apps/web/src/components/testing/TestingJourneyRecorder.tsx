import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircle2Icon,
  CodeIcon,
  PlusIcon,
  RadioIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { ensureNativeApi } from "~/nativeApi";
import type { TestingLocatorEntry } from "@tabs/contracts";
import { useTestingData } from "./context";

export type JourneyAction =
  | "goto"
  | "click"
  | "fill"
  | "selectOption"
  | "check"
  | "uncheck"
  | "press"
  | "assertVisible"
  | "assertText"
  | "assertValue";

export type EditableStep = {
  id: string;
  action: JourneyAction;
  selector: string;
  value?: string | undefined;
  url?: string | undefined;
  key?: string | undefined;
  placeholder?: string | undefined;
  expectedValue?: string | undefined;
  isFragile?: boolean | undefined;
  reviewed?: boolean | undefined;
  locatorEntryId?: string | undefined;
  locatorStrategy?: TestingLocatorEntry["strategy"] | undefined;
  locatorArguments?: Readonly<Record<string, unknown>> | undefined;
};

function entryToSelector(entry: TestingLocatorEntry): string {
  const args = entry.arguments as Record<string, string | undefined>;
  if (entry.strategy === "test-id" && args.testId) {
    return `[data-testid="${args.testId}"]`;
  }
  if (entry.strategy === "role" && args.role) {
    return args.name ? `role=${args.role}[name="${args.name}"]` : `role=${args.role}`;
  }
  if (entry.strategy === "label" && (args.text || args.label)) {
    return `getByLabel(${JSON.stringify(args.text || args.label)})`;
  }
  if (entry.strategy === "placeholder" && (args.text || args.placeholder)) {
    return `getByPlaceholder(${JSON.stringify(args.text || args.placeholder)})`;
  }
  if (entry.strategy === "text" && args.text) {
    return `text=${args.text}`;
  }
  if (args.selector) {
    return args.selector;
  }
  return entry.locatorKey;
}

function locatorForStep(step: EditableStep): string {
  const args = step.locatorArguments;
  const text = (key: string) => JSON.stringify(String(args?.[key] ?? ""));
  switch (step.locatorStrategy) {
    case "role":
      return `page.getByRole(${text("role")} as Parameters<Page["getByRole"]>[0], { name: ${text("name")} })`;
    case "label":
      return `page.getByLabel(${text(args?.text ? "text" : "label")}, { exact: true })`;
    case "test-id":
      return `page.getByTestId(${text("testId")})`;
    case "placeholder":
      return `page.getByPlaceholder(${text(args?.text ? "text" : "placeholder")}, { exact: true })`;
    case "alt-text":
      return `page.getByAltText(${text(args?.text ? "text" : "altText")}, { exact: true })`;
    case "title":
      return `page.getByTitle(${text(args?.text ? "text" : "title")}, { exact: true })`;
    case "text":
      return `page.getByText(${text("text")}, { exact: true })`;
    default:
      return `page.locator(${JSON.stringify(step.selector.trim() || "body")})`;
  }
}

function validateRecordedCode(code: string): string | null {
  if (!code.trim()) return "Generated code is empty";
  if (/\btest\s*\.\s*(skip|fixme|fail|only)\s*\(/.test(code)) {
    return "Skipped, expected-failure, and exclusive tests are not allowed";
  }
  if (!/\bexpect\s*\(/.test(code)) return "At least one Playwright assertion is required";
  if (code.includes('throw new Error("Add expected-result assertions')) {
    return "Replace the assertion-review guard with a business assertion";
  }
  return null;
}

function generatePlaywrightCode(url: string, steps: readonly EditableStep[]): string {
  let inputCount = 0;
  const lines: string[] = [
    'import { test, expect, type Page } from "playwright/test";',
    "",
    'test("Recorded journey", async ({ page }) => {',
    `  await page.goto(${JSON.stringify(url || "https://example.com")});`,
  ];

  for (const step of steps) {
    if (step.action === "goto") {
      lines.push(`  await page.goto(${JSON.stringify(step.url || url)});`);
      continue;
    }

    const locator = locatorForStep(step);

    switch (step.action) {
      case "click":
        lines.push(`  await ${locator}.click();`);
        break;
      case "fill": {
        const name = step.placeholder || `RECORDED_INPUT_${++inputCount}`;
        if (step.value !== undefined && step.value.trim() !== "") {
          lines.push(`  await ${locator}.fill(${JSON.stringify(step.value)});`);
        } else {
          lines.push(
            `  // Supply reviewed test data; typed values were not recorded.\n  if (process.env.${name} === undefined) throw new Error("Set ${name}");\n  await ${locator}.fill(process.env.${name}!);`,
          );
        }
        break;
      }
      case "selectOption": {
        if (step.value !== undefined && step.value.trim() !== "") {
          lines.push(`  await ${locator}.selectOption(${JSON.stringify(step.value)});`);
        } else {
          const name = step.placeholder || `RECORDED_INPUT_${++inputCount}`;
          lines.push(
            `  // Supply reviewed test data; typed values were not recorded.\n  if (process.env.${name} === undefined) throw new Error("Set ${name}");\n  await ${locator}.selectOption(process.env.${name}!);`,
          );
        }
        break;
      }
      case "check":
        lines.push(`  await ${locator}.check();`);
        break;
      case "uncheck":
        lines.push(`  await ${locator}.uncheck();`);
        break;
      case "press":
        lines.push(`  await ${locator}.press(${JSON.stringify(step.key || "Enter")});`);
        break;
      case "assertVisible":
        lines.push(`  await expect(${locator}).toBeVisible();`);
        break;
      case "assertText":
        lines.push(
          `  await expect(${locator}).toHaveText(${JSON.stringify(step.expectedValue ?? "")});`,
        );
        break;
      case "assertValue":
        lines.push(
          `  await expect(${locator}).toHaveValue(${JSON.stringify(step.expectedValue ?? "")});`,
        );
        break;
    }
  }

  const hasAssertion = steps.some((s) => s.action.startsWith("assert"));
  if (!hasAssertion) {
    lines.push("  // Replace this guard with reviewed business assertions before running.");
    lines.push('  throw new Error("Add expected-result assertions to this recording");');
  }

  lines.push("});");
  lines.push("");
  return lines.join("\n");
}

export function TestingJourneyRecorder() {
  const {
    projectId,
    projectPath,
    generationModelSelection,
    normalizedTarget,
    locatorLibrary,
    refreshCases,
    refreshGenerationJobs,
  } = useTestingData();

  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [steps, setSteps] = useState<EditableStep[]>([]);
  const [targetUrl, setTargetUrl] = useState(normalizedTarget || "https://example.com");
  const [showCodePreview, setShowCodePreview] = useState(false);
  const [manualCodeEdit, setManualCodeEdit] = useState<string | null>(null);
  const active = useRef(false);

  const request = (operation: "recordStart" | "recordStop" | "recordStatus") => {
    if (!window.desktopBridge) throw new Error("Journey recording requires the Tabs desktop app.");
    return window.desktopBridge.runBrowserAutomation({
      source: "human",
      projectId,
      sessionId: `testing:${projectId}`,
      operation,
    });
  };

  useEffect(
    () => () => {
      if (active.current) {
        void window.desktopBridge
          ?.runBrowserAutomation({
            source: "human",
            projectId,
            sessionId: `testing:${projectId}`,
            operation: "recordStop",
          })
          .catch(() => undefined);
      }
    },
    [projectId],
  );

  // Flatten saved library locators for selection dropdown
  const savedLocators = useMemo(() => {
    if (!locatorLibrary?.pages) return [];
    return locatorLibrary.pages.flatMap((page) =>
      page.entries.map((entry) => ({
        pageName: page.name,
        entry,
        selector: entryToSelector(entry),
      })),
    );
  }, [locatorLibrary]);

  const generatedCode = useMemo(() => {
    return generatePlaywrightCode(targetUrl, steps);
  }, [targetUrl, steps]);

  const displayedCode = manualCodeEdit ?? generatedCode;
  const codeValidationError = useMemo(() => validateRecordedCode(displayedCode), [displayedCode]);

  // Validation gates:
  // 1. Must contain at least one action step
  const hasAction = useMemo(() => {
    return steps.some((s) =>
      ["goto", "click", "fill", "selectOption", "check", "uncheck", "press"].includes(s.action),
    );
  }, [steps]);

  // 2. Required input placeholders resolved or deliberately mapped
  const unmappedInputs = useMemo(() => {
    return steps.filter(
      (s) =>
        (s.action === "fill" || s.action === "selectOption") &&
        (!s.value || s.value.trim() === "") &&
        (!s.placeholder || s.placeholder.trim() === ""),
    );
  }, [steps]);
  const placeholdersResolved = unmappedInputs.length === 0;

  // 3. Must contain at least one reviewed assertion
  const reviewedAssertions = useMemo(() => {
    return steps.filter((s) => {
      if (s.action === "assertVisible") return s.selector.trim().length > 0;
      if (s.action === "assertText" || s.action === "assertValue") {
        return s.selector.trim().length > 0 && (s.expectedValue ?? "").trim().length > 0;
      }
      return false;
    });
  }, [steps]);
  const hasReviewedAssertion = reviewedAssertions.length > 0;

  // 4. Fragile/non-unique selectors explicitly reviewed
  const unreviewedFragileSteps = useMemo(() => {
    return steps.filter((s) => s.isFragile && !s.reviewed);
  }, [steps]);
  const fragileSelectorsReviewed = unreviewedFragileSteps.length === 0;

  const isRunnable =
    steps.length > 0 &&
    hasAction &&
    placeholdersResolved &&
    hasReviewedAssertion &&
    fragileSelectorsReviewed &&
    !codeValidationError;

  const toggle = async () => {
    setBusy(true);
    try {
      if (recording) {
        const result = (await request("recordStop")) as {
          code: string;
          count: number;
          steps?: EditableStep[];
          initialUrl?: string;
        };
        active.current = false;
        setRecording(false);
        if (result.initialUrl) setTargetUrl(result.initialUrl);
        if (result.steps && result.steps.length > 0) {
          let inputIdx = 0;
          const mapped = result.steps.map((s, idx) => ({
            ...s,
            id: s.id || `step-${idx + 1}`,
            placeholder:
              s.action === "fill" || s.action === "selectOption"
                ? s.placeholder || `RECORDED_INPUT_${++inputIdx}`
                : undefined,
          }));
          setSteps(mapped);
        } else {
          setSteps([]);
        }
        setManualCodeEdit(null);
        setMessage(
          `${result.count} actions captured. Review steps, resolve input data, and review assertions before saving.`,
        );
      } else {
        active.current = true;
        await request("recordStart");
        setRecording(true);
        setMessage(
          "Recording active in preview. Actions are captured without persisting sensitive typed values.",
        );
      }
    } catch (error) {
      if (!recording) active.current = false;
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const updateStep = (id: string, updates: Partial<EditableStep>) => {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        return { ...s, ...updates };
      }),
    );
    setManualCodeEdit(null);
  };

  const removeStep = (id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
    setManualCodeEdit(null);
  };

  const moveStep = (index: number, direction: "up" | "down") => {
    setSteps((prev) => {
      const next = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      const [moved] = next.splice(index, 1);
      if (!moved) return prev;
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setManualCodeEdit(null);
  };

  const addStep = (action: JourneyAction = "assertVisible") => {
    const newStep: EditableStep = {
      id: `step-${Date.now()}`,
      action,
      selector: "",
      expectedValue: action === "assertText" || action === "assertValue" ? "" : undefined,
      isFragile: false,
      reviewed: true,
    };
    setSteps((prev) => [...prev, newStep]);
    setManualCodeEdit(null);
  };

  const save = async () => {
    if (!isRunnable) return;
    setBusy(true);
    try {
      const relativePath = `tests/e2e/recorded/journey-${crypto.randomUUID()}.spec.ts`;
      const finalCode = displayedCode;

      // Extract linked locator entry IDs
      const linkedLocatorEntryIds = [
        ...new Set(steps.map((s) => s.locatorEntryId).filter((id): id is string => Boolean(id))),
      ];

      // Formulate assertion summary for the reviewed case
      const assertionSummaries = reviewedAssertions.map((s) => {
        if (s.action === "assertVisible") return `Element ${s.selector} is visible`;
        if (s.action === "assertText")
          return `Element ${s.selector} text equals "${s.expectedValue}"`;
        if (s.action === "assertValue")
          return `Element ${s.selector} value equals "${s.expectedValue}"`;
        return `Assertion passed`;
      });
      const assertionText = assertionSummaries.join("; ") || "Recorded assertions pass";

      // 1. Write repository Playwright spec
      await ensureNativeApi().projects.writeFile({
        cwd: projectPath,
        relativePath,
        contents: finalCode,
      });

      // 2. Create immutable Tabs-managed artifact and reviewed case
      await ensureNativeApi().testing.generateTests({
        projectId,
        projectPath,
        modelSelection: generationModelSelection,
        engine: "recording",
        recordedCode: finalCode,
        recordedExpectedResult: assertionText,
        ...(linkedLocatorEntryIds.length > 0 ? { locatorEntryIds: linkedLocatorEntryIds } : {}),
        ...(normalizedTarget ? { targetUrl: normalizedTarget } : {}),
      });

      await Promise.all([refreshCases(), refreshGenerationJobs()]);
      setMessage(
        `Successfully saved ${relativePath} and linked reviewed test case in Test runs (no AI required).`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-border/60 bg-background/60 p-4">
      {/* Header bar: Record / Stop toggle and status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant={recording ? "destructive" : "default"}
            size="sm"
            disabled={busy || !window.desktopBridge}
            aria-pressed={recording}
            onClick={() => void toggle()}
          >
            {recording ? (
              <>
                <SquareIcon className="mr-1.5 h-3.5 w-3.5" />
                Stop and review journey
              </>
            ) : (
              <>
                <RadioIcon className="mr-1.5 h-3.5 w-3.5" />
                Record journey
              </>
            )}
          </Button>
          <span className="text-xs text-muted-foreground">
            {recording
              ? "Recording user interactions. Passwords and sensitive typed values are not captured."
              : `${steps.length} step(s) in editor. Review steps and assertions before saving.`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {steps.length > 0 && !recording && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowCodePreview(!showCodePreview)}
            >
              <CodeIcon className="mr-1.5 h-3.5 w-3.5" />
              {showCodePreview ? "Hide code" : "Preview code"}
            </Button>
          )}
        </div>
      </div>

      {message && (
        <div role="status" className="rounded-md bg-muted/40 px-3 py-2 text-xs text-foreground">
          {message}
        </div>
      )}

      {/* Visual Step Editor */}
      {steps.length > 0 && !recording && (
        <div className="space-y-2 rounded-lg border border-border/70 bg-card/50 p-3">
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recorded Steps &amp; Assertions
            </h4>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => addStep("click")}
              >
                <PlusIcon className="mr-1 h-3 w-3" />
                Add Action
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => addStep("assertVisible")}
              >
                <PlusIcon className="mr-1 h-3 w-3" />
                Add Assertion
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className="flex flex-col gap-2 rounded-md border border-border/60 bg-background/80 p-2.5 text-xs shadow-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                    <Select
                      value={step.action}
                      onValueChange={(val) => {
                        if (val) {
                          updateStep(step.id, {
                            action: val as JourneyAction,
                          });
                        }
                      }}
                    >
                      <SelectTrigger
                        aria-label={`Action for step ${index + 1}`}
                        className="h-7 rounded border border-border bg-background px-2 text-xs font-medium focus:outline-hidden focus:ring-1 focus:ring-ring w-32"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="goto">goto</SelectItem>
                        <SelectItem value="click">click</SelectItem>
                        <SelectItem value="fill">fill</SelectItem>
                        <SelectItem value="selectOption">selectOption</SelectItem>
                        <SelectItem value="check">check</SelectItem>
                        <SelectItem value="uncheck">uncheck</SelectItem>
                        <SelectItem value="press">press</SelectItem>
                        <SelectItem value="assertVisible">assertVisible</SelectItem>
                        <SelectItem value="assertText">assertText</SelectItem>
                        <SelectItem value="assertValue">assertValue</SelectItem>
                      </SelectPopup>
                    </Select>

                    {/* Fragile warning & review */}
                    {step.isFragile && (
                      <button
                        type="button"
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${step.reviewed ? "border-border" : "border-destructive bg-destructive text-destructive-foreground"}`}
                        onClick={() => updateStep(step.id, { reviewed: !step.reviewed })}
                        aria-pressed={Boolean(step.reviewed)}
                        aria-label={`Mark fragile selector for step ${index + 1} as ${step.reviewed ? "unreviewed" : "reviewed"}`}
                      >
                        {step.reviewed ? "Fragile (Reviewed)" : "Fragile selector"}
                      </button>
                    )}
                  </div>

                  {/* Step controls */}
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={index === 0}
                      onClick={() => moveStep(index, "up")}
                      aria-label={`Move step ${index + 1} up`}
                      title="Move up"
                    >
                      <ArrowUpIcon className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={index === steps.length - 1}
                      onClick={() => moveStep(index, "down")}
                      aria-label={`Move step ${index + 1} down`}
                      title="Move down"
                    >
                      <ArrowDownIcon className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={() => removeStep(step.id)}
                      aria-label={`Delete step ${index + 1}`}
                      title="Delete step"
                    >
                      <Trash2Icon className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* Step Details Inputs */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {step.action === "goto" ? (
                    <div className="sm:col-span-2">
                      <Input
                        aria-label={`Target URL for step ${index + 1}`}
                        value={step.url || ""}
                        onChange={(e) => updateStep(step.id, { url: e.target.value })}
                        placeholder="Target URL (e.g. https://example.com)"
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] text-muted-foreground">Selector</label>
                          {savedLocators.length > 0 && (
                            <Select
                              value={step.locatorEntryId || ""}
                              onValueChange={(val) => {
                                if (!val) return;
                                const loc = savedLocators.find((l) => l.entry.id === val);
                                if (loc) {
                                  updateStep(step.id, {
                                    selector: loc.selector,
                                    locatorEntryId: loc.entry.id,
                                    locatorStrategy: loc.entry.strategy,
                                    locatorArguments: loc.entry.arguments,
                                    isFragile: false,
                                    reviewed: true,
                                  });
                                }
                              }}
                            >
                              <SelectTrigger
                                aria-label={`Saved locator for step ${index + 1}`}
                                className="h-5 text-[10px] text-muted-foreground border rounded bg-transparent px-1.5 min-w-[140px]"
                              >
                                <SelectValue placeholder="Link saved locator..." />
                              </SelectTrigger>
                              <SelectPopup>
                                {savedLocators.map((l) => (
                                  <SelectItem key={l.entry.id} value={l.entry.id}>
                                    [{l.pageName}] {l.entry.locatorKey}
                                  </SelectItem>
                                ))}
                              </SelectPopup>
                            </Select>
                          )}
                        </div>
                        <Input
                          aria-label={`Selector for step ${index + 1}`}
                          value={step.selector}
                          onChange={(e) =>
                            updateStep(step.id, {
                              selector: e.target.value,
                              reviewed: true,
                              locatorEntryId: undefined,
                              locatorStrategy: undefined,
                              locatorArguments: undefined,
                            })
                          }
                          placeholder="Playwright selector (e.g. button#submit)"
                          className="h-7 text-xs font-mono"
                        />
                      </div>

                      {/* Action-specific fields */}
                      {(step.action === "fill" || step.action === "selectOption") && (
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground">
                            Input Data (Value or Placeholder)
                          </label>
                          <Input
                            aria-label={`Input data for step ${index + 1}`}
                            value={step.value ?? ""}
                            onChange={(e) => updateStep(step.id, { value: e.target.value })}
                            placeholder={step.placeholder || "Enter test value or placeholder"}
                            className="h-7 text-xs font-mono"
                          />
                        </div>
                      )}

                      {step.action === "press" && (
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground">Key</label>
                          <Input
                            aria-label={`Key for step ${index + 1}`}
                            value={step.key || "Enter"}
                            onChange={(e) => updateStep(step.id, { key: e.target.value })}
                            placeholder="Enter, Tab, Escape..."
                            className="h-7 text-xs font-mono"
                          />
                        </div>
                      )}

                      {(step.action === "assertText" || step.action === "assertValue") && (
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground">
                            Expected {step.action === "assertText" ? "Text" : "Value"}
                          </label>
                          <Input
                            aria-label={`Expected value for step ${index + 1}`}
                            value={step.expectedValue ?? ""}
                            onChange={(e) =>
                              updateStep(step.id, {
                                expectedValue: e.target.value,
                              })
                            }
                            placeholder="Expected content"
                            className="h-7 text-xs font-mono"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Validation Gates Summary */}
          <div className="mt-3 space-y-1.5 rounded-md bg-muted/30 p-2.5 text-xs">
            <div className="font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">
              Test Runnable Validation Gates
            </div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 text-[11px]">
              <div className="flex items-center gap-1.5">
                {hasAction ? (
                  <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <AlertCircleIcon className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                )}
                <span
                  className={hasAction ? "text-foreground" : "text-amber-600 dark:text-amber-400"}
                >
                  Contains executable action(s)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {placeholdersResolved ? (
                  <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <AlertCircleIcon className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                )}
                <span
                  className={
                    placeholdersResolved ? "text-foreground" : "text-amber-600 dark:text-amber-400"
                  }
                >
                  Input placeholders mapped
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {hasReviewedAssertion ? (
                  <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <AlertCircleIcon className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                )}
                <span
                  className={
                    hasReviewedAssertion ? "text-foreground" : "text-amber-600 dark:text-amber-400"
                  }
                >
                  Contains reviewed business assertion
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {fragileSelectorsReviewed ? (
                  <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <AlertTriangleIcon className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                )}
                <span
                  className={
                    fragileSelectorsReviewed
                      ? "text-foreground"
                      : "text-amber-600 dark:text-amber-400"
                  }
                >
                  Fragile selectors reviewed ({unreviewedFragileSteps.length} unreviewed)
                </span>
              </div>
            </div>
          </div>

          {/* Code Preview Collapsible */}
          {showCodePreview && (
            <div className="mt-3 space-y-1.5">
              <label htmlFor="recorded-journey-code" className="text-xs font-medium">
                Playwright TypeScript Code Preview
              </label>
              <Textarea
                id="recorded-journey-code"
                value={displayedCode}
                onChange={(e) => setManualCodeEdit(e.target.value)}
                className="min-h-56 font-mono text-xs"
              />
            </div>
          )}

          {/* Save Action */}
          <div className="mt-3 flex items-center justify-end gap-2 border-t border-border/50 pt-2.5">
            {codeValidationError && manualCodeEdit !== null && (
              <span role="alert" className="mr-auto text-xs text-destructive">
                {codeValidationError}
              </span>
            )}
            <Button
              type="button"
              disabled={busy || !isRunnable}
              onClick={() => void save()}
              title={
                !isRunnable
                  ? "Resolve all validation gates above to enable saving"
                  : "Save spec to repository and create reviewed test case"
              }
            >
              Save to repository and Test runs (no AI)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

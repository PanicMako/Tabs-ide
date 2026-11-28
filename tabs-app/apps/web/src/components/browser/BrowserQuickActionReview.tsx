import { useId, useState } from "react";
import {
  BROWSER_QUICK_ACTION_MAX_STEPS,
  ProjectId,
  type BrowserQuickAction,
  type BrowserQuickActionSemantic,
  type BrowserQuickActionStep,
  type BrowserReproductionStep,
} from "@tabs/contracts";
import {
  browserQuickActionPage,
  checkBrowserQuickAction,
  isBrowserQuickActionInput,
  isBrowserQuickActionSelector,
  isBrowserQuickActionSemantic,
} from "@tabs/shared/browserQuickAction";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { workspaceShellActions } from "~/state/workspaceShell";
import { toastManager } from "~/components/ui/toast";

const ACTION_LABEL = {
  click: "Click",
  fill: "Fill",
  selectOption: "Select option",
  check: "Check",
  uncheck: "Uncheck",
} satisfies Record<BrowserQuickActionStep["action"], string>;

export function saveBrowserQuickAction(projectId: string, action: BrowserQuickAction): void {
  workspaceShellActions.upsertProjectSettings(ProjectId.makeUnsafe(projectId), (settings) => {
    const actions = settings.browserQuickActions ?? [];
    return {
      ...settings,
      browserQuickActions: actions.some((entry) => entry.id === action.id)
        ? actions.map((entry) => (entry.id === action.id ? action : entry))
        : [...actions, action],
    };
  });
}

type TargetDraft = {
  selector: string;
  semantic?: BrowserQuickActionSemantic;
  keepSemantic: boolean;
};

type StepDraft = Omit<BrowserQuickActionStep, "selector" | "semantic"> & TargetDraft;

const PARAMETER_MAX_LENGTH = 40;

function proposedParameter(target: TargetDraft, index: number, used: Set<string>): string {
  const { selector, semantic } = target;
  const stableName =
    selector.match(/\[(?:data-testid|data-test|data-cy|name)="([^"]+)"\]$/i)?.[1] ??
    (selector.startsWith("#") ? selector.slice(1) : undefined);
  const names = [stableName, semantic?.name, selector.match(/^\.(.+)$/)?.[1]];
  const base =
    names
      .map((name) =>
        name
          ?.normalize("NFKD")
          .replace(/\p{M}/gu, "")
          .replace(/[^a-z0-9]+/gi, "_")
          .replace(/^_+|_+$/g, "")
          .toLowerCase(),
      )
      .find((name) => name && /^[a-z]/.test(name)) ?? `input_${index + 1}`;

  // An input may need a different value even when it uses the same locator as an earlier step.
  let parameter = base.slice(0, PARAMETER_MAX_LENGTH);
  for (let number = 2; used.has(parameter); number++) {
    const suffix = `_${number}`;
    parameter = base.slice(0, PARAMETER_MAX_LENGTH - suffix.length) + suffix;
  }
  used.add(parameter);
  return parameter;
}

function capturedTarget(selector: string, semantic?: BrowserQuickActionSemantic): TargetDraft {
  const stableSelector = isBrowserQuickActionSelector(selector) ? selector : "";
  if (!isBrowserQuickActionSemantic(semantic)) {
    return { selector: stableSelector, keepSemantic: false };
  }
  const { role, name, group } = semantic;
  return {
    selector: stableSelector,
    semantic: { role, name, ...(group === undefined ? {} : { group }) },
    keepSemantic: true,
  };
}

function editSelector<T extends TargetDraft>(target: T, selector: string): T {
  const next = { ...target, selector };
  // Removing CSS still leaves the captured match as the sole target.
  if (selector.trim() && selector.trim() !== target.selector.trim()) {
    delete next.semantic;
    next.keepSemantic = false;
  }
  return next;
}

function reviewedTarget({ selector, semantic, keepSemantic }: TargetDraft) {
  return {
    selector: selector.trim(),
    ...(keepSemantic && semantic ? { semantic } : {}),
  };
}

function SemanticMatch({
  target,
  onCheckedChange,
}: {
  target: TargetDraft;
  onCheckedChange: (checked: boolean) => void;
}) {
  if (!target.semantic) return null;
  const { role, name, group } = target.semantic;
  return (
    <label className="flex items-start gap-2 text-xs">
      <Checkbox checked={target.keepSemantic} onCheckedChange={onCheckedChange} />
      <span className="min-w-0 space-y-1">
        <span className="block font-medium">Keep exact accessibility match</span>
        <span className="block wrap-anywhere text-muted-foreground">
          Role {role} · Name “{name}”{group && ` · Group “${group}”`}
        </span>
      </span>
    </label>
  );
}

export function BrowserQuickActionReview({
  projectId,
  sessionId,
  initialUrl,
  recorded,
  onClose,
}: {
  projectId: string;
  sessionId?: string | undefined;
  initialUrl: string;
  recorded: readonly BrowserReproductionStep[];
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [filenamePattern, setFilenamePattern] = useState("");
  const [outcome, setOutcome] = useState<TargetDraft>({ selector: "", keepSemantic: false });
  const filenameHelpId = useId();
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [drafts, setDrafts] = useState(() => {
    const usedParameters = new Set<string>();
    return recorded.flatMap((step, index) => {
      if (!Object.hasOwn(ACTION_LABEL, step.action)) return [];
      const action = step.action as BrowserQuickActionStep["action"];
      const target = capturedTarget(step.selector, step.semantic);
      return [
        {
          index,
          step: {
            action,
            ...target,
            ...(step.tag ? { tag: step.tag } : {}),
            ...(isBrowserQuickActionInput({ action })
              ? { parameter: proposedParameter(target, index, usedParameters) }
              : {}),
          } satisfies StepDraft,
        },
      ];
    });
  });
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const origin = browserQuickActionPage(initialUrl)?.origin ?? "";
  const editStep = (index: number, update: (step: StepDraft) => StepDraft) => {
    setDrafts((previous) =>
      previous.map((draft) =>
        draft.index === index ? { index, step: update(draft.step) } : draft,
      ),
    );
  };
  const pick = async () => {
    const bridge = window.desktopBridge;
    if (!bridge || !sessionId) return;
    setPicking(true);
    setError("");
    toastManager.add({ type: "info", title: "Choose the visible result in the browser" });
    try {
      const result = (await bridge.runBrowserAutomation({
        source: "human",
        projectId,
        sessionId,
        operation: "pickQuickActionOutcome",
        input: { origin },
      })) as
        | (Pick<BrowserQuickAction["outcome"], "selector" | "semantic"> & { tag?: string })
        | null;
      if (result) setOutcome(capturedTarget(result.selector, result.semantic));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not choose a browser control.");
    } finally {
      setPicking(false);
    }
  };
  const save = () => {
    const reviewedFilenamePattern = filenamePattern.trim();
    const action: BrowserQuickAction = {
      id: crypto.randomUUID(),
      label: label.trim(),
      origin,
      steps: drafts
        .filter((draft) => selected.has(draft.index))
        .map(({ step: { action, tag, parameter, ...target } }) => ({
          action,
          ...reviewedTarget(target),
          ...(tag === undefined ? {} : { tag }),
          ...(parameter === undefined ? {} : { parameter: parameter.trim() }),
        })),
      outcome: {
        ...reviewedTarget(outcome),
        description: description.trim(),
        ...(reviewedFilenamePattern ? { filenamePattern: reviewedFilenamePattern } : {}),
      },
    };
    const validationError = checkBrowserQuickAction(action);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      saveBrowserQuickAction(projectId, action);
      toastManager.add({ type: "success", title: "Quick Action saved", description: action.label });
      onClose();
    } catch {
      setError("Could not save the action. Check the reviewed controls and try again.");
    }
  };
  return (
    <Dialog
      open={!picking}
      onOpenChange={(open) => {
        if (!open && !picking) onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Keep as a Quick Action</DialogTitle>
          <DialogDescription>
            Select the steps to keep and specify how to check the result. Enter input values each
            time you run it.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4 text-sm">
          <label className="block space-y-1">
            <span>Name</span>
            <Input
              maxLength={80}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <fieldset className="space-y-2">
            <legend className="mb-2 font-medium">Steps to keep</legend>
            {drafts.length === 0 && (
              <p className="text-muted-foreground">
                Record a click or form interaction to teach an action.
              </p>
            )}
            {drafts.map(({ index, step }) => (
              <div
                key={index}
                data-shape="surface"
                className="space-y-2 border border-border p-2.5"
              >
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={selected.has(index)}
                    disabled={
                      !selected.has(index) && selected.size >= BROWSER_QUICK_ACTION_MAX_STEPS
                    }
                    onCheckedChange={(checked) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (checked) next.add(index);
                        else next.delete(index);
                        return next;
                      })
                    }
                  />
                  <span>{ACTION_LABEL[step.action]}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {step.selector || step.semantic?.name || "Review target"}
                  </span>
                </label>
                {selected.has(index) && (
                  <>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-xs text-muted-foreground">
                          {step.keepSemantic
                            ? "Control CSS selector (optional)"
                            : "Control selector"}
                        </span>
                        <Input
                          value={step.selector}
                          onChange={(event) => {
                            const selector = event.target.value;
                            editStep(index, (current) => editSelector(current, selector));
                          }}
                        />
                      </label>
                      {isBrowserQuickActionInput(step) && (
                        <label className="space-y-1">
                          <span className="text-xs text-muted-foreground">Parameter name</span>
                          <Input
                            maxLength={PARAMETER_MAX_LENGTH}
                            value={step.parameter ?? ""}
                            onChange={(event) => {
                              const parameter = event.target.value;
                              editStep(index, (current) => ({ ...current, parameter }));
                            }}
                          />
                        </label>
                      )}
                    </div>
                    <SemanticMatch
                      target={step}
                      onCheckedChange={(keepSemantic) =>
                        editStep(index, (current) => ({ ...current, keepSemantic }))
                      }
                    />
                  </>
                )}
              </div>
            ))}
          </fieldset>
          <label className="block space-y-1">
            <span>Expected result</span>
            <Input
              maxLength={200}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 space-y-1">
              <span>
                {outcome.keepSemantic
                  ? "Result CSS selector (optional)"
                  : "Element that should be visible"}
              </span>
              <Input
                value={outcome.selector}
                placeholder="#confirmation"
                onChange={(event) => {
                  const selector = event.target.value;
                  setOutcome((current) => editSelector(current, selector));
                }}
              />
            </label>
            {sessionId && (
              <Button variant="outline" onClick={() => void pick()}>
                Pick on page
              </Button>
            )}
          </div>
          <SemanticMatch
            target={outcome}
            onCheckedChange={(keepSemantic) =>
              setOutcome((current) => ({ ...current, keepSemantic }))
            }
          />
          <div className="space-y-1">
            <label className="block space-y-1">
              <span>Expected filename (optional)</span>
              <Input
                aria-describedby={filenameHelpId}
                autoComplete="off"
                spellCheck={false}
                placeholder="qa-report-{report_month}.csv"
                value={filenamePattern}
                onChange={(event) => setFilenamePattern(event.target.value)}
              />
            </label>
            <p id={filenameHelpId} className="text-xs text-muted-foreground">
              Enter an exact filename or put parameter names in braces. Replay reads the linked file
              to verify it.
            </p>
          </div>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Back
          </Button>
          <Button
            disabled={
              !label.trim() ||
              !description.trim() ||
              (!outcome.selector.trim() && !outcome.keepSemantic) ||
              !selected.size
            }
            onClick={save}
          >
            Save Quick Action
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

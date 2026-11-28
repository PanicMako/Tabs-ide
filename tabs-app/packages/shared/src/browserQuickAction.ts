import {
  BROWSER_QUICK_ACTION_FILENAME_MAX_LENGTH,
  BROWSER_QUICK_ACTION_ROLES,
  type BrowserQuickAction,
  type BrowserQuickActionSemantic,
  type BrowserQuickActionStep,
} from "@tabs/contracts";

export function browserQuickActionPage(value: string): URL | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

/** A stable ID, a single class, or a static semantic attribute. Broad
 * queries and positional fallback paths are unsuitable for unattended input. */
export function isBrowserQuickActionSelector(selector: string): boolean {
  return (
    selector.length <= 240 &&
    /^(?:[#.][a-z_][\w-]*|(?:[a-z][\w-]*)?\[(?:data-testid|data-test|data-cy|name|role|aria-label)="[\w .:/-]{1,100}"\])$/i.test(
      selector,
    ) &&
    !/[-_][0-9a-f]{10,}|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(selector)
  );
}

/** Static names only. Skip identifiers, links and likely credential labels. */
export function isBrowserQuickActionName(name: string): boolean {
  return (
    name.length <= 80 &&
    /^[\p{L}][\p{L}\p{M} '\u2019-]*$/u.test(name) &&
    !/\b(?:password|passcode|secret|token|api[- ]?key|bearer|pin|credential|otp|verification code|card number)\b/i.test(
      name,
    )
  );
}

export function isBrowserQuickActionSemantic(value: unknown): value is BrowserQuickActionSemantic {
  if (!value || typeof value !== "object" || !("role" in value) || !("name" in value)) return false;
  return (
    BROWSER_QUICK_ACTION_ROLES.some((role) => role === value.role) &&
    typeof value.name === "string" &&
    isBrowserQuickActionName(value.name) &&
    (!("group" in value) ||
      (typeof value.group === "string" && isBrowserQuickActionName(value.group)))
  );
}

function hasTarget(target: Pick<BrowserQuickActionStep, "selector" | "semantic">) {
  return (
    (target.semantic === undefined || isBrowserQuickActionSemantic(target.semantic)) &&
    (target.selector
      ? isBrowserQuickActionSelector(target.selector)
      : target.semantic !== undefined)
  );
}

export function isBrowserQuickActionInput(step: Pick<BrowserQuickActionStep, "action">): boolean {
  return step.action === "fill" || step.action === "selectOption";
}

export function browserQuickActionParameters(action: BrowserQuickAction, startAt = 0): string[] {
  return [
    ...new Set(
      action.steps.slice(startAt).flatMap((step) => (step.parameter ? [step.parameter] : [])),
    ),
  ];
}

const filenamePlaceholder = /\{([a-z][a-z0-9_]{0,39})\}/gi;

export function browserQuickActionFilenameParameters(action: BrowserQuickAction): string[] {
  return [
    ...new Set(
      Array.from(
        (action.outcome.filenamePattern ?? "").matchAll(filenamePlaceholder),
        (match) => match[1]!,
      ),
    ),
  ];
}

function isBrowserQuickActionFilename(filename: string): boolean {
  return (
    filename.length > 0 &&
    filename.length <= BROWSER_QUICK_ACTION_FILENAME_MAX_LENGTH &&
    filename === filename.trim() &&
    filename !== "." &&
    filename !== ".." &&
    !/[{}<>:"/\\|?*\p{Cc}]/u.test(filename)
  );
}

export function checkBrowserQuickAction(action: BrowserQuickAction): string | null {
  if (browserQuickActionPage(action.origin)?.origin !== action.origin)
    return "Record a demonstration on an HTTP(S) page.";
  if (action.steps.length === 0) return "Select at least one step to keep.";
  for (const step of action.steps) {
    if (!hasTarget(step))
      return "Choose a reviewed accessible name or stable selector for each step.";
    if (
      isBrowserQuickActionInput(step) &&
      (!step.parameter || !/^[a-z][a-z0-9_]{0,39}$/i.test(step.parameter))
    )
      return "Name each input using letters, numbers, or underscores.";
    if (
      /\b(?:password|passcode|secret|token|api[-_ ]?key|bearer|pin|credential|otp)\b/i.test(
        `${step.selector} ${step.parameter ?? ""}`.replaceAll("_", " "),
      )
    )
      return "Leave sign-in and credential steps out of the action.";
  }
  if (!hasTarget(action.outcome))
    return "Choose a reviewed accessible name or stable selector for the expected result.";
  const { filenamePattern } = action.outcome;
  if (filenamePattern !== undefined) {
    if (
      filenamePattern.length > BROWSER_QUICK_ACTION_FILENAME_MAX_LENGTH ||
      !isBrowserQuickActionFilename(filenamePattern.replace(filenamePlaceholder, "x"))
    )
      return "Enter a filename without path characters. Use {parameter} for a reviewed input.";
    const inputs = new Set(
      action.steps.filter(isBrowserQuickActionInput).map((step) => step.parameter),
    );
    if (browserQuickActionFilenameParameters(action).some((parameter) => !inputs.has(parameter)))
      return "Use only parameters from the selected input steps in the expected filename.";
  }
  return null;
}

export function resolveBrowserQuickActionFilename(
  action: BrowserQuickAction,
  values: ReadonlyMap<string, string>,
): string | undefined {
  const { filenamePattern } = action.outcome;
  if (filenamePattern === undefined) return undefined;
  const filename = filenamePattern.replace(filenamePlaceholder, (_, parameter: string) => {
    const value = values.get(parameter);
    if (value === undefined)
      throw new Error("Supply the reviewed parameters for the expected filename.");
    return value;
  });
  if (!isBrowserQuickActionFilename(filename))
    throw new Error("The reviewed inputs must produce a valid expected filename.");
  return filename;
}

export function prepareBrowserQuickActionValues(
  action: BrowserQuickAction,
  raw: unknown,
  startAt = 0,
  lockedValues?: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  const provided = typeof raw === "object" && raw !== null ? raw : {};
  const filenameParameters = browserQuickActionFilenameParameters(action);
  for (const parameter of browserQuickActionParameters(action, startAt)) {
    const original = lockedValues?.get(parameter);
    const value: unknown = Object.hasOwn(provided, parameter)
      ? (provided as Record<string, unknown>)[parameter]
      : original;
    if (original !== undefined && value !== original)
      throw new Error(
        filenameParameters.includes(parameter)
          ? "Keep the original inputs for the expected filename when continuing this run."
          : "Keep the original values for inputs already used in this run.",
      );
    if (typeof value !== "string" || value.length > 4096)
      throw new Error("Supply the reviewed parameters before running the action.");
    values.set(parameter, value);
  }
  for (const parameter of filenameParameters) {
    if (values.has(parameter)) continue;
    const value = lockedValues?.get(parameter);
    if (value !== undefined) values.set(parameter, value);
  }
  resolveBrowserQuickActionFilename(action, values);
  return values;
}

/**
 * Turns a failed Cursor SDK run into a message a person can act on.
 *
 * `Cursor.models.list()` returns the full catalog whatever the account's plan.
 * On the free Hobby plan, and on any plan once included usage runs out, Cursor
 * only runs Auto: a named model then ends with `status: "error"` and often no
 * `error.message` at all. Without this, the thread only showed a generic
 * provider failure.
 */

const AUTO_MODEL_IDS = new Set(["auto", "default"]);

/** Cursor's wording for "your plan or usage does not allow this model". */
const PLAN_RESTRICTION_PATTERN =
  /plan_required|current plan|upgrade|hobby|free plan|pro plan|included usage|usage limit|not available on your|does not work with your/i;

export interface CursorRunFailureInput {
  /** The model the turn asked for, as Tabs stores it (`auto`, `gpt-5`, ...). */
  readonly requestedModel: string;
  readonly error?: { readonly message?: string; readonly code?: string } | undefined;
}

export interface CursorRunFailure {
  readonly message: string;
  readonly code: string | null;
  readonly planRestricted: boolean;
}

export function describeCursorRunFailure(input: CursorRunFailureInput): CursorRunFailure {
  const reason = input.error?.message?.trim() ?? "";
  const code = input.error?.code?.trim() || null;
  const model = input.requestedModel.trim();
  const namedModel = model.length > 0 && !AUTO_MODEL_IDS.has(model.toLowerCase());
  const planText = `${code ?? ""} ${reason}`;

  if (namedModel && (reason.length === 0 || PLAN_RESTRICTION_PATTERN.test(planText))) {
    const detail = reason.length > 0 ? ` Cursor said: ${reason}` : "";
    return {
      message:
        `Cursor couldn't run ${model}. On the free Hobby plan, or once your included usage ` +
        `runs out, Cursor only runs Auto. Switch this thread to Auto, or upgrade your Cursor plan.` +
        detail,
      code,
      planRestricted: true,
    };
  }
  return {
    message: reason.length > 0 ? reason : "Cursor ended the run with an error and gave no reason.",
    code,
    planRestricted: false,
  };
}

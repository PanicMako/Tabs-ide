import type { BrowserWorkflowDefinition, BrowserWorkflowPageResult } from "@tabs/contracts";

type SubmissionBindingRequest = { currentId?: string; nextId?: string };

export type BrowserWorkflowLocalUpload = {
  name: string;
  type: string;
  base64: string;
};

/**
 * Run in an isolated guest world. The final read and action run in the same
 * turn of the page event loop, so there is no gap for another DOM update.
 */
function observeWorkflowPage(
  definition: BrowserWorkflowDefinition,
  submit: boolean,
  statusOnly: boolean,
  approval?: SubmissionBindingRequest,
  expectedAction: "upload" | "submit" = "submit",
  localUpload?: BrowserWorkflowLocalUpload,
): BrowserWorkflowPageResult {
  const unavailable = (reason: string): BrowserWorkflowPageResult => ({
    disposition: "unobservable",
    reason,
  });
  if (location.href !== definition.url || document.readyState === "loading") {
    return unavailable("The exact workflow page is not ready.");
  }
  const readOnly = definition.readOnly === true;
  const configuredBreakpoint = definition.breakpoint;
  if (
    !readOnly &&
    definition.uploadInputSelector !== undefined &&
    definition.uploadSelector !== undefined
  ) {
    return unavailable("Use one upload control for the workflow.");
  }

  function visibleMatch(selector: string): HTMLElement | undefined {
    let matches: NodeListOf<Element>;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      return;
    }
    const element = matches[0];
    if (matches.length !== 1 || !(element instanceof HTMLElement)) return;
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || element.closest("[hidden], [inert]")) return;
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.visibility !== "visible" || style.display === "none" || Number(style.opacity) === 0)
        return;
    }
    return element;
  }

  function isHittable(element: HTMLElement): boolean {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    return hit !== null && element.contains(hit);
  }

  function uploadFormDestination(input: HTMLInputElement) {
    const form = input.form;
    const action = form?.getAttribute("action");
    const target = form?.getAttribute("target");
    const baseTarget = document.querySelector("base[target]")?.getAttribute("target");
    const baseUri = document.baseURI;
    const resolvedTarget = target ?? baseTarget ?? "";
    let resolvedAction: URL | undefined;
    if (form) {
      try {
        resolvedAction = new URL(action || location.href, baseUri);
      } catch {
        return;
      }
      if (
        resolvedAction.origin !== location.origin ||
        resolvedAction.protocol !== location.protocol ||
        (resolvedTarget && resolvedTarget.toLowerCase() !== "_self")
      ) {
        return;
      }
    }
    return {
      action,
      target,
      baseTarget,
      baseUri,
      resolvedAction: resolvedAction?.href,
      resolvedTarget,
      method: form?.getAttribute("method"),
      enctype: form?.getAttribute("enctype"),
    };
  }

  const visibleText = (selector: string) => visibleMatch(selector)?.innerText.trim();
  let observation: BrowserWorkflowPageResult["observation"];
  let button: HTMLButtonElement | undefined;
  let uploadInput: HTMLInputElement | undefined;
  let uploadDestination: ReturnType<typeof uploadFormDestination>;
  let fileInput: HTMLInputElement | undefined;
  let file: File | undefined;
  let siteKey: { field: HTMLInputElement; name: string; value: string } | undefined;
  try {
    if (visibleText(definition.identitySelector) !== definition.resourceId) {
      return unavailable("The visible draft ID did not uniquely match the selected result.");
    }
    const statusText = visibleText(definition.statusSelector);
    const matches = (
      Object.keys(definition.states) as Array<keyof typeof definition.states>
    ).filter((key) => definition.states[key] === statusText);
    const [stage] = matches;
    if (stage === undefined || matches.length !== 1 || statusText === undefined) {
      return unavailable("No unique visible status matched a configured lifecycle label.");
    }
    observation = {
      stage,
      statusText,
      breakpoint: "irrelevant",
      submitAvailable: false,
      // The visible draft ID, already verified equal to the definition's resource ID.
      identityText: definition.resourceId.trim(),
    };
    const action = stage === "ready_to_upload" ? "upload" : stage === "uploaded" ? "submit" : null;
    if (readOnly || statusOnly || !action) return { disposition: "observed", observation };

    if (!configuredBreakpoint) return unavailable("The workflow is missing its breakpoint.");
    const condition = visibleText(configuredBreakpoint.selector);
    const breakpoint =
      condition === configuredBreakpoint.pauseText
        ? "matched"
        : condition === configuredBreakpoint.clearText
          ? "clear"
          : "unobservable";
    const uploadInputSelector = action === "upload" ? definition.uploadInputSelector : undefined;
    const selector =
      action === "upload"
        ? (uploadInputSelector ?? definition.uploadSelector)
        : definition.submitSelector;
    const candidate = selector ? visibleMatch(selector) : undefined;
    if (uploadInputSelector !== undefined) {
      if (
        candidate instanceof HTMLInputElement &&
        candidate.type === "file" &&
        !candidate.matches(":disabled") &&
        !candidate.closest('[aria-disabled="true" i], [aria-hidden="true" i]') &&
        !candidate.multiple &&
        !candidate.hasAttribute("webkitdirectory") &&
        candidate.files?.length === 0 &&
        isHittable(candidate)
      ) {
        uploadDestination = uploadFormDestination(candidate);
        if (uploadDestination) uploadInput = candidate;
      }
    } else if (
      candidate instanceof HTMLButtonElement &&
      !candidate.matches(":disabled") &&
      !candidate.closest('[aria-disabled="true"]')
    ) {
      const formTarget = candidate.getAttribute("formtarget") ?? candidate.form?.target;
      const formAction = candidate.hasAttribute("formaction")
        ? candidate.formAction
        : candidate.form?.action;
      // A native form must stay in this tab and within the inspected origin.
      let safeDestination = false;
      try {
        safeDestination =
          (!formTarget || formTarget.toLowerCase() === "_self") &&
          (!formAction || new URL(formAction).origin === location.origin);
      } catch {
        // Keep the draft observation even when the submit destination is invalid.
      }
      if (safeDestination && isHittable(candidate)) button = candidate;
      if (button && action === "upload") {
        const fields = Array.from(button.form?.elements ?? []).filter(
          (field): field is HTMLInputElement =>
            field instanceof HTMLInputElement &&
            field.type === "file" &&
            !field.matches(":disabled"),
        );
        fileInput = fields.length === 1 ? fields[0] : undefined;
        const files = fileInput?.files;
        file = files?.length === 1 ? files[0] : undefined;
        if (!file?.name.trim() || file.name.length > 300 || file.size === 0) button = undefined;
      }
      if (button && action === "submit" && button.form) {
        const form = button.form;
        const name = form.getAttribute("data-tabs-submit-idempotency");
        if (name !== null) {
          const method = button.getAttribute("formmethod") ?? form.method;
          const fields = Array.from(form.elements).filter(
            (field) => field.getAttribute("name") === name,
          );
          const field = fields[0];
          if (
            button.type !== "submit" ||
            method.toLowerCase() !== "post" ||
            !name.trim() ||
            fields.length !== 1 ||
            !(field instanceof HTMLInputElement) ||
            field.type !== "hidden" ||
            field.matches(":disabled") ||
            !field.value.trim()
          ) {
            return {
              disposition: "observed",
              observation: { ...observation, breakpoint },
              reason: "Submit needs the site's unique, enabled submission key.",
            };
          }
          siteKey = { field, name, value: field.value };
        }
      }
    }
    const submitRequiresUser = action === "submit" && button !== undefined && siteKey === undefined;
    observation = {
      ...observation,
      breakpoint,
      ...(action === "upload"
        ? { uploadAvailable: button !== undefined || uploadInput !== undefined }
        : { submitAvailable: siteKey !== undefined }),
      ...(submitRequiresUser && { submitRequiresUser: true as const }),
    };
    // A native form POST can be repeated by Chromium after a disconnect. Only a
    // site that supplies a submission key can deduplicate those requests.
    if (submitRequiresUser) {
      return {
        disposition: "observed",
        observation,
        reason:
          "This site does not provide a submission key. Submit in the original draft, then check its status.",
      };
    }
    if (submit && action !== expectedAction) return { disposition: "observed", observation };
  } catch {
    return unavailable("A workflow selector or the submit destination could not be resolved.");
  }
  const control = uploadInput ?? button;
  if (observation.breakpoint !== "clear" || !control) {
    return { disposition: "observed", observation };
  }

  const selectingFile = control instanceof HTMLInputElement;
  const key = Symbol.for("tabs.browser-workflow.approval");
  const world = globalThis as typeof globalThis & {
    [key: symbol]: {
      id: string;
      control: HTMLButtonElement | HTMLInputElement;
      form: HTMLFormElement | null;
      description: string;
      fileInput: HTMLInputElement | undefined;
      file: File | undefined;
      siteKey: typeof siteKey;
    };
  };
  let submitControlBinding: BrowserWorkflowPageResult["submitControlBinding"];
  let submitControlLabel: string | undefined;
  if (approval) {
    const form = control.form;
    const text = selectingFile
      ? Array.from(control.labels ?? [], (label) => label.innerText.trim())
          .join(" ")
          .trim()
      : control.innerText.trim();
    const ariaLabel = control.getAttribute("aria-label")?.trim();
    const description = JSON.stringify(
      selectingFile
        ? [
            text,
            observation.stage,
            ariaLabel,
            location.href,
            definition.resourceId,
            observation.statusText,
            configuredBreakpoint?.clearText,
            control.name,
            control.accept,
            control.getAttribute("form"),
            uploadDestination,
          ]
        : [
            text,
            observation.stage,
            ariaLabel,
            control.type,
            control.hasAttribute("formaction") ? control.formAction : form?.action,
            control.hasAttribute("formmethod") ? control.formMethod : form?.method,
            siteKey && (control.hasAttribute("formenctype") ? control.formEnctype : form?.enctype),
            control.getAttribute("formtarget") ?? form?.target,
          ],
    );
    const bound = world[key];
    if (
      bound &&
      bound.id === approval.currentId &&
      bound.control === control &&
      bound.form === form &&
      bound.description === description &&
      bound.fileInput === fileInput &&
      bound.file === file &&
      bound.siteKey?.field === siteKey?.field &&
      bound.siteKey?.name === siteKey?.name &&
      bound.siteKey?.value === siteKey?.value
    ) {
      submitControlBinding = "retained";
    } else if (approval.nextId) {
      world[key] = {
        id: approval.nextId,
        control,
        form,
        description,
        fileInput,
        file,
        siteKey,
      };
      submitControlBinding = "bound";
      submitControlLabel =
        (ariaLabel || text).replace(/\s+/gu, " ").slice(0, 120).trim() || undefined;
    }
  }
  if (
    !submit ||
    ((approval || selectingFile) && submitControlBinding !== "retained") ||
    (selectingFile && !localUpload)
  ) {
    return {
      disposition: "observed",
      observation,
      ...(submitControlBinding ? { submitControlBinding } : {}),
      ...(submitControlLabel ? { submitControlLabel } : {}),
      ...(selectingFile && submitControlBinding === "bound" && { chooseUploadFile: true }),
      ...(siteKey && submitControlBinding === "bound" && { siteSubmissionKey: true }),
      ...(file &&
        submitControlBinding === "bound" && {
          uploadFile: { name: file.name.trim(), size: file.size },
        }),
    };
  }

  if (selectingFile && localUpload) {
    try {
      const bytes = Uint8Array.from(atob(localUpload.base64), (byte) => byte.charCodeAt(0));
      const selectedFile = new File([bytes], localUpload.name, {
        type: localUpload.type,
      });
      const files = new DataTransfer();
      files.items.add(selectedFile);
      delete world[key];
      control.files = files.files;
      // File contents are immutable, so identity verifies the assigned bytes synchronously.
      if (control.files?.length !== 1 || control.files[0] !== selectedFile) {
        return {
          disposition: "observed",
          observation,
          reason: "The input did not retain the selected file.",
        };
      }
    } catch {
      return {
        disposition: "observed",
        observation,
        reason: "The selected file could not be assigned.",
      };
    }
    control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    if (submitControlBinding === "retained") delete world[key];
    // A synthetic activation works for ordinary buttons and native forms. A site
    // requiring trusted pointer input must be handled by the user.
    HTMLElement.prototype.click.call(control);
  }
  return { disposition: "dispatched", observation };
}

export function browserWorkflowPageScript(
  definition: BrowserWorkflowDefinition,
  submit: boolean,
  statusOnly = false,
  approval?: SubmissionBindingRequest,
  expectedAction: "upload" | "submit" = "submit",
  localUpload?: BrowserWorkflowLocalUpload,
) {
  return `(${observeWorkflowPage.toString()})(${JSON.stringify(definition)}, ${submit}, ${statusOnly}, ${JSON.stringify(approval)}, ${JSON.stringify(expectedAction)}, ${JSON.stringify(localUpload)})`;
}

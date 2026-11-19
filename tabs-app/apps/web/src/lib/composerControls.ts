/** The accessible names of the composer toolbar controls a shortcut can open. */
export const COMPOSER_CONTROL_LABELS = {
  branch: "Branch or worktree",
  workspace: "Workspace mode",
} as const;

export type ComposerControl = keyof typeof COMPOSER_CONTROL_LABELS;

/** Opens the composer's model picker, which is also where the thinking-level control lives. */
export function openComposerModelPicker(root: ParentNode = document): boolean {
  const button = root.querySelector<HTMLElement>(
    '[data-chat-composer-form="true"] [data-model-picker-trigger="true"]:not([disabled])',
  );
  if (!button) return false;
  button.focus();
  button.click();
  return true;
}

/**
 * Opens one of the composer toolbar's pickers by clicking its button, the same as the mouse would.
 * Returns false when that control is not on screen (no project, or the toolbar is folded away).
 */
export function openComposerControl(
  control: ComposerControl,
  root: ParentNode = document,
): boolean {
  const label = COMPOSER_CONTROL_LABELS[control];
  const toolbar = root.querySelector('[data-chat-workspace-controls="true"]');
  const button = [...(toolbar?.querySelectorAll<HTMLElement>("button") ?? [])].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label && !candidate.hasAttribute("disabled"),
  );
  if (!button) return false;
  button.focus();
  button.click();
  return true;
}

/** Opens the "Run on machine" picker. It sits outside the git toolbar when there is no repository. */
export function openComposerHostPicker(root: ParentNode = document): boolean {
  const button = root.querySelector<HTMLElement>(
    'button[aria-label="Run on machine"]:not([disabled])',
  );
  if (!button) return false;
  button.focus();
  button.click();
  return true;
}

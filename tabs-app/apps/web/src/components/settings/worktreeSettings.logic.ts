import type { BranchNamingMode, WorktreeSubmodules } from "@tabs/contracts";

export type SubmodulesChoice = "repository" | WorktreeSubmodules;

/** A null setting means "do what the repository says", which is its own choice in the picker. */
export function submodulesChoice(value: WorktreeSubmodules | null | undefined): SubmodulesChoice {
  return value ?? "repository";
}

export function submodulesFromChoice(choice: SubmodulesChoice): WorktreeSubmodules | null {
  return choice === "repository" ? null : choice;
}

export const SUBMODULE_LABELS: Record<SubmodulesChoice, string> = {
  repository: "Follow the repository",
  recursive: "Fetch all, nested ones too",
  "top-level": "Fetch top-level only",
  none: "Do not fetch",
};

export const BRANCH_NAMING_LABELS: Record<BranchNamingMode, { label: string; hint: string }> = {
  static: {
    label: "Fixed prefix",
    hint: "Every new branch starts with the same prefix, then a name made from your first message.",
  },
  semantic: {
    label: "Describe the work",
    hint: "The model picks a prefix that fits, such as feat/add-search or fix/login-timeout.",
  },
  custom: {
    label: "My own instructions",
    hint: "Tell the model exactly how you want branches named.",
  },
};

/** Which of the branch-naming fields apply to a mode, so the page only shows what matters. */
export function branchNamingFields(mode: BranchNamingMode): {
  readonly prefix: boolean;
  readonly instructions: boolean;
} {
  return { prefix: mode === "static", instructions: mode === "custom" };
}

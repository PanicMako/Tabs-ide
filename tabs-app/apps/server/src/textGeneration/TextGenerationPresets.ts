import type { TextGenerationPolicy, TextGenerationPolicyKind } from "./TextGenerationPolicy.ts";

export const defaultTextGenerationPolicy: TextGenerationPolicy = {
  kind: "default",
  inferRepositoryConventions: false,
};

export const conventionalCommitsTextGenerationPolicy: TextGenerationPolicy = {
  kind: "conventional_commits",
  commitInstructions: [
    "Use Conventional Commits 1.0.0: <type>[optional scope][optional !]: <description>.",
    "Use lowercase types: feat for new capabilities, fix for defects, perf for performance changes, refactor for restructuring without behavior changes, docs, test, build, ci, style for formatting, chore for maintenance, or revert.",
    "Choose the dominant intent from the actual changes. Do not label new functionality as chore, or claim a fix without evidence of a defect.",
    "Use one short scope only when a clear subsystem emerges; omit it for changes spanning unrelated areas. Do not use a filename or list of symbols as a scope.",
    "After the prefix, use a concise imperative description of the resulting behavior. Keep the entire subject within 72 characters with no trailing period.",
    "Use ! or a BREAKING CHANGE footer only for a demonstrated incompatible public API change.",
    "Examples of structure, not facts to copy: feat(scm): draft commit messages from staged changes; fix(explorer): preserve focus when renaming files; refactor(theme): share surface token derivation.",
  ].join(" "),
  changeRequestInstructions:
    "Keep the change request title concise. Do not force Conventional Commit syntax into the title unless the repository already uses it.",
  inferRepositoryConventions: false,
};

export const repositoryConventionsTextGenerationPolicy: TextGenerationPolicy = {
  kind: "repo_conventions",
  commitInstructions:
    "Follow the repository's established commit message style when examples are available.",
  changeRequestInstructions:
    "Follow the repository's established change request title and body style when examples are available.",
  inferRepositoryConventions: true,
};

export const customTextGenerationPolicy = (
  overrides: Omit<Partial<TextGenerationPolicy>, "kind">,
): TextGenerationPolicy => ({
  kind: "custom",
  inferRepositoryConventions: false,
  ...overrides,
});

export const textGenerationPresets: Record<
  Exclude<TextGenerationPolicyKind, "custom">,
  TextGenerationPolicy
> = {
  default: defaultTextGenerationPolicy,
  conventional_commits: conventionalCommitsTextGenerationPolicy,
  repo_conventions: repositoryConventionsTextGenerationPolicy,
};

/**
 * Sub-agent staffing shared by every kind of app-owned delegation: a plain
 * `delegate_task` call and each Overmind task. Pure, so the server enforces
 * exactly what the settings UI shows.
 */
import type {
  ModelSelection,
  OrchestratorMcpSubagentModels,
  OrchestratorMcpTarget,
  SubagentModelSettings,
  SubagentRole,
} from "@tabs/contracts";

export const SUBAGENT_ROLES: ReadonlyArray<SubagentRole> = [
  "implementation",
  "research",
  "review",
  "design",
  "test",
  "general",
];

export const DEFAULT_SUBAGENT_MODEL_SETTINGS: SubagentModelSettings = {
  enabled: false,
  workers: null,
  roles: {},
};

/** Roles that only read; they never conflict with other work. */
export const READ_ONLY_SUBAGENT_ROLES: ReadonlySet<SubagentRole> = new Set(["research", "review"]);

/** True when the user picked at least one model and the switch is on. */
export function isSubagentStaffingActive(
  settings: SubagentModelSettings | null | undefined,
): settings is SubagentModelSettings {
  return (
    settings?.enabled === true &&
    (settings.workers !== null || Object.values(settings.roles).some((value) => value != null))
  );
}

/**
 * The model a sub-agent of `role` must run on, or null when the user left the
 * choice to the lead. A role without its own model uses the default worker;
 * a task without a role counts as general work.
 */
export function resolveSubagentModel(
  settings: SubagentModelSettings | null | undefined,
  role: SubagentRole | undefined,
): ModelSelection | null {
  if (!isSubagentStaffingActive(settings)) return null;
  return settings.roles[role ?? "general"] ?? settings.workers ?? null;
}

const ROLE_BRIEFS: Readonly<Record<SubagentRole, string | null>> = {
  implementation:
    "Make the change end to end. Follow the repository's own instructions (AGENTS.md, CLAUDE.md, contributing docs) and its existing patterns. Run the tests and checks that cover what you touched and report what passed.",
  research:
    "Investigate and report; do not modify files. Cite a file path and line for every claim, and keep what you verified apart from what you infer.",
  review:
    "Review only; do not modify files. Report concrete defects first, most severe first, each with file and line, the scenario that fails and a suggested fix. Skip style nits unless asked.",
  design:
    "You own the user-facing design: layout, visual hierarchy, interaction and copy. Before changing UI, read the project's design rules (AGENTS.md, CLAUDE.md, design tokens and existing components) and follow them, and use a design or frontend skill if your environment provides one. Reuse existing components and tokens instead of inventing new ones, check narrow and wide layouts and light and dark themes, and describe what changed visually.",
  test: "Write or update tests for the behaviour described, using the project's existing test patterns and runners, and run them. Report the exact commands and results, including failures you could not fix.",
  general: null,
};

/** What a sub-agent of `role` is told about its job, or null for general work. */
export function subagentRoleBrief(role: SubagentRole | undefined): string | null {
  return role === undefined ? null : ROLE_BRIEFS[role];
}

/** The task prompt a delegated sub-agent receives, led by its role brief. */
export function buildSubagentTaskPrompt(role: SubagentRole | undefined, task: string): string {
  const brief = subagentRoleBrief(role);
  return brief === null ? task : `You are the ${role} sub-agent for this task. ${brief}\n\n${task}`;
}

/**
 * The delegation target a sub-agent runs on. The user's model replaces the
 * lead's request whole, so a stale provider or option set cannot leak in.
 */
export function applySubagentModel(
  settings: SubagentModelSettings | null | undefined,
  role: SubagentRole | undefined,
  requested: OrchestratorMcpTarget | undefined,
): OrchestratorMcpTarget | undefined {
  const chosen = resolveSubagentModel(settings, role);
  if (chosen === null) return requested;
  return {
    providerInstanceId: chosen.instanceId,
    model: chosen.model,
    ...(chosen.options !== undefined && chosen.options.length > 0
      ? { options: chosen.options }
      : {}),
  };
}

/** The sub-agent model choice as `orchestrator_capabilities` reports it to the lead. */
export function describeSubagentModelsForLead(
  settings: SubagentModelSettings | null | undefined,
): OrchestratorMcpSubagentModels {
  if (!isSubagentStaffingActive(settings)) return { enforced: false, default: null, roles: [] };
  return {
    enforced: true,
    default:
      settings.workers === null
        ? null
        : { providerInstanceId: settings.workers.instanceId, model: settings.workers.model },
    roles: SUBAGENT_ROLES.flatMap((role) => {
      const choice = settings.roles[role];
      return choice ? [{ role, providerInstanceId: choice.instanceId, model: choice.model }] : [];
    }),
  };
}

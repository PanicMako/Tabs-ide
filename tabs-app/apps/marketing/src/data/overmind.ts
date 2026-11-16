/** Sample run shown in the sub-agents and Overmind sections. */
export const GOAL = "Ship v2: team plans, SSO and a new dashboard";

/** Eight tasks of the run. `billing` fails once and is retried; `e2e` waits for billing and SSO. */
export const lanes = [
  { id: "research", task: "Rival pricing research", pv: "grok" },
  { id: "dashboard", task: "Dashboard UI", pv: "cursor" },
  { id: "pricing", task: "Pricing API", pv: "codex" },
  { id: "billing", task: "Team billing", pv: "copilot" },
  { id: "sso", task: "SSO and SAML", pv: "kiro" },
  { id: "postgres", task: "Postgres migration", pv: "opencode" },
  { id: "docs", task: "Docs and changelog", pv: "muse" },
  { id: "e2e", task: "End-to-end tests", pv: "antigravity" },
] as const;

/** The three helpers drawn on the sub-agents graph. */
export const helpers = [{ pv: "codex" }, { pv: "grok" }, { pv: "cursor" }] as const;

/** Kinds of work you can hand to a model of your choice, with the default pick and who to pick. */
export const roles = [
  { id: "lead", noun: "Lead", verb: "leads", pv: "claude", pick: "Your favourite. It plans the work and runs the whole operation." },
  { id: "design", noun: "Design", verb: "designs", pv: "cursor", pick: "The one with the best eye for interfaces." },
  { id: "research", noun: "Research", verb: "researches", pv: "grok", pick: "The one you trust to read everything first." },
  { id: "build", noun: "Build", verb: "builds", pv: "codex", pick: "The one whose code you'd merge without a fight." },
  { id: "review", noun: "Review", verb: "reviews", pv: "kiro", pick: "A second opinion, from a different maker." },
  { id: "test", noun: "Test", verb: "tests", pv: "copilot", pick: "The thorough one. It tries to break it." },
] as const;

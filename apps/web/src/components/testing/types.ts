/**
 * Shared types for the Testing workspace.
 *
 * All types that are used across more than one Testing view component live here.
 * Import from this module, never re-define locally.
 */

export type TestingAuthenticationMode = "none" | "local-profile" | "connected-session";

export type TestingWorkspaceSection =
  | "overview"
  | "discover"
  | "cases"
  | "automate"
  | "runs"
  | "reports";

export type TestingCaseFilter = "all" | "needs-review" | "accepted" | "blocked";

export type TestingLocatorFilter = "all" | "selected" | "needs-review" | "archived";

export type TestingLocatorCaptureScope = "task" | "page" | "path" | "origin";

export type TestingBusyAction =
  | "auth"
  | "finish-auth"
  | "explore"
  | "import"
  | "generate"
  | "generate-tests"
  | "review"
  | "clear"
  | "cancel-generation"
  | "run-tests"
  | "healing-decision"
  | "schedule"
  | "report"
  | "trace"
  | "bug-draft"
  | "triage"
  | "locator-discovery"
  | "locator-capture"
  | "locator-review"
  | "locator-index"
  | "locator-page"
  | "locator-code"
  | "locator-repository"
  | "story-import"
  | null;

export type TestingLocatorPageTab = "locators" | "code" | "diff" | "history";

export type TestingCaseIntakeMode = "manual" | "excel" | "story" | "graph";

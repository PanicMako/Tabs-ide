import type { SessionSearchAgent, SessionSearchResumeResult } from "@tabs/contracts";

import type { StoredSession } from "./store.ts";

const SAFE_ID = /^[A-Za-z0-9_.-]{1,128}$/;

/** Shell command that continues a past session, run from the session's working directory. */
export function resumeCommandFor(agent: SessionSearchAgent, sessionId: string): string | null {
  if (!SAFE_ID.test(sessionId)) return null;
  switch (agent) {
    case "claude":
      return `claude --resume ${sessionId}`;
    case "codex":
      return `codex resume ${sessionId}`;
    case "opencode":
      return `opencode --session ${sessionId}`;
    case "gemini":
      // Gemini CLI resumes by recency/index, not by a stable session id.
      return null;
  }
}

export function resumeResult(stored: StoredSession): SessionSearchResumeResult {
  return {
    agent: stored.agent,
    sessionId: stored.sessionId,
    cwd: stored.cwd,
    command: resumeCommandFor(stored.agent, stored.sessionId),
    transcriptPath: stored.transcriptPath,
  };
}

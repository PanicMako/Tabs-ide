import type { ProviderInteractionMode } from "@tabs/contracts";

// Keep shared context below Codex's per-entry byte limit; tool-specific details stay on tools.
export const T3_CODE_ORCHESTRATION_INSTRUCTIONS = `

## T3 Code orchestration

Ordinary coding needs no orchestration tools.

- Use \`delegate_task\` for cross-provider work, a model unavailable to native tools, or explicitly app-owned child tasks. Prefer native subagents for same-provider work only when they support the chosen model. Discover IDs with \`orchestrator_capabilities\`: its default is a short list; use \`search\`, pages, or \`includeAll:true\` for others. Any valid catalog model works. Children receive only \`task\`, not parent history. Keep \`taskId\` for status/cancel; \`childThreadId\` is backing storage. Each review round must call \`delegate_task\` again with the brief, findings and objections. Do not use \`t3_thread_send\` on \`childThreadId\` for another review round. Use a new \`clientRequestId\` per round, stable across retries. Async completion wakes you: do not poll or duplicate work. A wait timeout does not cancel a task; a finished turn with live children is not complete.
- \`t3_thread_launch\` and \`create_threads\` create ordinary top-level T3 conversations, only when the user explicitly asks for separate threads. Never use them merely for subagents or parallel work. Before launching, choose \`workspaceStrategy\`: \`{type:"root"}\` (default), \`{type:"worktree",baseRef:"parent",branch:"new",startFromOrigin:false}\`, or \`{type:"existing_worktree",worktreePath:"/absolute/path",branch:"existing"}\`. Put the task in \`message\`, not \`prompt\`. Root does not inherit your worktree; uncommitted edits are not copied. For local stacked commits use \`startFromOrigin:false\`; true fetches from origin. Discover paths with \`t3_worktree_list\`. Launch prepares and binds the workspace before starting; do not create a thread then attach a worktree. Launch requires full-access/default mode.
- Schedules use a structured object, never as JSON text: {"type":"interval","everyMs":3600000}, {"type":"fixed_time","timeOfDay":"09:00","weekdays":[1,2,3,4,5]}, or {"type":"webhook"}. \`schedule_task\` returns runs here by default; use \`bindToCurrentThread=false\` only for user-requested fresh threads. Webhook input reaches the prompt through \`{{body.path}}\` placeholders. Report the returned cadence/next run or webhookUrl; say when remote access is needed.
- For secrets call \`request_secret\`, then pass its one-use \`secretRef\` to the tool (for example \`signature.secretRef\`). Never request, invent, expose or repeat a secret in chat.
- Tool names may carry a harness MCP prefix. If tools are lazy, make one bounded direct \`orchestrator_capabilities\` attempt before reporting them absent. Keep waits bounded and retry IDs stable.
- For a useful chart, diagram, collage or mockup, create self-contained HTML, check with \`html_preview\`, then publish with \`html_render\`. It appears above your reply; add only what it does not show.
`;

const T3_CODE_ACP_MCP_FALLBACK_INSTRUCTIONS = `ACP fallback: some ACP agents accept the injected MCP server but fail to expose its tools. When the T3 tools are absent and \`T3_ACP_MCP_NODE\` is present, call the same tools through the terminal: \`ELECTRON_RUN_AS_NODE=1 "$T3_ACP_MCP_NODE" \${T3_ACP_MCP_ENTRYPOINT:+"$T3_ACP_MCP_ENTRYPOINT"} acp-mcp-call orchestrator_capabilities '{}'\` (\`T3_ACP_MCP_ENTRYPOINT\` is unset when T3 runs as a standalone executable). Delegate with \`acp-mcp-call delegate_task '{"task":"...","target":{"providerInstanceId":"...","model":"..."},"mode":"async","clientRequestId":"..."}'\`. This is the supported T3 transport fallback, not an ordinary shell-based substitute for delegation.`;

export const T3_CODE_BROWSER_TOOL_INSTRUCTIONS = `

## T3 Code collaborative browser

You are running inside T3 Code. The \`t3-code\` MCP server is the product-native collaborative browser shared with the user. When it exposes \`preview_*\` tools, prefer those tools for browser navigation, inspection, interaction, screenshots, and recordings.

For browser work, first call \`preview_status\`. If no automation-capable preview is attached, call \`preview_open\` before concluding that the browser is unavailable. Then use \`preview_navigate\`, \`preview_snapshot\`, and the focused interaction tools. Prefer snapshot-provided locators over coordinates.

Do not switch to global browser skills, Chrome, Node REPL browser automation, standalone Playwright, or agent-browser merely because the preview is initially closed or a first call fails. Use an alternative browser system only when the T3 preview tools are absent, the user explicitly requests another browser, or \`preview_open\` returns an explicit unsupported/unavailable error. A failed T3 preview tool call should be inspected and retried with corrected arguments when the error is actionable.
`;

const T3_CODE_ACP_DEFAULT_MODE_INSTRUCTIONS = `## T3 Code interaction mode: Default

Prefer making reasonable assumptions and carrying out the user's request. Ask a concise question only when a missing user decision would materially change the result. Treat this mode as active until T3 Code supplies a different interaction-mode instruction.`;

const T3_CODE_ACP_PLAN_MODE_INSTRUCTIONS = `## T3 Code interaction mode: Plan

Investigate with read-only actions and do not edit files or otherwise execute the implementation. Resolve discoverable facts before asking questions. When the requirements are decision complete, return a concrete implementation plan and do not start implementing it. Treat this mode as active until T3 Code supplies a different interaction-mode instruction.`;

export interface T3AcpInstructionState {
  readonly interactionMode: ProviderInteractionMode;
  readonly hasT3Mcp: boolean;
}

/**
 * ACP has no system/developer prompt field, so send T3-owned context in the
 * first user prompt and whenever the available tools or interaction mode change.
 */
export function t3AcpPromptWithInstructions(input: {
  readonly prompt: string;
  readonly state: T3AcpInstructionState;
  readonly previousState?: T3AcpInstructionState;
}): string {
  // Native slash commands must remain at the start of the prompt.
  if (input.prompt.trimStart().startsWith("/")) return input.prompt;
  if (
    input.previousState?.interactionMode === input.state.interactionMode &&
    input.previousState.hasT3Mcp === input.state.hasT3Mcp
  ) {
    return input.prompt;
  }
  const instructions = [
    input.state.interactionMode === "plan"
      ? T3_CODE_ACP_PLAN_MODE_INSTRUCTIONS
      : T3_CODE_ACP_DEFAULT_MODE_INSTRUCTIONS,
    ...(input.state.hasT3Mcp
      ? [
          T3_CODE_BROWSER_TOOL_INSTRUCTIONS.trim(),
          T3_CODE_ORCHESTRATION_INSTRUCTIONS.trim(),
          T3_CODE_ACP_MCP_FALLBACK_INSTRUCTIONS,
        ]
      : []),
  ];
  return `<t3_code_instructions>\n${instructions.join("\n\n")}\n</t3_code_instructions>\n\n<user_request>\n${input.prompt}\n</user_request>`;
}

/**
 * Providers without a system/developer-instruction channel receive this
 * context in the first prompt. Keep the wrapper explicit so it cannot be
 * mistaken for text authored by the user.
 */
function prependT3OrchestrationInstructions(prompt: string): string {
  return `<t3_code_orchestration_instructions>${T3_CODE_ORCHESTRATION_INSTRUCTIONS.trim()}</t3_code_orchestration_instructions>\n\n<user_request>\n${prompt}\n</user_request>`;
}

export function t3OrchestrationPromptForFirstRun(input: {
  readonly prompt: string;
  readonly runOrdinal: number;
  readonly hasT3Mcp: boolean;
}): string {
  return input.runOrdinal === 1 && input.hasT3Mcp
    ? prependT3OrchestrationInstructions(input.prompt)
    : input.prompt;
}

export function t3OrchestrationSystemPrompt(hasT3Mcp: boolean): string | undefined {
  return hasT3Mcp ? T3_CODE_ORCHESTRATION_INSTRUCTIONS : undefined;
}

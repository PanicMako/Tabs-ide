import { describe, expect, it } from "vitest";

import {
  appendTerminalContextsToPrompt,
  materializeInlineTerminalContextPrompt,
} from "~/lib/terminalContext";
import {
  ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
  buildComposerPromptHistoryEntries,
  PLAN_IMPLEMENTATION_PROMPT_PREFIX,
  recallableComposerPrompt,
  stepComposerPromptHistory,
  type ComposerPromptHistoryPosition,
} from "./composerPromptHistory";

const entries = buildComposerPromptHistoryEntries([
  { id: "m1", role: "user", text: "first" },
  { id: "a1", role: "assistant", text: "reply" },
  { id: "m2", role: "user", text: "second" },
  { id: "m3", role: "user", text: "third" },
]);

function backward(position: ComposerPromptHistoryPosition | null, currentPrompt: string) {
  return stepComposerPromptHistory({ direction: "backward", entries, position, currentPrompt });
}

function forward(position: ComposerPromptHistoryPosition | null, currentPrompt: string) {
  return stepComposerPromptHistory({ direction: "forward", entries, position, currentPrompt });
}

describe("recallableComposerPrompt", () => {
  it("strips send-time context blocks and the ultrathink prefix", () => {
    const withTerminal = appendTerminalContextsToPrompt("Investigate this", [
      {
        terminalId: "default",
        terminalLabel: "Terminal 1",
        lineStart: 12,
        lineEnd: 13,
        text: "git status\nOn branch main",
      },
    ]);
    const withElement = `${withTerminal}\n\n<element_context>\nPage: Example\n<button>Save</button>\n</element_context>`;
    expect(recallableComposerPrompt(`Ultrathink:\n${withElement}`)).toBe("Investigate this");
  });

  it("removes inline terminal labels along with their trailing block", () => {
    const context = {
      terminalId: "default",
      terminalLabel: "Terminal 1",
      lineStart: 12,
      lineEnd: 13,
      text: "git status",
    };
    const typed = materializeInlineTerminalContextPrompt("Look at \uFFFC please", [context]);
    expect(typed).toBe("Look at @terminal-1:12-13 please");
    const sent = appendTerminalContextsToPrompt(typed, [context]);
    expect(recallableComposerPrompt(sent)).toBe("Look at please");
  });

  it("removes one label per chip and leaves other whitespace alone", () => {
    const context = {
      terminalId: "default",
      terminalLabel: "Terminal 1",
      lineStart: 4,
      lineEnd: 4,
      text: "ls",
    };
    const typed = "@terminal-1:4 typed twice: @terminal-1:4\n    indented  code";
    const sent = appendTerminalContextsToPrompt(typed, [context]);
    expect(recallableComposerPrompt(sent)).toBe("typed twice: @terminal-1:4\n    indented  code");
  });

  it("does not strip a typed label that only starts with the chip label", () => {
    const context = {
      terminalId: "default",
      terminalLabel: "Terminal 1",
      lineStart: 4,
      lineEnd: 4,
      text: "ls",
    };
    const typed = "see @terminal-1:40 and @terminal-1:4-12 then @terminal-1:4";
    const sent = appendTerminalContextsToPrompt(typed, [context]);
    expect(recallableComposerPrompt(sent)).toBe("see @terminal-1:40 and @terminal-1:4-12 then");
  });

  it("strips only the review comments appended at the end", () => {
    const comment =
      '<review_comment path="src/app.ts">\nKeep this configurable.\n</review_comment>';
    const sent = `Please update this.\n\n${comment}`;
    expect(recallableComposerPrompt(sent)).toBe("Please update this.");
    const midPrompt = `Before\n\n${comment}\n\nAfter`;
    expect(recallableComposerPrompt(midPrompt)).toBe(midPrompt);
    const both = `${midPrompt}\n\n${comment}`;
    expect(recallableComposerPrompt(both)).toBe(midPrompt);
  });

  it("drops synthetic bootstrap and plan implementation prompts", () => {
    expect(recallableComposerPrompt(ATTACHMENT_ONLY_BOOTSTRAP_PROMPT)).toBe("");
    expect(
      recallableComposerPrompt(`${PLAN_IMPLEMENTATION_PROMPT_PREFIX}# Plan\n1. Step one`),
    ).toBe("");
  });
});

describe("buildComposerPromptHistoryEntries", () => {
  it("drops assistant messages and empty prompts", () => {
    const result = buildComposerPromptHistoryEntries([
      { id: "m1", role: "assistant", text: "hello" },
      { id: "m2", role: "user", text: "first" },
      { id: "m3", role: "user", text: "   " },
      { id: "m4", role: "user", text: ATTACHMENT_ONLY_BOOTSTRAP_PROMPT },
      { id: "m5", role: "user", text: "second" },
    ]);
    expect(result).toEqual([
      { id: "m2", prompt: "first" },
      { id: "m5", prompt: "second" },
    ]);
  });

  it("collapses consecutive duplicate prompts to the newest id", () => {
    const result = buildComposerPromptHistoryEntries([
      { id: "m1", role: "user", text: "same" },
      { id: "m2", role: "assistant", text: "reply" },
      { id: "m3", role: "user", text: "same" },
      { id: "m4", role: "user", text: "different" },
      { id: "m5", role: "user", text: "same" },
    ]);
    expect(result).toEqual([
      { id: "m3", prompt: "same" },
      { id: "m4", prompt: "different" },
      { id: "m5", prompt: "same" },
    ]);
  });
});

describe("stepComposerPromptHistory", () => {
  it("walks backward through entries and stops at the oldest", () => {
    const step1 = backward(null, "");
    expect(step1).toEqual({ position: { entryId: "m3", recalled: "third" }, prompt: "third" });

    const step2 = backward(step1?.position ?? null, "third");
    expect(step2).toEqual({ position: { entryId: "m2", recalled: "second" }, prompt: "second" });

    const step3 = backward(step2?.position ?? null, "second");
    expect(step3).toEqual({ position: { entryId: "m1", recalled: "first" }, prompt: "first" });

    expect(backward(step3?.position ?? null, "first")).toBeNull();
  });

  it("walks forward and empties the composer past the newest entry", () => {
    const atFirst: ComposerPromptHistoryPosition = { entryId: "m1", recalled: "first" };

    const step1 = forward(atFirst, "first");
    expect(step1).toEqual({ position: { entryId: "m2", recalled: "second" }, prompt: "second" });

    const step2 = forward(step1?.position ?? null, "second");
    expect(step2).toEqual({ position: { entryId: "m3", recalled: "third" }, prompt: "third" });

    const step3 = forward(step2?.position ?? null, "third");
    expect(step3).toEqual({ position: null, prompt: "" });

    expect(forward(null, "")).toBeNull();
  });

  it("refuses to walk backward when the user has typed text without browsing", () => {
    expect(backward(null, "some draft the user typed")).toBeNull();
  });

  it("resets browsing if the recalled text was edited", () => {
    const position: ComposerPromptHistoryPosition = { entryId: "m2", recalled: "second" };
    expect(backward(position, "second but edited")).toBeNull();
    expect(forward(position, "second but edited")).toBeNull();
  });
});

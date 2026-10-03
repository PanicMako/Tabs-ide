import { EnvironmentId, MessageId, ThreadId, type AssistantCitation } from "@tabs/contracts";
import { serializeAssistantCitation } from "@tabs/shared/assistantCitations";
import { describe, expect, it } from "vitest";

import {
  selectionTouchesMentionBoundary,
  splitPastedPromptIntoComposerSegments,
  splitPromptIntoComposerSegments,
} from "./composer-editor-mentions";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "./lib/terminalContext";

const citation: AssistantCitation = {
  version: 1,
  environmentId: EnvironmentId.make("remote/環境"),
  threadId: ThreadId.make("thread-1"),
  messageId: MessageId.make("message-1"),
  text: 'Use @AGENTS.md, $review and "雪 ❄️" (carefully).',
  start: 4,
  end: 50,
  prefix: "前: ",
  suffix: " 後",
};

describe("splitPromptIntoComposerSegments", () => {
  it("splits mention tokens followed by whitespace into mention segments", () => {
    expect(splitPromptIntoComposerSegments("Inspect @AGENTS.md please")).toEqual([
      { type: "text", text: "Inspect " },
      { type: "mention", path: "AGENTS.md", source: "@AGENTS.md" },
      { type: "text", text: " please" },
    ]);
  });

  it("does not convert an incomplete trailing mention token", () => {
    expect(splitPromptIntoComposerSegments("Inspect @AGENTS.md")).toEqual([
      { type: "text", text: "Inspect @AGENTS.md" },
    ]);
  });

  it("keeps newlines around mention tokens", () => {
    expect(splitPromptIntoComposerSegments("one\n@AGENTS.md \ntwo")).toEqual([
      { type: "text", text: "one\n" },
      { type: "mention", path: "AGENTS.md", source: "@AGENTS.md" },
      { type: "text", text: " \ntwo" },
    ]);
  });

  it("splits quoted mention tokens containing whitespace", () => {
    expect(splitPromptIntoComposerSegments('Inspect @"My File.md" please')).toEqual([
      { type: "text", text: "Inspect " },
      { type: "mention", path: "My File.md", source: '@"My File.md"' },
      { type: "text", text: " please" },
    ]);
  });

  it("unescapes quoted mention token content", () => {
    expect(splitPromptIntoComposerSegments('Inspect @"docs/My \\"File\\".md" please')).toEqual([
      { type: "text", text: "Inspect " },
      {
        type: "mention",
        path: 'docs/My "File".md',
        source: '@"docs/My \\"File\\".md"',
      },
      { type: "text", text: " please" },
    ]);
  });

  it("splits generated markdown file links into mention segments", () => {
    expect(
      splitPromptIntoComposerSegments(
        "Inspect [package.json](path/to/package.json) before continuing",
      ),
    ).toEqual([
      { type: "text", text: "Inspect " },
      {
        type: "mention",
        path: "path/to/package.json",
        source: "[package.json](path/to/package.json)",
      },
      { type: "text", text: " before continuing" },
    ]);
  });

  it("does not turn normal web links into file mention segments", () => {
    expect(
      splitPromptIntoComposerSegments("Read [the docs](https://example.com/docs) first"),
    ).toEqual([{ type: "text", text: "Read [the docs](https://example.com/docs) first" }]);
  });

  it("keeps multiple assistant citations atomic next to punctuation and Unicode", () => {
    const source = serializeAssistantCitation(citation);
    const otherCitation = {
      ...citation,
      messageId: MessageId.make("message-2"),
      text: "A second quote",
    };
    const otherSource = serializeAssistantCitation(otherCitation);

    expect(splitPromptIntoComposerSegments(`前(${source}),${otherSource}後`)).toEqual([
      { type: "text", text: "前(" },
      { type: "citation", citation, source },
      { type: "text", text: ")," },
      { type: "citation", citation: otherCitation, source: otherSource },
      { type: "text", text: "後" },
    ]);
  });

  it("preserves exact citation source encoding for adjacent chips at the end of a prompt", () => {
    const source = serializeAssistantCitation(citation).replaceAll("+", "%20");

    expect(splitPromptIntoComposerSegments(`${source}${source}`)).toEqual([
      { type: "citation", citation, source },
      { type: "citation", citation, source },
    ]);
  });

  it.each(["@", "@AGENTS.md"])(
    "keeps a citation after the unfinished mention %s intact",
    (prefix) => {
      const source = serializeAssistantCitation(citation);

      expect(splitPromptIntoComposerSegments(`${prefix}${source}`)).toEqual([
        { type: "text", text: prefix },
        { type: "citation", citation, source },
      ]);
    },
  );

  it("parses citations alongside file mentions, skills, and terminal contexts", () => {
    const source = serializeAssistantCitation(citation);

    expect(
      splitPromptIntoComposerSegments(
        `@AGENTS.md ${source}\n$review ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}${source}`,
      ),
    ).toEqual([
      { type: "mention", path: "AGENTS.md", source: "@AGENTS.md" },
      { type: "text", text: " " },
      { type: "citation", citation, source },
      { type: "text", text: "\n" },
      { type: "skill", name: "review" },
      { type: "text", text: " " },
      { type: "terminal-context", context: null },
      { type: "citation", citation, source },
    ]);
  });

  it("keeps malformed citation links as editable text", () => {
    const prompt = "[Assistant quote](tabs-citation://v1/env/thread/message?text=missing+metadata)";

    expect(splitPromptIntoComposerSegments(prompt)).toEqual([{ type: "text", text: prompt }]);
  });

  it.each(["@expo/ui", "@jane/foo.js", "@scope/pkg/sub/path"])(
    "does not turn scoped package reference %s into file mention segments",
    (reference) => {
      const prompt = `Install ${reference} next`;
      expect(splitPromptIntoComposerSegments(prompt)).toEqual([{ type: "text", text: prompt }]);
    },
  );

  it("keeps IME-composed text containing a scoped package reference as text", () => {
    const prompt = "入力 @expo/ui　を追加";
    expect(splitPromptIntoComposerSegments(prompt)).toEqual([{ type: "text", text: prompt }]);
  });

  it("keeps inline terminal context placeholders at their prompt positions", () => {
    expect(
      splitPromptIntoComposerSegments(
        `Inspect ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}@AGENTS.md please`,
      ),
    ).toEqual([
      { type: "text", text: "Inspect " },
      { type: "terminal-context", context: null },
      { type: "mention", path: "AGENTS.md", source: "@AGENTS.md" },
      { type: "text", text: " please" },
    ]);
  });
});

describe("selectionTouchesMentionBoundary", () => {
  it("detects when selection range touches whitespace bounding a mention", () => {
    const prompt = "Please check @AGENTS.md for details";
    const mentionStart = prompt.indexOf("@AGENTS.md");
    const mentionEnd = mentionStart + "@AGENTS.md".length;

    expect(selectionTouchesMentionBoundary(prompt, mentionStart - 1, mentionStart)).toBe(true);
    expect(selectionTouchesMentionBoundary(prompt, mentionEnd, mentionEnd + 1)).toBe(true);
    expect(selectionTouchesMentionBoundary(prompt, 0, 4)).toBe(false);
  });
});

describe("splitPastedPromptIntoComposerSegments", () => {
  it("recognizes a mention at the end of pasted text", () => {
    expect(splitPastedPromptIntoComposerSegments("Review @AGENTS.md")).toEqual([
      { type: "text", text: "Review " },
      { type: "mention", path: "AGENTS.md", source: "@AGENTS.md" },
    ]);
  });

  it("keeps ordinary pasted text unchanged", () => {
    expect(splitPastedPromptIntoComposerSegments("hello\nworld")).toEqual([
      { type: "text", text: "hello\nworld" },
    ]);
  });
});

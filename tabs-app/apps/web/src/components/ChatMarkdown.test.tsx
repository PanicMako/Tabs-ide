import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChatMarkdown from "./ChatMarkdown";

describe("ChatMarkdown Features", () => {
  describe("GitHub Alert Callouts", () => {
    it("renders [!NOTE] as a styled note callout", () => {
      const html = renderToStaticMarkup(
        <ChatMarkdown
          text={"> [!NOTE]\n> Here is important background information."}
          cwd={undefined}
        />,
      );
      expect(html).toContain('role="note"');
      expect(html).toContain("border-blue-500/70");
      expect(html).toContain("Note");
      expect(html).toContain("Here is important background information.");
    });

    it("renders [!TIP] as a styled tip callout", () => {
      const html = renderToStaticMarkup(
        <ChatMarkdown text={"> [!TIP]\n> Use this shortcut to speed up."} cwd={undefined} />,
      );
      expect(html).toContain('role="note"');
      expect(html).toContain("border-emerald-500/70");
      expect(html).toContain("Tip");
    });

    it("renders [!IMPORTANT] as a styled important callout", () => {
      const html = renderToStaticMarkup(
        <ChatMarkdown text={"> [!IMPORTANT]\n> Crucial information here."} cwd={undefined} />,
      );
      expect(html).toContain('role="note"');
      expect(html).toContain("border-purple-500/70");
      expect(html).toContain("Important");
    });

    it("renders [!WARNING] as a styled warning callout", () => {
      const html = renderToStaticMarkup(
        <ChatMarkdown text={"> [!WARNING]\n> Proceed with caution."} cwd={undefined} />,
      );
      expect(html).toContain('role="note"');
      expect(html).toContain("border-amber-500/70");
      expect(html).toContain("Warning");
    });

    it("renders [!CAUTION] as a styled caution callout", () => {
      const html = renderToStaticMarkup(
        <ChatMarkdown text={"> [!CAUTION]\n> Danger ahead."} cwd={undefined} />,
      );
      expect(html).toContain('role="note"');
      expect(html).toContain("border-red-500/70");
      expect(html).toContain("Caution");
    });

    it("renders normal blockquote without alert callout formatting", () => {
      const html = renderToStaticMarkup(
        <ChatMarkdown text={"> Just a regular quote from someone."} cwd={undefined} />,
      );
      expect(html).toContain("<blockquote>");
      expect(html).not.toContain('role="note"');
      expect(html).toContain("Just a regular quote from someone.");
    });
  });

  describe("Code Block Toggles & Header", () => {
    it("renders header toolbar with language, wrap toggle, maximize toggle, and copy button", () => {
      const codeMarkdown = "```typescript\nconst message = 'hello world';\n```";
      const html = renderToStaticMarkup(<ChatMarkdown text={codeMarkdown} cwd={undefined} />);

      expect(html).toContain('class="chat-markdown-codeblock"');
      expect(html).toContain('data-language="typescript"');
      expect(html).toContain('class="chat-markdown-codeblock-header select-none"');
      expect(html).toContain("typescript");
      expect(html).toContain('aria-label="Wrap lines"');
      expect(html).toContain('aria-label="Maximize code block"');
      expect(html).toContain('aria-label="Copy code"');
    });
  });
});

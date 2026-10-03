import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageCopyButton } from "./MessageCopyButton";

describe("MessageCopyButton accessibility & touch polish", () => {
  it("renders with accessible aria-label and type='button'", () => {
    const markup = renderToStaticMarkup(<MessageCopyButton text="Test message text" />);

    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-label="Copy message to clipboard"');
    expect(markup).toContain("lucide-copy");
  });

  it("supports custom label in accessible aria-label", () => {
    const markup = renderToStaticMarkup(
      <MessageCopyButton text="git status" label="Copy command" />,
    );

    expect(markup).toContain('aria-label="Copy command to clipboard"');
  });

  it("includes coarse-pointer touch target expansion and focus-visible rings", () => {
    const markup = renderToStaticMarkup(
      <MessageCopyButton text="Exported code" variant="ghost" size="icon-xs" />,
    );

    expect(markup).toContain("pointer-coarse:after:min-h-11");
    expect(markup).toContain("pointer-coarse:after:min-w-11");
    expect(markup).toContain("focus-visible:ring-2");
    expect(markup).toContain("motion-reduce:transition-none");
  });
});

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentId } from "@tabs/contracts";
import { ComposerStashBadge } from "./ComposerStashBadge";
import { ComposerStashMenu } from "./ComposerStashMenu";
import type { PromptStashEntry } from "~/promptStashStore";

describe("ComposerStashBadge", () => {
  it("renders nothing when count is 0", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashBadge count={0} menuOpen={false} onToggleMenu={() => {}} />,
    );
    expect(markup).toBe("");
  });

  it("renders stash count and accessible aria-label", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashBadge count={3} menuOpen={false} onToggleMenu={() => {}} />,
    );
    expect(markup).toContain('aria-label="Stashed prompts: 3. Open stash."');
    expect(markup).toContain('data-prompt-stash-badge="true"');
    expect(markup).toContain("3");
    expect(markup).toContain("Stash");
  });

  it("reflects menuOpen and pulsing state in styles and aria-expanded", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashBadge count={5} menuOpen={true} pulsing={true} onToggleMenu={() => {}} />,
    );
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("animate-pulse");
  });
});

describe("ComposerStashMenu", () => {
  const sampleEntries: PromptStashEntry[] = [
    {
      id: "entry-1",
      createdAt: "2026-09-10T12:00:00.000Z",
      prompt: "First stashed prompt",
      attachments: [],
    },
    {
      id: "entry-2",
      createdAt: "2026-09-10T12:05:00.000Z",
      prompt: "Second stashed prompt with extra details",
      attachments: [
        {
          id: "att-1",
          name: "screenshot.png",
          mimeType: "image/png",
          sizeBytes: 1024,
          dataUrl: "data:image/png;base64,123",
        },
      ],
      environmentId: EnvironmentId.make("remote-env"),
    },
  ];

  it("renders nothing when isOpen is false", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashMenu
        entries={sampleEntries}
        isOpen={false}
        onRestore={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />,
    );
    expect(markup).toBe("");
  });

  it("renders dialog with header, entries, and restore buttons when open", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashMenu
        entries={sampleEntries}
        isOpen={true}
        currentEnvironmentId={EnvironmentId.make("local")}
        onRestore={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-label="Stashed Prompts"');
    expect(markup).toContain("Stashed Prompts");
    expect(markup).toContain("First stashed prompt");
    expect(markup).toContain("Second stashed prompt with extra details");
    expect(markup).toContain('data-stash-restore="entry-1"');
    expect(markup).toContain('data-stash-delete="true"');
    expect(markup).toContain("remote-env");
    expect(markup).toContain("1 image");
  });

  it("renders empty state when entries list is empty", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashMenu
        entries={[]}
        isOpen={true}
        stashShortcutLabel="⌘S"
        onRestore={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain("Nothing stashed yet.");
    expect(markup).toContain("⌘S");
  });
});

import { describe, expect, it } from "vitest";
import { DOC_TOPICS, type DocCategory } from "./DocumentationSettings";

describe("DocumentationSettings topics and categorization", () => {
  it("defines comprehensive documentation topics with required fields", () => {
    expect(DOC_TOPICS.length).toBeGreaterThanOrEqual(7);

    for (const topic of DOC_TOPICS) {
      expect(topic.id).toBeDefined();
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.summary.length).toBeGreaterThan(0);
      expect(topic.details.length).toBeGreaterThan(0);
      expect(topic.highlights.length).toBeGreaterThan(0);
      expect(topic.icon).toBeDefined();
      expect(topic.category).toBeDefined();
    }
  });

  it("covers key product categories", () => {
    const categories = new Set<DocCategory>(DOC_TOPICS.map((t) => t.category));
    expect(categories.has("agents")).toBe(true);
    expect(categories.has("environments")).toBe(true);
    expect(categories.has("browser")).toBe(true);
    expect(categories.has("git")).toBe(true);
    expect(categories.has("diagnostics")).toBe(true);
    expect(categories.has("shortcuts")).toBe(true);
  });

  it("filters topics correctly by search query", () => {
    const needle = "worktree";
    const filtered = DOC_TOPICS.filter((topic) =>
      `${topic.title} ${topic.summary} ${topic.details} ${topic.highlights.join(" ")}`
        .toLowerCase()
        .includes(needle),
    );

    expect(filtered.length).toBeGreaterThanOrEqual(1);
    expect(filtered.some((t) => t.id === "composer-agents")).toBe(true);
  });

  it("has keyboard shortcuts for shortcut topic", () => {
    const shortcutTopic = DOC_TOPICS.find((t) => t.id === "keyboard-shortcuts");
    expect(shortcutTopic).toBeDefined();
    expect(shortcutTopic?.shortcuts).toBeDefined();
    expect(shortcutTopic?.shortcuts?.length).toBeGreaterThan(0);

    const commandPalette = shortcutTopic?.shortcuts?.find((s) => s.label === "Command Palette");
    expect(commandPalette).toBeDefined();
    expect(commandPalette?.keys).toContain("⌘");
    expect(commandPalette?.keys).toContain("K");
  });
});

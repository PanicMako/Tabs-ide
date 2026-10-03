import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComposerCommandMenu } from "./ComposerCommandMenu";

describe("ComposerCommandMenu", () => {
  it("renders every matching skill in a scrollable command surface", () => {
    const markup = renderToStaticMarkup(
      <ComposerCommandMenu
        items={[
          {
            id: "skill:codex:azure-pipelines",
            type: "skill",
            skill: {
              name: "azure-pipelines",
              path: "/repo/.codex/skills/azure-pipelines/SKILL.md",
              scope: "repo",
              enabled: true,
            },
            label: "/skill:azure-pipelines",
            description: "Validate Azure DevOps pipeline changes for the VS Code build.",
          },
          {
            id: "skill:codex:browser",
            type: "skill",
            skill: {
              name: "browser",
              path: "/repo/.codex/skills/browser/SKILL.md",
              scope: "repo",
              enabled: true,
            },
            label: "/skill:browser",
            description: "Open and inspect the integrated browser.",
          },
        ]}
        resolvedTheme="dark"
        isLoading={false}
        triggerKind="slash-command"
        activeItemId="skill:codex:browser"
        onHighlightedItemChange={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain('data-composer-command-menu="true"');
    expect(markup).toContain('data-composer-item-id="skill:codex:azure-pipelines"');
    expect(markup).toContain('data-composer-item-id="skill:codex:browser"');
    expect(markup).toContain("max-h-[min(22rem,45vh)]");
    expect(markup).toContain("overflow-y-auto");
    expect(markup).toContain("Validate Azure DevOps pipeline changes");
    expect(markup).toContain("/skill:");
    expect(markup).toContain("Repo");
  });

  it("renders app plugin badge and skill suffix when triggered with dollar", () => {
    const markup = renderToStaticMarkup(
      <ComposerCommandMenu
        items={[
          {
            id: "skill:claudeAgent:custom-plugin",
            type: "skill",
            skill: {
              name: "custom-plugin",
              path: "/home/.agents/plugins/custom/SKILL.md",
              scope: "user",
              enabled: true,
            },
            label: "$Custom Plugin",
            description: "Custom plugin skill",
          },
        ]}
        resolvedTheme="light"
        isLoading={false}
        triggerKind="skill"
        activeItemId="skill:claudeAgent:custom-plugin"
        onHighlightedItemChange={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain("App");
    expect(markup).toContain("Skill");
    expect(markup).toContain("$Custom Plugin");
  });
});

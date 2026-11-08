import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppearanceStep } from "./PersonalizeSteps";

describe("AppearanceStep", () => {
  it("renders Enter Tabs button and secondary Add a project to get started CTA when onAddProject is passed", () => {
    const markup = renderToStaticMarkup(
      <AppearanceStep
        selected="dark"
        resolvedMode="dark"
        onSelect={vi.fn()}
        onBack={vi.fn()}
        onLaunch={vi.fn()}
        launching={false}
        onAddProject={vi.fn()}
      />,
    );

    expect(markup).toContain("Enter Tabs");
    expect(markup).toContain("Add a project to get started");
  });

  it("renders only Enter Tabs when onAddProject is omitted", () => {
    const markup = renderToStaticMarkup(
      <AppearanceStep
        selected="dark"
        resolvedMode="dark"
        onSelect={vi.fn()}
        onBack={vi.fn()}
        onLaunch={vi.fn()}
        launching={false}
      />,
    );

    expect(markup).toContain("Enter Tabs");
    expect(markup).not.toContain("Add a project to get started");
  });
});

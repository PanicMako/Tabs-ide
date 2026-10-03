import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/components/ui/button", () => ({
  Button: ({ children }: { readonly children?: ReactNode }) => <button>{children}</button>,
}));

vi.mock("~/components/ui/dialog", () => {
  const Container = ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Container,
    DialogDescription: Container,
    DialogFooter: Container,
    DialogHeader: Container,
    DialogPanel: Container,
    DialogPopup: Container,
    DialogTitle: Container,
  };
});

vi.mock("~/components/ui/input", () => ({ Input: () => <input /> }));
vi.mock("~/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("~/components/ui/toggle-group", () => ({
  Toggle: ({ children, value }: { readonly children?: ReactNode; readonly value: string }) => (
    <button data-value={value}>{children}</button>
  ),
  ToggleGroup: ({
    children,
    value,
  }: {
    readonly children?: ReactNode;
    readonly value: readonly string[];
  }) => <div data-current={value.join(",")}>{children}</div>,
}));

import { ProjectIconPickerDialog } from "./ProjectIconPickerDialog";

describe("ProjectIconPickerDialog", () => {
  it("shows icons first and selects them for an automatic project", () => {
    const markup = renderToStaticMarkup(
      <ProjectIconPickerDialog current={null} open onOpenChange={() => {}} onSelect={() => {}} />,
    );

    expect(markup).toContain('data-current="lucide"');
    expect(markup.indexOf(">Icons<")).toBeLessThan(markup.indexOf(">Emoji<"));
    expect(markup).toContain('aria-label="Icon color"');
  });
});

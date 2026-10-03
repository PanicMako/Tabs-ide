import { describe, expect, it } from "vitest";
import { buttonVariants } from "./button";
import { toggleVariants } from "./toggle";

describe("semantic control foregrounds", () => {
  it.each(["ghost", "outline", "link", "glass"] as const)("keeps %s actions neutral", (variant) => {
    const classes = buttonVariants({ variant });
    expect(classes).toContain("text-foreground");
    expect(classes).not.toMatch(/text-primary(?:\s|$)/);
  });
  it("pairs a filled primary surface with its foreground", () => {
    expect(buttonVariants({ variant: "default" })).toContain("bg-primary text-primary-foreground");
  });
  it("keeps toggles neutral and exposes focus and pressed state", () => {
    const classes = toggleVariants();
    expect(classes).toContain("text-foreground");
    expect(classes).toContain("focus-visible:ring-2");
    expect(classes).toContain("data-pressed:bg-input/64");
    expect(classes).not.toContain("text-accent-foreground");
  });
});

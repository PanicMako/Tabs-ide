import React, { useState } from "react";
import { describe, expect, it } from "vitest";
import { RenderErrorBoundary } from "./RenderErrorBoundary";

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Explosion in render!");
  }
  return <div data-testid="healthy">Healthy content</div>;
}

describe("RenderErrorBoundary", () => {
  it("renders healthy children without error", () => {
    const errorBoundary = new RenderErrorBoundary({
      children: "normal content",
      fallback: "error fallback",
    });
    expect(errorBoundary.render()).toBe("normal content");
  });

  it("returns fallback when in error state", () => {
    const errorBoundary = new RenderErrorBoundary({
      children: "normal content",
      fallback: "error fallback",
    });
    errorBoundary.state = { failed: true, resetKeys: undefined };
    expect(errorBoundary.render()).toBe("error fallback");
  });

  it("resets failed state when resetKeys change", () => {
    const state = { failed: true, resetKeys: ["key1"] };
    const nextProps = {
      children: "content",
      fallback: "fallback",
      resetKeys: ["key2"],
    };

    const derived = RenderErrorBoundary.getDerivedStateFromProps(nextProps, state);
    expect(derived).toEqual({ failed: false, resetKeys: ["key2"] });
  });

  it("does not reset failed state when resetKeys are unchanged", () => {
    const state = { failed: true, resetKeys: ["key1"] };
    const nextProps = {
      children: "content",
      fallback: "fallback",
      resetKeys: ["key1"],
    };

    const derived = RenderErrorBoundary.getDerivedStateFromProps(nextProps, state);
    expect(derived).toBeNull();
  });
});

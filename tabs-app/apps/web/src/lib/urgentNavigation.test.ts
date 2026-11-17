import { describe, expect, it, vi } from "vitest";
import {
  installUrgentNavigation,
  isUrgentNavigationActive,
  navigateUrgently,
} from "./urgentNavigation";

describe("urgent navigation", () => {
  it("keeps the router's transition for ordinary navigations", () => {
    const transitional = vi.fn((fn: () => void) => fn());
    const router = { startTransition: transitional };
    installUrgentNavigation(router);
    router.startTransition(() => {});
    expect(transitional).toHaveBeenCalledOnce();
  });

  it("commits immediately during an urgent navigation, even after the router reassigns", async () => {
    const first = vi.fn();
    const router = { startTransition: first as (fn: () => void) => void };
    installUrgentNavigation(router);
    const reassigned = vi.fn();
    router.startTransition = reassigned;
    const commit = vi.fn();
    await navigateUrgently(async () => {
      expect(isUrgentNavigationActive()).toBe(true);
      router.startTransition(commit);
    });
    expect(commit).toHaveBeenCalledOnce();
    expect(reassigned).not.toHaveBeenCalled();
    expect(isUrgentNavigationActive()).toBe(false);
    router.startTransition(() => {});
    expect(reassigned).toHaveBeenCalledOnce();
  });
});

import "../../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { LoadBalancingSettings } from "./LoadBalancingSettings";

const fixture = vi.hoisted(() => ({
  update: vi.fn(async (_patch: unknown) => true),
  enabled: true,
  ids: ["local", "remote"] as string[],
}));
vi.mock("~/hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/hooks/useSettings")>()),
  useSettings: (select: (settings: unknown) => unknown) =>
    select({ loadBalancingEnabled: fixture.enabled, loadBalancingWeights: { remote: 20 } }),
  useUpdateSettings: () => ({ updateSettings: fixture.update }),
}));
vi.mock("~/connection/environmentApiRegistry", () => ({
  connectedEnvironmentIds: () => fixture.ids,
  environmentConfig: (id: string) => ({
    environment: { label: id === "local" ? "This Mac" : "Mac mini" },
  }),
  onEnvironmentApiRegistryEvent: () => () => {},
}));

it("shows a weight per machine and saves a change", async () => {
  fixture.enabled = true;
  const view = await render(<LoadBalancingSettings />);
  try {
    await expect
      .element(page.getByRole("spinbutton", { name: "Weight for This Mac" }))
      .toHaveValue(50);
    const remote = page.getByRole("spinbutton", { name: "Weight for Mac mini" });
    await expect.element(remote).toHaveValue(20);
    await remote.fill("70");
    await vi.waitFor(() =>
      expect(fixture.update).toHaveBeenLastCalledWith({
        loadBalancingWeights: { remote: 70 },
      }),
    );
  } finally {
    await view.unmount();
  }
});

it("shows nothing when there is only one machine", async () => {
  fixture.ids = ["local"];
  const view = await render(<LoadBalancingSettings />);
  try {
    expect(document.body.textContent).not.toContain("Spread new conversations");
  } finally {
    fixture.ids = ["local", "remote"];
    await view.unmount();
  }
});

import "../../index.css";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ObservabilityExportSettings } from "./ObservabilityExportSettings";

const fixture = vi.hoisted(() => ({ update: vi.fn(async (_patch: unknown) => true) }));
vi.mock("~/hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/hooks/useSettings")>()),
  useSettings: (select: (settings: unknown) => unknown) =>
    select({ observability: { otlpTracesUrl: "http://localhost:4318/v1/traces" } }),
  useUpdateSettings: () => ({ updateSettings: fixture.update }),
}));

it("shows the saved endpoint, saves a good address and refuses a bad one", async () => {
  const view = await render(<ObservabilityExportSettings />);
  try {
    const traces = page.getByRole("textbox", { name: "Traces endpoint" });
    await expect.element(traces).toHaveValue("http://localhost:4318/v1/traces");

    const metrics = page.getByRole("textbox", { name: "Metrics endpoint" });
    await userEvent.type(metrics, "https://collector.test/v1/metrics");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() =>
      expect(fixture.update).toHaveBeenCalledWith({
        observability: { otlpMetricsUrl: "https://collector.test/v1/metrics" },
      }),
    );

    fixture.update.mockClear();
    const logs = page.getByRole("textbox", { name: "Logs endpoint" });
    await userEvent.type(logs, "localhost:4318");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText(/web address|http/)).toBeVisible();
    expect(fixture.update).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

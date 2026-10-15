import "../../index.css";
import { ProviderInstanceId, ProviderDriverKind, type ProviderInstallState } from "@tabs/contracts";
import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ProviderInstallProgress } from "./ProviderInstallProgress";

const stream = vi.hoisted(() => ({
  receive: null as ((state: ProviderInstallState) => void) | null,
  stop: vi.fn(),
}));
vi.mock("~/wsNativeApi", () => ({
  createWsNativeApi: vi.fn(),
  getWsTransport: () => ({
    subscribeRpc: (
      _method: string,
      _input: unknown,
      _decode: unknown,
      receive: (state: ProviderInstallState) => void,
    ) => {
      stream.receive = receive;
      return stream.stop;
    },
  }),
}));
const base: ProviderInstallState = {
  driver: ProviderDriverKind.makeUnsafe("antigravity"),
  operationId: null,
  phase: "downloading",
  downloadedBytes: 25_000_000,
  totalBytes: 100_000_000,
  version: null,
  installedVersion: null,
  canRemove: false,
  message: null,
};
beforeEach(() => {
  stream.receive = null;
  stream.stop.mockClear();
});

test("restores download progress and shows verification and terminal failure", async () => {
  const active = vi.fn();
  const complete = vi.fn();
  const screen = await render(
    <ProviderInstallProgress
      instanceId={ProviderInstanceId.makeUnsafe("antigravity")}
      onActiveChange={active}
      onComplete={complete}
    />,
  );
  stream.receive?.(base);
  await expect.element(screen.getByText("Downloading Antigravity runtime · 25%")).toBeVisible();
  await expect.element(screen.getByText("25.0 MB of 100.0 MB")).toBeVisible();
  await expect.element(screen.getByRole("progressbar")).toHaveAttribute("value", "25000000");
  stream.receive?.({ ...base, phase: "verifying" });
  await expect.element(screen.getByText("Verifying Antigravity installation")).toBeVisible();
  stream.receive?.({ ...base, phase: "failed", message: "Runtime verification failed" });
  await expect.element(screen.getByText("Runtime verification failed")).toBeVisible();
  expect(active).toHaveBeenLastCalledWith(false);
  expect(complete).not.toHaveBeenCalled();
  await screen.unmount();
  expect(stream.stop).toHaveBeenCalledOnce();
});

test("uses indeterminate progress when size is unknown and refreshes once on success", async () => {
  const complete = vi.fn();
  const screen = await render(
    <ProviderInstallProgress
      instanceId={ProviderInstanceId.makeUnsafe("antigravity")}
      onActiveChange={vi.fn()}
      onComplete={complete}
    />,
  );
  stream.receive?.({ ...base, totalBytes: null });
  await expect.element(screen.getByRole("progressbar")).not.toHaveAttribute("value");
  stream.receive?.({ ...base, phase: "succeeded" });
  await expect.element(screen.getByText("Antigravity installed")).toBeVisible();
  stream.receive?.({ ...base, phase: "succeeded" });
  expect(complete).toHaveBeenCalledOnce();
});

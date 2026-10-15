import "../../index.css";
import { ProviderInstanceId, type ProviderAuthState } from "@tabs/contracts";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { AntigravityAccount } from "./AntigravityAccount";
const bridge = vi.hoisted(() => ({
  receive: null as ((value: ProviderAuthState) => void) | null,
  request: vi.fn(async () => ({})),
  external: vi.fn(async () => undefined),
}));
vi.mock("~/wsNativeApi", () => ({
  createWsNativeApi: vi.fn(),
  getWsTransport: () => ({
    request: bridge.request,
    subscribeRpc: (
      _method: string,
      _input: unknown,
      _decode: unknown,
      receive: (value: ProviderAuthState) => void,
    ) => {
      bridge.receive = receive;
      return () => undefined;
    },
  }),
}));
vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({ shell: { openExternal: bridge.external } }),
}));

test("offers sign-in for an unchecked account and refreshes models after account success", async () => {
  const instanceId = ProviderInstanceId.makeUnsafe("antigravity");
  const complete = vi.fn();
  const screen = await render(
    <AntigravityAccount instanceId={instanceId} authenticated={false} onComplete={complete} />,
  );
  await screen.getByRole("button", { name: "Connect Google account" }).click();
  expect(bridge.request).toHaveBeenCalledWith("provider.auth.start", { instanceId });
  const waiting: ProviderAuthState = {
    instanceId,
    phase: "waiting",
    flowId: "test-flow",
    authorizationUrl: "https://accounts.google.com/test",
    expiresAt: null,
    message: "Finish sign-in",
    interaction: null,
  };
  bridge.receive?.(waiting);
  await expect.element(screen.getByText("Waiting for Google sign-in…")).toBeVisible();
  await screen.getByRole("button", { name: "Open Google sign-in" }).click();
  expect(bridge.external).toHaveBeenCalledWith(waiting.authorizationUrl);
  bridge.receive?.({ ...waiting, phase: "succeeded", authorizationUrl: null });
  await expect
    .element(
      screen.getByText(
        "Google account connected. Available models are discovered from your account.",
      ),
    )
    .toBeVisible();
  expect(complete).toHaveBeenCalledOnce();
});

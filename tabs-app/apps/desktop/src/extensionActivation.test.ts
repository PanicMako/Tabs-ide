import { expect, it, vi } from "vitest";
import { ExpiredMetadataError } from "tuf-js/dist/error";
import { activateWithExchangeRefresh } from "./extensionActivation";

function fixture() {
  return {
    source: "exchange",
    revoked: false,
    activate: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    reportRefreshError: vi.fn(),
  };
}

it("opens an installed version while a registry request is still pending", async () => {
  const options = fixture();
  let finish!: () => void;
  options.refresh.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await activateWithExchangeRefresh(options);
  expect(options.activate).toHaveBeenCalledOnce();
  expect(options.refresh).toHaveBeenCalledOnce();
  finish();
});

it.each([
  new ExpiredMetadataError("Final timestamp.json is expired"),
  new TypeError("Registry is offline"),
])("keeps the installed approval when metadata cannot refresh: %s", async (error) => {
  const options = fixture();
  options.refresh.mockRejectedValue(error);
  await activateWithExchangeRefresh(options);
  await vi.waitFor(() => expect(options.reportRefreshError).toHaveBeenCalledWith(error));
  expect(options.activate).toHaveBeenCalledOnce();
});

it("keeps applying successful background status checks after local activation", async () => {
  const options = fixture();
  let finish!: () => void;
  const revokeInstalled = vi.fn();
  options.refresh.mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    revokeInstalled();
  });
  await activateWithExchangeRefresh(options);
  finish();
  await vi.waitFor(() => expect(revokeInstalled).toHaveBeenCalledOnce());
  expect(options.reportRefreshError).not.toHaveBeenCalled();
});

it("blocks a known revoked version before activation", async () => {
  const options = { ...fixture(), revoked: true };
  await expect(activateWithExchangeRefresh(options)).rejects.toThrow("revoked");
  expect(options.activate).not.toHaveBeenCalled();
  expect(options.refresh).not.toHaveBeenCalled();
});

it("does not consult the registry for a development extension", async () => {
  const options = { ...fixture(), source: "development" };
  await activateWithExchangeRefresh(options);
  expect(options.activate).toHaveBeenCalledOnce();
  expect(options.refresh).not.toHaveBeenCalled();
});

it("preserves activation failures and reports synchronous refresh failures separately", async () => {
  const options = fixture();
  const activationError = new Error("Extension disabled");
  const refreshError = new Error("Missing registry configuration");
  options.activate.mockRejectedValue(activationError);
  options.refresh.mockImplementation(() => {
    throw refreshError;
  });
  await expect(activateWithExchangeRefresh(options)).rejects.toBe(activationError);
  await vi.waitFor(() => expect(options.reportRefreshError).toHaveBeenCalledWith(refreshError));
});

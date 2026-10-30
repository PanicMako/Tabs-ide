import "../../index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { UserMessageImages } from "./UserMessageImages";
const api = vi.hoisted(() => ({ environment: vi.fn(), createUrl: vi.fn() }));
vi.mock("../../connection/environmentApiRegistry", () => ({
  environmentApi: async (id: string) => {
    api.environment(id);
    return { assets: { createUrl: api.createUrl } };
  },
}));
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3XcAAAAASUVORK5CYII=";
const image = {
  id: "stored-image",
  name: "Screenshot.png",
  mimeType: "image/png",
  previewUrl: "http://old-server/attachments/stored-image",
};

it("loads stored screenshots from their environment and expands the signed image", async () => {
  api.createUrl
    .mockReset()
    .mockResolvedValue({ relativeUrl: png, expiresAt: Date.now() + 3600000 });
  const onExpand = vi.fn();
  const client = new QueryClient();
  const view = await render(
    <QueryClientProvider client={client}>
      <UserMessageImages images={[image]} environmentId="remote-environment" onExpand={onExpand} />
    </QueryClientProvider>,
  );
  try {
    await expect
      .poll(() => view.container.querySelector<HTMLImageElement>("img")?.naturalWidth)
      .toBe(1);
    expect(api.environment).toHaveBeenCalledWith("remote-environment");
    expect(api.createUrl).toHaveBeenCalledWith({
      resource: {
        _tag: "attachment",
        attachmentId: image.id,
        fileName: image.name,
        mimeType: image.mimeType,
        disposition: "inline",
      },
    });
    await page.getByRole("button", { name: "Preview Screenshot.png" }).click();
    expect(onExpand.mock.calls[0]?.[0].images[0].src).toBe(png);
  } finally {
    await view.unmount();
    client.clear();
  }
});
it("keeps local previews without requesting an unpersisted attachment", async () => {
  api.createUrl.mockClear();
  const client = new QueryClient();
  const view = await render(
    <QueryClientProvider client={client}>
      <UserMessageImages images={[{ ...image, previewUrl: png }]} onExpand={vi.fn()} />
    </QueryClientProvider>,
  );
  try {
    await expect
      .poll(() => view.container.querySelector<HTMLImageElement>("img")?.naturalWidth)
      .toBe(1);
    expect(api.createUrl).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    client.clear();
  }
});
it("replaces broken images with a retry action that recovers", async () => {
  api.createUrl.mockReset().mockResolvedValue({
    relativeUrl: "data:image/png;base64,broken",
    expiresAt: Date.now() + 3600000,
  });
  const client = new QueryClient();
  const view = await render(
    <QueryClientProvider client={client}>
      <UserMessageImages images={[image]} onExpand={vi.fn()} />
    </QueryClientProvider>,
  );
  try {
    await expect.element(page.getByRole("button", { name: "Retry image" })).toBeVisible();
    expect(view.container.querySelector("img")).toBeNull();
    api.createUrl.mockResolvedValue({ relativeUrl: png, expiresAt: Date.now() + 3600000 });
    await page.getByRole("button", { name: "Retry image" }).click();
    await expect
      .poll(() => view.container.querySelector<HTMLImageElement>("img")?.naturalWidth)
      .toBe(1);
  } finally {
    await view.unmount();
    client.clear();
  }
});

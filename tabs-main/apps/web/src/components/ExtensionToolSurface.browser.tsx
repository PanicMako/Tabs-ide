import "../index.css";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { ExtensionToolSurface } from "./ExtensionToolSurface";

test("keeps extension identity visible outside its content area on unsupported clients", async () => {
  const screen = await render(
    <div style={{ width: 600, height: 400 }}>
      <ExtensionToolSurface
        input={{
          projectId: "project-a",
          extensionId: "acme.dashboard",
          toolId: "overview",
          profileId: "work",
        }}
        label="Overview"
        source="exchange"
        registryOrigin="https://exchange.example"
      />
    </div>,
  );
  const identity = screen.getByRole("banner", { name: "Extension identity" });
  const content = screen.getByRole("region", { name: "Overview extension content" });
  await expect.element(identity).toBeVisible();
  await expect.element(content).toBeVisible();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Extensions are available in Tabs desktop.");
  const header = document.querySelector<HTMLElement>('header[aria-label="Extension identity"]');
  const region = document.querySelector<HTMLElement>(
    '[role="region"][aria-label="Overview extension content"]',
  );
  expect(header).not.toBeNull();
  expect(region).not.toBeNull();
  expect(region!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    header!.getBoundingClientRect().bottom,
  );
});

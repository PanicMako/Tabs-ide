import "../index.css";
import "./settings/extensions-settings.css";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PublisherVerifiedBadge } from "./PublisherVerifiedBadge";

test("explains the publisher identity seal to assistive technology", async () => {
  await render(
    <div className="extensions-settings">
      <span>
        Example publisher <PublisherVerifiedBadge showLabel />
      </span>
    </div>,
  );
  await expect
    .element(page.getByRole("img", { name: "Publisher identity checked by Tabs" }))
    .toBeVisible();
  await expect.element(page.getByText("Verified publisher", { exact: true })).toBeVisible();
});

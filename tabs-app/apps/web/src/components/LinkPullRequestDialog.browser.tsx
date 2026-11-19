import "../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ThreadId } from "@tabs/contracts";
import { LinkPullRequestDialog } from "./LinkPullRequestDialog";
import { useLinkPullRequestStore } from "./linkPullRequestStore";

it("explains a link that is not a pull request without closing", async () => {
  useLinkPullRequestStore.setState({
    target: { threadId: "thread-1" as ThreadId, title: "Fix the sidebar" },
  });
  const view = await render(<LinkPullRequestDialog />);
  try {
    await expect.element(page.getByText("Link a pull request")).toBeVisible();
    await page.getByLabelText("Pull request link").fill("https://github.com/owner/repo");
    await page.getByRole("button", { name: "Link pull request" }).click();
    await expect.element(page.getByRole("alert")).toBeVisible();
    expect(useLinkPullRequestStore.getState().target).not.toBeNull();
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(useLinkPullRequestStore.getState().target).toBeNull();
  } finally {
    await view.unmount();
    useLinkPullRequestStore.setState({ target: null });
  }
});

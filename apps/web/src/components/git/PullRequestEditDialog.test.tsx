import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PullRequestEditForm, PullRequestEditDialog } from "./PullRequestEditDialog";

describe("PullRequestEditDialog & PullRequestEditForm", () => {
  it("renders edit form with title, write and preview controls", () => {
    const html = renderToStaticMarkup(
      <PullRequestEditForm
        prNumber={42}
        title="Feat: new cool feature"
        setTitle={() => {}}
        body="Here are the changes in markdown."
        setBody={() => {}}
        activeTab="write"
        setActiveTab={() => {}}
        onSave={async () => {}}
        onCancel={() => {}}
        isPending={false}
      />,
    );

    expect(html).toContain("Edit Pull Request #42");
    expect(html).toContain("Feat: new cool feature");
    expect(html).toContain("Here are the changes in markdown.");
    expect(html).toContain("Write");
    expect(html).toContain("Preview");
    expect(html).toContain("Save changes");
  });

  it("renders preview tab when activeTab is preview", () => {
    const html = renderToStaticMarkup(
      <PullRequestEditForm
        prNumber={42}
        title="Feat: new cool feature"
        setTitle={() => {}}
        body="Preview body text"
        setBody={() => {}}
        activeTab="preview"
        setActiveTab={() => {}}
        onSave={async () => {}}
        onCancel={() => {}}
        isPending={false}
      />,
    );

    expect(html).toContain("Preview body text");
  });

  it("PullRequestEditDialog returns null when closed", () => {
    const html = renderToStaticMarkup(
      <PullRequestEditDialog
        open={false}
        onOpenChange={() => {}}
        prNumber={42}
        initialTitle="Test"
        initialBody="Body"
        onSave={async () => {}}
        isPending={false}
      />,
    );
    expect(html).toBe("");
  });
});

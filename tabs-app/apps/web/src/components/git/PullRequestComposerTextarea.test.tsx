import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PullRequestComposerTextarea } from "./PullRequestComposerTextarea";

describe("PullRequestComposerTextarea", () => {
  it("renders an ordinary text box until a host completion is typed", () => {
    const html = renderToStaticMarkup(
      <PullRequestComposerTextarea
        id="note"
        value="see #1"
        onValueChange={() => {}}
        placeholder="Write a comment"
        support={{ mentions: true, referenceSigils: ["#"] }}
      />,
    );
    expect(html).toContain("<textarea");
    expect(html).toContain('placeholder="Write a comment"');
    expect(html).not.toContain('role="listbox"');
  });
});

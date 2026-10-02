import { reviewEvidence } from "../lib/reviewEvidence";

export function appendReviewEvidence(
  parent: HTMLElement,
  manifest: unknown,
  scan: unknown,
  digest: string,
) {
  for (const section of reviewEvidence(manifest, scan, digest)) {
    const container = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = section.title;
    const summary = document.createElement("p");
    summary.textContent = section.summary;
    container.append(heading, summary);
    if (section.items?.length) {
      const list = document.createElement("ul");
      for (const text of section.items) {
        const item = document.createElement("li");
        item.textContent = text;
        list.append(item);
      }
      container.append(list);
    }
    for (const preview of section.previews ?? []) {
      const details = document.createElement("details");
      const title = document.createElement("summary");
      title.textContent = preview.title;
      const text = document.createElement("pre");
      text.textContent = preview.text;
      details.append(title, text);
      container.append(details);
    }
    parent.append(container);
  }
}

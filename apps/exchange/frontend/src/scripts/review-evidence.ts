import { reviewEvidence } from "../lib/reviewEvidence";

export function appendReviewEvidence(
  parent: HTMLElement,
  manifest: unknown,
  scan: unknown,
  digest: string,
) {
  for (const section of reviewEvidence(manifest, scan, digest)) {
    const container = document.createElement("section");
    container.className = "review-evidence-section";
    const heading = document.createElement("h4");
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
      if (["Package changes", "Dependency advisory coverage"].includes(section.title)) {
        const disclosure = document.createElement("details");
        const label = document.createElement("summary");
        label.textContent =
          section.title === "Package changes" ? "See changed files" : "See dependency findings";
        disclosure.append(label, list);
        container.append(disclosure);
      } else container.append(list);
    }
    let previewParent: HTMLElement = container;
    if (section.previews?.length) {
      const group = document.createElement("details");
      const label = document.createElement("summary");
      label.textContent = `Browse ${section.previews.length} file previews`;
      group.append(label);
      container.append(group);
      previewParent = group;
    }
    for (const preview of section.previews ?? []) {
      const details = document.createElement("details");
      const title = document.createElement("summary");
      title.textContent = preview.title;
      const text = document.createElement("pre");
      text.textContent = preview.text;
      details.append(title, text);
      previewParent.append(details);
    }
    parent.append(container);
  }
}

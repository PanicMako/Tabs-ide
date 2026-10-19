import { publisherVerifiedBadge } from "./publisherVerifiedBadge";
import { extensionMarkPath, extensionMarkViewBox } from "./extensionMark";
import type { CatalogRelease } from "./catalogState";
import { inlineArrow } from "./inlineArrow";

function text(tag: string, value: string) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}
export function catalogCard(item: CatalogRelease): HTMLLIElement {
  const row = document.createElement("li");
  row.className = "card catalog-card";
  const identity = `${item.namespace}.${item.name}`;
  const icon = document.createElement("span");
  icon.className = "catalog-icon";
  const puzzle = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  puzzle.setAttribute("viewBox", extensionMarkViewBox);
  puzzle.setAttribute("width", "48");
  puzzle.setAttribute("height", "48");
  puzzle.setAttribute("fill", "currentColor");
  puzzle.setAttribute("focusable", "false");
  const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
  outline.setAttribute("d", extensionMarkPath);
  outline.setAttribute("fill-rule", "evenodd");
  puzzle.append(outline);
  icon.append(puzzle);
  icon.setAttribute("aria-hidden", "true");
  if (typeof item.manifest.listing?.icon === "string") {
    const image = document.createElement("img");
    image.alt = "";
    image.width = 48;
    image.height = 48;
    image.loading = "lazy";
    image.src = `/v1/extensions/${item.namespace}/${item.name}/versions/${encodeURIComponent(item.version)}/assets/icon`;
    image.addEventListener("error", () => image.remove(), { once: true });
    icon.append(image);
  }
  const heading = document.createElement("h2");
  const link = document.createElement("a");
  link.textContent = item.manifest.displayName;
  link.href = `/extensions/${item.namespace}/${item.name}`;
  heading.append(link);
  link.className = "catalog-card-link";
  link.append(inlineArrow());
  const description = text("p", item.manifest.description);
  description.className = "catalog-description";
  const publisher = text("div", identity);
  publisher.className = "catalog-publisher";
  const meta = document.createElement("div");
  meta.className = "catalog-meta";
  meta.append(text("span", `v${item.version}`));
  if (item.verified) {
    publisher.append(publisherVerifiedBadge());
  }
  const screenshots = item.manifest.listing?.screenshots;
  if (Array.isArray(screenshots) && screenshots.length > 0 && screenshots.length <= 6) {
    const first = screenshots[0];
    if (first && typeof first.alt === "string" && first.alt.length <= 300) {
      const preview = document.createElement("img");
      preview.className = "catalog-preview";
      preview.alt = first.alt;
      preview.loading = "lazy";
      preview.width = 640;
      preview.height = 360;
      preview.src = `/v1/extensions/${item.namespace}/${item.name}/versions/${encodeURIComponent(item.version)}/assets/screenshot/0`;
      preview.addEventListener("error", () => preview.remove(), { once: true });
      row.append(preview);
    }
  }
  row.append(icon, heading, description, publisher);
  const categories = item.manifest.listing?.categories;
  if (Array.isArray(categories)) {
    const labels = categories
      .filter(
        (value): value is string =>
          typeof value === "string" && /^[a-z][a-z0-9-]{1,39}$/.test(value),
      )
      .slice(0, 2);
    if (labels.length) {
      const tags = document.createElement("div");
      tags.className = "catalog-category-tags";
      tags.setAttribute("aria-label", "Publisher-supplied categories");
      for (const label of labels) tags.append(text("span", label));
      row.append(tags);
    }
  }
  row.append(meta);
  return row;
}

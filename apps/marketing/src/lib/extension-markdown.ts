import { renderReleaseMarkdown } from "./release-markdown";

export function isSafeExtensionLink(href: string): boolean {
  return /^(https?:|mailto:|#)/i.test(href);
}

export function isPackagedExtensionImage(source: string | null, path?: string): boolean {
  return Boolean(path && (source === path || source === `./${path}`));
}

/** Raw HTML remains escaped. Inert templates prevent unreviewed image loads. */
export function extensionMarkdown(
  markdown: string,
  packagedIconPath?: string,
  iconUrl?: string,
  firstHeadingLevel = 1,
): DocumentFragment {
  if (!Number.isInteger(firstHeadingLevel) || firstHeadingLevel < 1 || firstHeadingLevel > 6)
    throw new Error("Invalid README heading level.");
  const template = document.createElement("template");
  template.innerHTML = renderReleaseMarkdown(markdown);
  if (firstHeadingLevel > 1) {
    const headings = Array.from(template.content.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    const minimum = Math.min(...headings.map((heading) => Number(heading.tagName.slice(1))));
    for (const heading of headings) {
      const level = Math.min(6, Number(heading.tagName.slice(1)) + firstHeadingLevel - minimum);
      const replacement = document.createElement(`h${level}`);
      replacement.append(...Array.from(heading.childNodes));
      heading.replaceWith(replacement);
    }
  }
  for (const image of template.content.querySelectorAll("img")) {
    const source = image.getAttribute("src");
    if (packagedIconPath && iconUrl && isPackagedExtensionImage(source, packagedIconPath))
      image.src = iconUrl;
    else image.remove();
  }
  for (const link of template.content.querySelectorAll("a")) {
    const href = link.getAttribute("href") ?? "";
    if (!isSafeExtensionLink(href)) link.removeAttribute("href");
    link.rel = "noopener noreferrer";
  }
  return template.content;
}

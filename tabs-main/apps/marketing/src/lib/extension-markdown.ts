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
): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = renderReleaseMarkdown(markdown);
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

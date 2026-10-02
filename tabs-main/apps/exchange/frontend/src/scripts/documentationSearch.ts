import { openapiParameters } from "../lib/openapiParameters";

export interface DocSection {
  title: string;
  page: string;
  href: string;
  text: string;
}
export function parseDocumentationIndex(text: string): DocSection[] {
  const message =
    "Documentation search could not load a valid index. Reload the page or use the guide navigation.";
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(message);
  }
  if (!Array.isArray(value) || value.length > 10_000) throw new Error(message);
  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !["title", "page", "href", "text"].every((key) => typeof entry[key] === "string") ||
      !isDocumentationHref(entry.href)
    )
      throw new Error(message);
  }
  return value as DocSection[];
}
export function isDocumentationHref(href: string): boolean {
  return (
    /^\/docs\/extensions(?:\/[a-z0-9-]+)?(?:#docs-section-[0-9]+)?$/.test(href) ||
    /^\/docs\/extensions\/registry-api#[A-Za-z][A-Za-z0-9_-]*$/.test(href)
  );
}
export function registryApiSections(contract: {
  paths: Record<string, Record<string, unknown>>;
}): DocSection[] {
  return Object.entries(contract.paths).flatMap(([path, methods]) =>
    Object.entries(methods).flatMap(([method, value]) => {
      if (
        !/^(get|post|put|patch|delete|head|options)$/.test(method) ||
        !value ||
        typeof value !== "object"
      )
        return [];
      const operation = value as {
        operationId?: string;
        summary?: string;
        description?: string;
        parameters?: Array<{ name?: string; description?: string }>;
        responses?: Record<string, { description?: string }>;
      };
      if (!operation.operationId || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(operation.operationId))
        return [];
      return [
        {
          page: "Registry API reference",
          title: `${method.toUpperCase()} ${path} — ${operation.summary ?? operation.operationId}`,
          href: `/docs/extensions/registry-api#${operation.operationId}`,
          text: [
            operation.description ?? "",
            ...openapiParameters(contract, operation.parameters).map(
              (parameter) => `${parameter.name ?? ""} ${parameter.description ?? ""}`,
            ),
            ...Object.entries(operation.responses ?? {}).map(
              ([code, response]) => `${code} ${response.description ?? ""}`,
            ),
          ].join(" "),
        },
      ];
    }),
  );
}
function plain(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:amp|lt|gt|quot|#39);/g,
      (value) =>
        ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[value] ?? value,
    )
    .replace(/\s+/g, " ")
    .trim();
}
export function documentationSections(page: string, href: string, html: string): DocSection[] {
  const headings = Array.from(html.matchAll(/<h[1-6]>([\s\S]*?)<\/h[1-6]>/g));
  if (!headings.length) return [{ page, title: page, href, text: plain(html) }];
  return headings.map((heading, index) => ({
    page,
    title: plain(heading[1]!),
    href: `${href}#docs-section-${index}`,
    text: plain(
      html.slice(heading.index! + heading[0].length, headings[index + 1]?.index ?? html.length),
    ),
  }));
}
export function searchDocumentation(sections: DocSection[], query: string): DocSection[] {
  const words = query.trim().toLowerCase().slice(0, 200).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return sections
    .map((section) => {
      const title = section.title.toLowerCase();
      const body = `${section.page} ${section.text}`.toLowerCase();
      const score = words.every((word) => title.includes(word) || body.includes(word))
        ? words.reduce(
            (sum, word) => sum + (title === word ? 20 : title.includes(word) ? 10 : 1),
            0,
          )
        : 0;
      return { section, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.section.title.localeCompare(b.section.title))
    .slice(0, 20)
    .map((entry) => entry.section);
}

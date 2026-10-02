import * as FS from "node:fs";
import * as Path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repository = Path.resolve(Path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = Path.join(repository, "apps/exchange/frontend/dist");
const serverRoutes = new Set(["/publisher-terms", "/v1/openapi.json"]);
const search = JSON.parse(FS.readFileSync(Path.join(dist, "docs/extensions/search.json"), "utf8"));
const pages = [
  "",
  "development",
  "reference",
  "permissions",
  "logic",
  "publishing",
  "updates",
  "registry",
  "self-hosting",
  "troubleshooting",
];
for (const slug of pages) {
  const html = FS.readFileSync(Path.join(dist, "docs/extensions", slug, "index.html"), "utf8");
  assert(html.includes('id="docs-search"'));
  assert(html.includes('aria-label="Documentation pages"'));
  assert(html.includes('aria-label="Breadcrumb"'));
  assert(html.includes('aria-label="Previous and next documentation"'));
  assert(html.includes("Experimental"));
  assert(
    search.some((section) => section.href.startsWith(`/docs/extensions${slug ? `/${slug}` : ""}#`)),
    "Missing section search entries",
  );
  for (const match of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
    const pathname = new URL(match[1], "https://docs.example").pathname;
    if (serverRoutes.has(pathname)) continue;
    const direct = Path.join(dist, pathname);
    const directory = Path.join(dist, pathname, "index.html");
    assert(
      FS.existsSync(direct) || FS.existsSync(directory),
      `${slug || "start"}: missing built link ${pathname}`,
    );
  }
  for (const target of pages) {
    assert(
      html.includes(`href="/docs/extensions${target ? `/${target}` : ""}"`),
      `Missing navigation ${target}`,
    );
  }
}
for (const section of search) {
  const url = new URL(section.href, "https://docs.example");
  assert(url.origin === "https://docs.example" && url.pathname.startsWith("/docs/extensions"));
  const html = FS.readFileSync(Path.join(dist, url.pathname, "index.html"), "utf8");
  if (/^#docs-section-[0-9]+$/.test(url.hash)) {
    // Guide anchors are currently assigned by docs.ts to headings in .prose.
    const article = /<article\b[^>]*>([\s\S]*?)<\/article>/.exec(html);
    assert(article, `Missing guide article ${section.href}`);
    const count = Array.from(article[1].matchAll(/<h[1-6]\b/g)).length;
    assert(
      Number(url.hash.slice("#docs-section-".length)) < count,
      `Missing heading ${section.href}`,
    );
  } else {
    assert(html.includes(`id="${url.hash.slice(1)}"`), `Missing API operation ${section.href}`);
  }
}
const api = FS.readFileSync(Path.join(dist, "docs/extensions/registry-api/index.html"), "utf8");
assert(api.includes("namespace</code> — path, required"), "Unresolved namespace parameter");
assert(api.includes("name</code> — path, required"), "Unresolved extension name parameter");
assert(!api.includes("<code></code> —"), "Blank API parameter labels");
const release = JSON.parse(
  FS.readFileSync(Path.join(dist, "developers/releases/manifest.json"), "utf8"),
);
for (const url of [
  release.bundle.url,
  release.checksumsUrl,
  ...release.packages.map((entry) => entry.url),
])
  assert(FS.existsSync(Path.join(dist, url)), `Missing developer download ${url}`);
const reference = FS.readFileSync(Path.join(dist, "docs/extensions/reference/index.html"), "utf8");
const resources = FS.readFileSync(Path.join(dist, "resources/index.html"), "utf8");
for (const href of [
  "/developers",
  "/publish",
  "/account",
  "/docs/extensions/self-hosting",
  "/docs/extensions/registry-api",
]) {
  assert(resources.includes(`href="${href}"`), `Missing resource destination ${href}`);
  assert(FS.existsSync(Path.join(dist, href, "index.html")), `Unbuilt resource ${href}`);
}
assert(resources.includes('aria-labelledby="security-title"'));
assert(
  resources.includes("Ordinary support is not automatically a confidential vulnerability inbox"),
);
for (const [page, signature] of [
  ["index.html", true],
  ["extensions/index.html", true],
  ["extensions/detail/index.html", true],
  ["account/index.html", true],
  ["publish/index.html", true],
  ["admin/index.html", true],
  ["docs/extensions/index.html", true],
]) {
  const html = FS.readFileSync(Path.join(dist, page), "utf8");
  assert.equal(html.includes('class="exchange-signature"'), signature, `Signature scope: ${page}`);
  assert(!html.includes("data-workspace-runner"), `Deferred runner must not render: ${page}`);
  assert(html.includes('href="/resources"'), `Missing resources navigation: ${page}`);
}
assert(reference.includes("TABS_EXTENSION_API_VERSION"));
assert(reference.includes("TabsExtensionManifest"));
assert(reference.includes("readText"));
const logic = FS.readFileSync(Path.join(dist, "docs/extensions/logic/index.html"), "utf8");
assert(logic.includes("unsupported"));
console.log(
  `Verified ${pages.length} Exchange documentation pages, ${search.length} section/API targets, local assets, developer downloads, generated references and unsupported-feature labels. This does not execute SDK examples or prove desktop loading.`,
);

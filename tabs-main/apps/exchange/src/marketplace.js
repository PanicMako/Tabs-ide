import { extensionMarkdown } from "../../marketing/src/lib/extension-markdown.ts";

const element = (id) => document.getElementById(id);
const status = element("status");
const signinLink = document.querySelector("#signin a");
if (signinLink)
  signinLink.href = `/auth/github/start?${new URLSearchParams({ returnTo: `${location.pathname}${location.search}${location.hash}` })}`;
function announce(message) {
  status.textContent = message;
}
function node(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}
const identifier = /^[a-z][a-z0-9-]{1,62}$/;
function identity(namespace, name) {
  return (
    typeof namespace === "string" &&
    identifier.test(namespace) &&
    typeof name === "string" &&
    identifier.test(name)
  );
}
async function request(path, plain = false, maxBytes = 1024 * 1024) {
  const response = await fetch(path, {
    redirect: "error",
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      element("signin").hidden = false;
      element("catalog").hidden = true;
      element("detail").hidden = true;
    }
    throw new Error(
      response.status === 401 || response.status === 403
        ? "Sign in again to reconnect to this private registry."
        : `Registry request failed (${response.status}). Retry or contact the operator.`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Registry response is missing.");
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > maxBytes) throw new Error("Registry response exceeded its limit.");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  return plain ? text : JSON.parse(text);
}
let cursor = null;
let generation = 0;
let busy = false;
const seen = new Set();
async function catalog(append = false) {
  const current = ++generation;
  element("more").disabled = true;
  if (!append) {
    cursor = null;
    seen.clear();
    element("results").replaceChildren();
  }
  const query = new URLSearchParams({
    q: element("search").value.trim(),
    category: element("category").value.trim(),
    sort: element("sort").value,
    limit: "30",
  });
  if (append && cursor) query.set("cursor", cursor);
  announce("Loading published extensions…");
  try {
    const page = await request(`/v1/extensions?${query}`);
    if (current !== generation) return;
    if (!Array.isArray(page.extensions)) throw new Error("Invalid catalog response.");
    const first = element("results").children.length;
    for (const item of page.extensions) {
      if (
        !identity(item.namespace, item.name) ||
        !item.manifest ||
        typeof item.manifest.displayName !== "string"
      )
        throw new Error("Invalid listing identity.");
      const key = `${item.namespace}.${item.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = node("li");
      const link = node("a", item.manifest.displayName);
      link.href = `/extensions/${item.namespace}/${item.name}`;
      row.append(
        link,
        node("p", item.manifest.description),
        node(
          "p",
          `${key} · ${item.version} · ${item.verified ? "Verified publisher" : "Unverified publisher"}`,
        ),
      );
      element("results").append(row);
    }
    cursor = page.nextCursor ?? null;
    if (
      cursor &&
      (typeof cursor !== "string" ||
        !/^[A-Za-z0-9_-]{1,16384}$/.test(cursor) ||
        !page.extensions.length)
    )
      throw new Error("Invalid catalog cursor.");
    element("more").hidden = !cursor;
    announce(`${element("results").children.length} published extensions shown.`);
    if (append) element("results").children[first]?.querySelector("a")?.focus();
  } catch (error) {
    if (current === generation) {
      announce(error.message);
      element("retry").hidden = false;
    }
  } finally {
    if (current === generation) element("more").disabled = false;
  }
}
let versionCursor = null;
const seenVersions = new Set();
async function releases(namespace, name, append = false) {
  if (busy) return;
  busy = true;
  element("more-versions").disabled = true;
  if (!append) {
    versionCursor = null;
    seenVersions.clear();
    element("releases").replaceChildren();
  }
  try {
    const page = await request(
      `/v1/extensions/${namespace}/${name}${versionCursor ? `?cursor=${encodeURIComponent(versionCursor)}` : ""}`,
    );
    if (!Array.isArray(page.versions)) throw new Error("Invalid versions response.");
    for (const release of page.versions) {
      if (
        release.namespace !== namespace ||
        release.name !== name ||
        typeof release.version !== "string" ||
        !/^[0-9A-Za-z.+-]{1,128}$/.test(release.version) ||
        !release.manifest
      )
        throw new Error("Invalid release identity.");
      if (seenVersions.has(release.version)) continue;
      seenVersions.add(release.version);
      const manifest = release.manifest;
      element("title").textContent = manifest.displayName;
      const article = node("article");
      article.append(
        node("h2", `Version ${release.version}`),
        node("p", manifest.description),
        node(
          "p",
          `${namespace}.${name}: ${release.verified ? "verified" : "unverified"} publisher. Namespace membership alone does not prove ownership.`,
        ),
      );
      const base = `/v1/extensions/${namespace}/${name}/versions/${encodeURIComponent(release.version)}`;
      if (manifest.listing?.icon) {
        const image = node("img");
        image.src = `${base}/assets/icon`;
        image.alt = "";
        image.width = 64;
        image.height = 64;
        article.append(image);
      }
      for (const [label, value] of [
        ["Tabs compatibility", manifest.engines?.tabs],
        ["API compatibility", manifest.engines?.api ?? "v1"],
        ["Permissions", manifest.capabilities?.join(", ") || "None"],
        ["License", manifest.listing?.license ?? "Not specified"],
        ["Categories", manifest.listing?.categories?.join(", ") || "Not specified"],
        ["External services", manifest.listing?.externalServices ?? "No disclosure supplied"],
        ["Release notes", manifest.releaseNotes ?? "Not supplied"],
      ])
        article.append(node("p", `${label}: ${value}`));
      for (const [label, value] of [
        ["Source", manifest.sourceUrl],
        ["Support", manifest.supportUrl],
        ["Privacy", manifest.privacyUrl],
      ]) {
        if (!value) continue;
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password) continue;
        const link = node("a", label);
        link.href = url.href;
        link.rel = "noopener noreferrer";
        article.append(link, document.createTextNode(" "));
      }
      const download = node("a", "Download package for inspection");
      download.href = `${base}/download`;
      article.append(
        node(
          "p",
          "Signed and manually approved. Review is not a guarantee of safety; install through Tabs to verify TUF metadata and consent.",
        ),
        download,
      );
      if (manifest.listing?.readme) {
        const details = node("details");
        const heading = node("summary", "README");
        const content = node("div");
        details.append(heading, content);
        article.append(details);
        let loaded = false;
        details.addEventListener("toggle", async () => {
          if (!details.open || loaded) return;
          loaded = true;
          content.textContent = "Loading README…";
          try {
            content.replaceChildren(
              extensionMarkdown(
                await request(`${base}/assets/readme`, true, 512 * 1024),
                manifest.listing?.icon,
                `${base}/assets/icon`,
              ),
            );
          } catch (error) {
            loaded = false;
            content.textContent = error.message;
          }
        });
      }
      element("releases").append(article);
    }
    versionCursor = page.nextCursor ?? null;
    if (
      versionCursor &&
      (typeof versionCursor !== "string" ||
        !/^[A-Za-z0-9_-]{1,512}$/.test(versionCursor) ||
        !page.versions.length)
    )
      throw new Error("Invalid version cursor.");
    element("more-versions").hidden = !versionCursor;
    announce(`${seenVersions.size} published versions shown.`);
  } catch (error) {
    announce(error.message);
    element("retry").hidden = false;
  } finally {
    busy = false;
    element("more-versions").disabled = false;
  }
}
element("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void catalog();
});
element("more").addEventListener("click", () => void catalog(true));
element("retry").addEventListener("click", () => location.reload());
try {
  const registry = await request("/v1/registry");
  const me = await request("/v1/me");
  element("visibility").textContent =
    `${registry.visibility === "private" ? "Private" : "Public"} registry · ${me ? `Signed in as ${me.login}` : "Anonymous browsing"}`;
  if (registry.visibility === "private" && !me) {
    element("signin").hidden = false;
    announce("Sign in to view this private registry.");
  } else {
    const path = /^\/extensions\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/?$/.exec(
      location.pathname,
    );
    if (path) {
      element("detail").hidden = false;
      element("more-versions").addEventListener(
        "click",
        () => void releases(path[1], path[2], true),
      );
      await releases(path[1], path[2]);
    } else {
      element("catalog").hidden = false;
      await catalog();
    }
  }
} catch (error) {
  announce(error.message);
  element("retry").hidden = false;
}

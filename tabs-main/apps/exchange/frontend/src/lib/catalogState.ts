export interface CatalogState {
  q: string;
  category: string;
  sort: "" | "name" | "newest" | "relevance";
}

export function readCatalogState(search: string): CatalogState {
  const params = new URLSearchParams(search);
  const sort = params.get("sort") ?? "";
  const category = params.get("category") ?? "";
  return {
    q: (params.get("q") ?? "").slice(0, 100),
    category: /^[a-z][a-z0-9-]{1,39}$/.test(category) ? category : "",
    sort: sort === "name" || sort === "newest" || sort === "relevance" ? sort : "",
  };
}

export function catalogParameters(state: CatalogState, cursor?: string): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.category) params.set("category", state.category);
  if (state.sort) params.set("sort", state.sort);
  if (cursor) params.set("cursor", cursor);
  return params;
}

export interface CatalogRelease {
  namespace: string;
  name: string;
  version: string;
  verified: boolean;
  manifest: { displayName: string; description: string; listing?: { icon?: string } };
}
export interface CatalogPage {
  extensions: CatalogRelease[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function validateCatalogPage(value: unknown): CatalogPage {
  if (!value || typeof value !== "object")
    throw new Error("Invalid catalog response. Retry or contact the operator.");
  const page = value as CatalogPage;
  if (
    !Array.isArray(page.extensions) ||
    page.extensions.length > 30 ||
    typeof page.hasMore !== "boolean" ||
    (page.nextCursor !== null &&
      (typeof page.nextCursor !== "string" || !/^[A-Za-z0-9_-]{1,16384}$/.test(page.nextCursor))) ||
    page.hasMore !== (page.nextCursor !== null) ||
    (page.hasMore && !page.extensions.length)
  )
    throw new Error("Invalid catalog pagination. Restart the search.");
  for (const item of page.extensions) {
    if (
      !item ||
      typeof item.namespace !== "string" ||
      typeof item.name !== "string" ||
      !/^[a-z][a-z0-9-]{1,62}$/.test(item.namespace) ||
      !/^[a-z][a-z0-9-]{1,62}$/.test(item.name) ||
      typeof item.version !== "string" ||
      !/^[0-9A-Za-z.+-]{1,128}$/.test(item.version) ||
      typeof item.verified !== "boolean" ||
      !item.manifest ||
      typeof item.manifest.displayName !== "string" ||
      item.manifest.displayName.length > 500 ||
      typeof item.manifest.description !== "string" ||
      item.manifest.description.length > 500
    )
      throw new Error("Invalid extension listing. Retry or contact the operator.");
  }
  return page;
}

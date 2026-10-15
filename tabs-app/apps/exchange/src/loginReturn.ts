const defaultRoute = "/publisher";

export function loginReturnRoute(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(value)
  )
    return defaultRoute;
  let url: URL;
  try {
    url = new URL(value, "https://exchange.invalid");
    if (/[\\\u0000-\u001f\u007f]/.test(decodeURIComponent(value))) return defaultRoute;
  } catch {
    return defaultRoute;
  }
  if (url.origin !== "https://exchange.invalid") return defaultRoute;
  const allowed =
    /^(?:\/|\/extensions\/?|\/extensions\/[a-z][a-z0-9-]{1,62}\/[a-z][a-z0-9-]{1,62}\/?|\/developers\/?|\/docs\/extensions(?:\/[a-z][a-z0-9-]{0,80})?\/?|\/(?:publish|publisher)\/?|\/account(?:\/(?:namespaces|extensions|tokens|submissions)(?:\/[A-Za-z0-9._-]{1,128})?)?\/?|\/admin(?:\/(?:reviews|operations|revocations)(?:\/[A-Za-z0-9._-]{1,128})?)?\/?)$/;
  if (!allowed.test(url.pathname) && !/^\/admin\/(?:reviewers|security)\/?$/.test(url.pathname))
    return defaultRoute;
  return `${url.pathname}${url.search}${url.hash}`;
}

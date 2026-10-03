export type NativeCodeProxy = {
  readonly kind: "direct" | "http" | "socks";
  readonly host?: string;
};

/** Convert Chromium's resolveProxy result into Code-OSS's diagnostics shape. */
export function parseElectronProxyResult(value: string): NativeCodeProxy[] {
  const proxies: NativeCodeProxy[] = [];
  for (const rawEntry of value.split(";")) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const separator = entry.indexOf(" ");
    const type = (separator === -1 ? entry : entry.slice(0, separator)).toUpperCase();
    const host = separator === -1 ? "" : entry.slice(separator + 1).trim();
    if (type === "DIRECT") proxies.push({ kind: "direct" });
    else if ((type === "PROXY" || type === "HTTP" || type === "HTTPS") && host) {
      proxies.push({ kind: "http", host });
    } else if ((type === "SOCKS" || type === "SOCKS4" || type === "SOCKS5") && host) {
      proxies.push({ kind: "socks", host });
    }
  }
  return proxies.length > 0 ? proxies : [{ kind: "direct" }];
}

export function readProxyEnvironment(
  env: NodeJS.ProcessEnv,
): Record<string, { variable: string; value: string }> {
  const result: Record<string, { variable: string; value: string }> = {};
  for (const [key, names] of Object.entries({
    httpProxy: ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"],
    httpsProxy: ["HTTPS_PROXY", "https_proxy"],
    allProxy: ["ALL_PROXY", "all_proxy"],
    noProxy: ["NO_PROXY", "no_proxy"],
  })) {
    const variable = names.find((name) => typeof env[name] === "string" && env[name]!.length > 0);
    if (variable) result[key] = { variable, value: env[variable]! };
  }
  return result;
}

import * as Dns from "node:dns/promises";
import * as Https from "node:https";
import * as Net from "node:net";
import ipaddr from "ipaddr.js";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const DNS_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface ExtensionNetworkTransport {
  readonly lookup: typeof Dns.lookup;
  readonly request: typeof Https.request;
}

const defaultTransport: ExtensionNetworkTransport = { lookup: Dns.lookup, request: Https.request };

export function extensionNetworkStatusAllowed(statusCode: number | undefined): boolean {
  return statusCode !== undefined && statusCode >= 200 && statusCode < 300;
}

export function validateExtensionNetworkUrl(raw: string, hosts: readonly string[]): URL {
  if (typeof raw !== "string" || raw.length > 2048) throw new Error("Invalid network URL.");
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.port ||
    Net.isIP(url.hostname) !== 0 ||
    !hosts.includes(url.hostname)
  )
    throw new Error("Network destination is not declared by this extension.");
  return url;
}

export async function resolveExtensionNetworkAddress(
  hostname: string,
  lookup: typeof Dns.lookup = Dns.lookup,
  signal?: AbortSignal,
): Promise<{ address: string; family: 4 | 6 }> {
  if (signal?.aborted) throw new Error("Network request was cancelled.");
  const answers = await new Promise<Array<{ address: string; family: number }>>(
    (resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown, value?: Array<{ address: string; family: number }>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(value!);
      };
      const abort = () => finish(new Error("Network request was cancelled."));
      const timeout = setTimeout(
        () => finish(new Error("Network destination lookup timed out.")),
        DNS_TIMEOUT_MS,
      );
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      Promise.resolve()
        .then(() => (settled ? [] : lookup(hostname, { all: true, order: "verbatim" })))
        .then(
          (value) => finish(undefined, value),
          (error) => finish(error),
        );
    },
  );
  if (!answers.length || answers.length > 16)
    throw new Error("Network destination is unavailable.");
  for (const answer of answers) {
    if (
      Net.isIP(answer.address) !== answer.family ||
      ipaddr.process(answer.address).range() !== "unicast"
    ) {
      throw new Error("Network destination resolves to a restricted address.");
    }
  }
  const first = answers[0]!;
  return { address: first.address, family: first.family as 4 | 6 };
}

/** One DNS resolution, one pinned TLS connection, no redirects, cookies, or caller headers. */
export async function extensionNetworkGetText(
  raw: string,
  hosts: readonly string[],
  bearerToken?: string,
  transport: ExtensionNetworkTransport = defaultTransport,
  signal?: AbortSignal,
): Promise<string> {
  const url = validateExtensionNetworkUrl(raw, hosts);
  if (signal?.aborted) throw new Error("Network request was cancelled.");
  const startedAt = Date.now();
  const pinned = await resolveExtensionNetworkAddress(url.hostname, transport.lookup, signal);
  if (signal?.aborted) throw new Error("Network request was cancelled.");
  const remainingMs = REQUEST_TIMEOUT_MS - (Date.now() - startedAt);
  if (remainingMs <= 0) throw new Error("Network request timed out.");
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;
    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => {
      finish(new Error("Network request was cancelled."));
      request.destroy();
    };
    const request = transport.request(
      url,
      {
        method: "GET",
        agent: false,
        family: pinned.family,
        timeout: 10_000,
        maxHeaderSize: 16 * 1024,
        signal,
        headers: {
          Accept: "text/plain, application/json",
          "User-Agent": "Tabs-Extension/1",
          ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
        },
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
          else callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        response.on("error", finish);
        if (!extensionNetworkStatusAllowed(response.statusCode)) {
          finish(new Error("Network request failed or returned a redirect."));
          response.destroy();
          return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) {
            response.destroy();
            finish(new Error("Network response is too large."));
          } else chunks.push(chunk);
        });
        response.on("end", () => finish(undefined, Buffer.concat(chunks).toString("utf8")));
      },
    );
    deadline = setTimeout(() => {
      finish(new Error("Network request timed out."));
      request.destroy();
    }, remainingMs);
    request.on("timeout", () => {
      finish(new Error("Network request timed out."));
      request.destroy();
    });
    request.on("error", finish);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    request.end();
  });
}

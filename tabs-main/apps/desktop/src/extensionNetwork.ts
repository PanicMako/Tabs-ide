import * as Dns from "node:dns/promises";
import * as Https from "node:https";
import * as Net from "node:net";
import ipaddr from "ipaddr.js";

const MAX_RESPONSE_BYTES = 1024 * 1024;

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
): Promise<{ address: string; family: 4 | 6 }> {
  const answers = await lookup(hostname, { all: true, order: "verbatim" });
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
): Promise<string> {
  const url = validateExtensionNetworkUrl(raw, hosts);
  const pinned = await resolveExtensionNetworkAddress(url.hostname);
  return new Promise((resolve, reject) => {
    const request = Https.request(
      url,
      {
        method: "GET",
        agent: false,
        family: pinned.family,
        timeout: 10_000,
        maxHeaderSize: 16 * 1024,
        headers: { Accept: "text/plain, application/json" },
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
          else callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        if (!extensionNetworkStatusAllowed(response.statusCode)) {
          response.destroy();
          reject(new Error("Network request failed or returned a redirect."));
          return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) {
            response.destroy();
            reject(new Error("Network response is too large."));
          } else chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("Network request timed out.")));
    request.on("error", reject);
    request.end();
  });
}

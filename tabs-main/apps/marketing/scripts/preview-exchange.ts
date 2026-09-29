// Local, read-only UI fixtures. This is not a registry and never serves packages.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const samples = [
  "hello",
  "github-profile",
  "project-companion",
  "calculator",
  "workspace-reader",
  "git-status",
];
const extensions = samples.map((sample) => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(`../../../examples/${sample}-extension/tabs-extension.json`, import.meta.url),
      "utf8",
    ),
  );
  return {
    namespace: manifest.publisher,
    name: manifest.name,
    version: manifest.version,
    manifest,
    verified: false,
    digest: "0".repeat(64),
    bytes: 0,
    submitted_at: "Local preview fixture",
  };
});

createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "http://localhost:4322");
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  const url = new URL(request.url ?? "/", "http://localhost:4332");
  if (request.method !== "GET") {
    response.writeHead(405).end(JSON.stringify({ error: "Read-only preview" }));
    return;
  }
  if (url.pathname === "/v1/extensions") {
    const query = (url.searchParams.get("q") ?? "").toLowerCase();
    response.end(
      JSON.stringify({
        extensions: extensions.filter((entry) =>
          `${entry.namespace} ${entry.name} ${entry.manifest.displayName} ${entry.manifest.description}`
            .toLowerCase()
            .includes(query),
        ),
        nextCursor: null,
      }),
    );
    return;
  }
  const match = /^\/v1\/extensions\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(url.pathname);
  const entry =
    match && extensions.find((item) => item.namespace === match[1] && item.name === match[2]);
  if (entry) response.end(JSON.stringify({ versions: [entry], nextCursor: null }));
  else
    response
      .writeHead(404)
      .end(JSON.stringify({ error: "Preview only: publishing and downloads are unavailable" }));
}).listen(4332, "127.0.0.1", () =>
  console.log(
    "Read-only fixture API: http://localhost:4332 (use preview website at localhost:4322)",
  ),
);

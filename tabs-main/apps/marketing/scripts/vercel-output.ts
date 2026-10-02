import { mkdir, cp, writeFile } from "node:fs/promises";
// A static Build Output API deployment keeps Vercel independent of the desktop build.
const root = new URL("../", import.meta.url);
await mkdir(new URL(".vercel/output/static/", root), { recursive: true });
await cp(new URL("dist/", root), new URL(".vercel/output/static/", root), { recursive: true });
await writeFile(
  new URL(".vercel/output/config.json", root),
  JSON.stringify({
    version: 3,
    routes: [
      {
        src: "/_astro/(.*)",
        headers: { "cache-control": "public,max-age=31536000,immutable" },
        continue: true,
      },
      { src: "/download/?", dest: "/download/index.html" },
      { src: "/changelog/?", dest: "/changelog/index.html" },
      {
        src: "/extension/?",
        has: [
          { type: "query", key: "namespace", value: "(?<publisher>[a-z][a-z0-9-]{1,62})" },
          { type: "query", key: "name", value: "(?<extension>[a-z][a-z0-9-]{1,62})" },
        ],
        status: 308,
        headers: { Location: "/extensions/$publisher/$extension" },
      },
      {
        src: "/extensions/[a-z][a-z0-9-]{1,62}/[a-z][a-z0-9-]{1,62}/?",
        dest: "/extension/index.html",
      },
      { handle: "filesystem" },
    ],
  }),
);
console.log("Packaged static Vercel deployment.");

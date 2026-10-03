import { mkdir, cp, writeFile, rm } from "node:fs/promises";
// A static Build Output API deployment keeps Vercel independent of the desktop build.
const root = new URL("../", import.meta.url);
await rm(new URL(".vercel/output", root), { recursive: true, force: true });
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
      { src: "/feedback/?", dest: "/feedback/index.html" },
      { src: "/community/?", dest: "/community/index.html" },
      { handle: "filesystem" },
    ],
  }),
);
console.log("Packaged static Vercel deployment.");

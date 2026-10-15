import { defineConfig } from "astro/config";
import { serveFrontend } from "../src/frontend.ts";

export default defineConfig({
  devToolbar: { enabled: false },
  build: { inlineStylesheets: "never" },
  vite: {
    build: { assetsInlineLimit: 0 },
    plugins: [
      {
        name: "exchange-developer-release-preview",
        configureServer(server) {
          // Serve the real, previously built toolkit in development using the
          // same bounded asset routing as the registry, rather than mock downloads.
          server.middlewares.use(async (request, response, next) => {
            const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
            if (request.method !== "GET" || !pathname.startsWith("/developers/releases/"))
              return next();
            try {
              if (await serveFrontend(pathname, response)) return;
              next();
            } catch {
              response.writeHead(503, {
                "Content-Type": "text/plain",
                "Cache-Control": "no-store",
              });
              response.end("Developer bundle unavailable.");
            }
          });
        },
      },
    ],
  },
});

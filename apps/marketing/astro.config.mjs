import { defineConfig } from "astro/config";

export default defineConfig({
  devToolbar: { enabled: false },
  redirects: {
    "/download": "/downloads",
  },
  server: {
    port: Number(process.env.PORT ?? 4173),
  },
});

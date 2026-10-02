import { defineConfig } from "astro/config";

export default defineConfig({
  devToolbar: { enabled: false },
  build: { inlineStylesheets: "never" },
  vite: { build: { assetsInlineLimit: 0 } },
});

FROM oven/bun:1.3.14

WORKDIR /app
COPY package.json bun.lock ./
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/exchange/package.json apps/exchange/package.json
COPY apps/marketing/package.json apps/marketing/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/client-runtime/package.json packages/client-runtime/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/effect-acp/package.json packages/effect-acp/package.json
COPY packages/effect-codex-app-server/package.json packages/effect-codex-app-server/package.json
COPY packages/extension-api/package.json packages/extension-api/package.json
COPY packages/extension-cli/package.json packages/extension-cli/package.json
COPY packages/extension-package/package.json packages/extension-package/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ssh/package.json packages/ssh/package.json
COPY packages/tailscale/package.json packages/tailscale/package.json
COPY scripts/package.json scripts/package.json
# The registry uses JavaScript-only runtime dependencies. Do not run unrelated
# desktop/native workspace lifecycle scripts inside the registry image.
RUN bun install --frozen-lockfile --ignore-scripts --filter @tabs/exchange --filter @tabs/marketing
COPY . .
ARG EXCHANGE_WEB_SITE_NAME="Tabs Exchange"
ARG EXCHANGE_WEB_DOCS_URL="/docs/extensions"
ARG EXCHANGE_WEB_SUPPORT_URL=""
RUN bun run --cwd apps/exchange build:portal

USER bun
EXPOSE 8787
CMD ["bun", "run", "--cwd", "apps/exchange", "start"]

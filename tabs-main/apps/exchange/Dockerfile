FROM oven/bun:1.3.14

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

USER bun
EXPOSE 8787
CMD ["bun", "--cwd", "apps/exchange", "run", "start"]

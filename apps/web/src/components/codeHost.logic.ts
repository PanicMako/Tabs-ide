export function getDefaultCodeHostUnavailableMessage(): string {
  return [
    "Build the local editor checkout with `cd ../tabs-code-oss && npm install && npm run compile`.",
    "Then set `TABS_CODE_OSS_BUILD_DIR` to the local `tabs-code-oss` checkout root.",
  ].join(" ");
}

export function getCodeHostUnavailableMessage(reason: string | null): string {
  return reason ?? getDefaultCodeHostUnavailableMessage();
}

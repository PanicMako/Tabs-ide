export function isNativeCodeHostURL(rawUrl: string, scheme = "tabs"): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === `${scheme}:` && url.hostname !== "app";
  } catch {
    return false;
  }
}

export function findNativeCodeHostURLs(argv: readonly string[], scheme = "tabs"): string[] {
  return argv.filter((value) => isNativeCodeHostURL(value, scheme));
}

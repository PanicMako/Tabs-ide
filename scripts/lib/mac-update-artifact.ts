export function updateMacUpdateMetadata(
  raw: string,
  assetName: string,
  sha512: string,
  size: number,
): string {
  if (!raw.includes(`url: ${assetName}`) || !raw.includes(`path: ${assetName}`)) {
    throw new Error(`macOS update metadata does not reference ${assetName}.`);
  }

  let shaCount = 0;
  let sizeCount = 0;
  const updated = raw
    .replace(/^(\s*sha512:\s*).+$/gm, (_line, prefix: string) => {
      shaCount += 1;
      return `${prefix}${sha512}`;
    })
    .replace(/^(\s*size:\s*)\d+$/gm, (_line, prefix: string) => {
      sizeCount += 1;
      return `${prefix}${size}`;
    });

  if (shaCount < 2 || sizeCount < 1) {
    throw new Error("macOS update metadata is missing its expected checksum or size fields.");
  }
  return updated;
}

export function parseBlockedDigestBatch(raw) {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 1 || lines.length > 100) {
    throw new Error("Enter between 1 and 100 digest lines.");
  }
  const entries = [];
  const seen = new Set();
  for (const [index, line] of lines.entries()) {
    const match = /^([a-f0-9]{64})\s+(.+)$/.exec(line);
    if (!match || match[2].length > 2000 || seen.has(match[1])) {
      throw new Error(`Line ${index + 1} needs a unique lowercase SHA-256 digest and reason.`);
    }
    seen.add(match[1]);
    entries.push({ digest: match[1], reason: match[2] });
  }
  const body = JSON.stringify({ entries });
  if (new TextEncoder().encode(body).length > 64 * 1024) {
    throw new Error("The hash list is too large. Import it in smaller batches.");
  }
  return body;
}

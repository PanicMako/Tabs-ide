globalThis.run = ({ commandId, input }) => {
  if (commandId !== "analyze-text") throw new Error("Unknown command.");
  if (!input || typeof input.text !== "string" || input.text.length > 10_000) {
    throw new Error("Supply text of at most 10,000 UTF-16 code units.");
  }
  const text = input.text;
  const trimmed = text.trim();
  return {
    words: trimmed ? trimmed.split(/\s+/u).length : 0,
    lines: text ? text.split(/\r\n|\r|\n/u).length : 0,
    characters: Array.from(text).length,
  };
};

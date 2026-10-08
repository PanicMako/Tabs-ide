export type FilePreviewKind = "image" | "video" | "audio" | "pdf" | "markdown" | "csv" | "text";
export function filePreviewKind(path: string): FilePreviewKind {
  const extension = path.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp"].includes(extension ?? ""))
    return "image";
  if (["mp4", "webm", "mov", "m4v", "ogv"].includes(extension ?? "")) return "video";
  if (["mp3", "wav", "ogg", "m4a", "flac", "aac"].includes(extension ?? "")) return "audio";
  if (extension === "pdf") return "pdf";
  if (["md", "mdx"].includes(extension ?? "")) return "markdown";
  if (extension === "csv" || extension === "tsv") return "csv";
  return "text";
}
/** Quoted separators, escaped quotes and quoted newlines, bounded for preview rendering. */
export function parseDelimitedPreview(text: string, separator = ",", limit = 1000) {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let index = 0; index < text.length; index++) {
    const ch = text[index]!;
    if (ch === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && (ch === separator || ch === "\n")) {
      row.push(value.replace(/\r$/, ""));
      value = "";
      if (ch === "\n") {
        rows.push(row);
        row = [];
        if (rows.length >= limit) return { rows, truncated: index < text.length - 1 };
      }
    } else value += ch;
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return { rows, truncated: false };
}

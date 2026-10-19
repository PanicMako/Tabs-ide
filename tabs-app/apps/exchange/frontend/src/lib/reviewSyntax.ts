export interface SourceToken {
  text: string;
  kind: string;
}
const keywords = new Set(
  "async await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield interface type enum implements public private readonly as satisfies".split(
    " ",
  ),
);
export function sourceLanguage(file: string): string {
  const extension = file.split(".").pop()?.toLowerCase();
  return extension && ["js", "mjs", "cjs", "jsx", "ts", "tsx"].includes(extension)
    ? "JavaScript / TypeScript"
    : extension === "json"
      ? "JSON"
      : extension === "css"
        ? "CSS"
        : extension && ["html", "htm", "svg", "xml"].includes(extension)
          ? "HTML / XML"
          : extension === "md"
            ? "Markdown"
            : "Plain text";
}
/** Bounded linear visual lexer. It never evaluates source, emits HTML, or loads language plugins. */
export function sourceTokens(text: string, file: string): SourceToken[] {
  if (text.length > 8000 || sourceLanguage(file) === "Plain text") return [{ text, kind: "plain" }];
  const tokens: SourceToken[] = [];
  const markup = sourceLanguage(file) === "HTML / XML";
  let position = 0;
  while (position < text.length) {
    const start = position;
    const char = text[position]!;
    let kind = "plain";
    if (
      text.startsWith("//", position) ||
      text.startsWith("/*", position) ||
      text.startsWith("<!--", position)
    ) {
      const closer = text.startsWith("//", position)
        ? -1
        : text.indexOf(markup ? "-->" : "*/", position + 2);
      position = closer < 0 ? text.length : closer + (markup ? 3 : 2);
      kind = "comment";
    } else if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      position++;
      while (position < text.length) {
        const value = text[position++];
        if (value === "\\") position++;
        else if (value === quote) break;
      }
      let next = position;
      while (next < text.length && /\s/.test(text[next]!)) next++;
      kind = text[next] === ":" ? "property" : "string";
    } else if (/[a-zA-Z_$]/.test(char)) {
      position++;
      while (position < text.length && /[a-zA-Z0-9_$-]/.test(text[position]!)) position++;
      const word = text.slice(start, position);
      let next = position;
      while (next < text.length && /\s/.test(text[next]!)) next++;
      kind = keywords.has(word)
        ? "keyword"
        : markup
          ? "tag"
          : text[next] === ":"
            ? "property"
            : text[next] === "("
              ? "function"
              : "plain";
    } else if (/[0-9]/.test(char)) {
      position++;
      while (position < text.length && /[0-9a-fA-F.xX_]/.test(text[position]!)) position++;
      kind = "number";
    } else {
      position++;
      if (/[{}[\]():;,<>]/.test(char)) kind = "punctuation";
    }
    tokens.push({ text: text.slice(start, Math.min(position, text.length)), kind });
  }
  return tokens;
}

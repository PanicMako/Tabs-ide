/** A Jupyter notebook reduced to what the preview shows. Never runs anything in it. */
export interface NotebookOutput {
  readonly kind: "text" | "image" | "error";
  /** Text for `text` and `error`; a base64 PNG or JPEG payload for `image`. */
  readonly value: string;
  readonly mimeType?: "image/png" | "image/jpeg";
}

export interface NotebookCell {
  readonly type: "markdown" | "code" | "raw";
  readonly source: string;
  readonly executionCount: number | null;
  readonly outputs: ReadonlyArray<NotebookOutput>;
}

export interface ParsedNotebook {
  readonly cells: ReadonlyArray<NotebookCell>;
  readonly language: string;
  readonly truncated: boolean;
}

export const NOTEBOOK_MAX_CELLS = 500;
const OUTPUT_TEXT_LIMIT = 20_000;
const BASE64 = /^[A-Za-z0-9+/=\s]+$/;

function joinLines(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((part) => typeof part === "string").join("");
  return "";
}

function clip(text: string): string {
  return text.length > OUTPUT_TEXT_LIMIT ? `${text.slice(0, OUTPUT_TEXT_LIMIT)}\n…` : text;
}

function parseOutput(raw: unknown): NotebookOutput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const output = raw as Record<string, unknown>;
  if (output.output_type === "stream") return { kind: "text", value: clip(joinLines(output.text)) };
  if (output.output_type === "error") {
    const traceback = Array.isArray(output.traceback) ? joinLines(output.traceback) : "";
    // Tracebacks carry terminal colour codes that would show up as noise.
    const plain = traceback.replace(/\u001b\[[0-9;]*m/g, "");
    return {
      kind: "error",
      value: clip(plain || `${String(output.ename ?? "Error")}: ${String(output.evalue ?? "")}`),
    };
  }
  const data = output.data;
  if (typeof data !== "object" || data === null) return null;
  const bundle = data as Record<string, unknown>;
  for (const mimeType of ["image/png", "image/jpeg"] as const) {
    const payload = joinLines(bundle[mimeType]);
    if (payload && BASE64.test(payload)) return { kind: "image", value: payload, mimeType };
  }
  const text = joinLines(bundle["text/plain"]);
  return text ? { kind: "text", value: clip(text) } : null;
}

/** Returns null when the text is not a notebook, so the caller can show it as source instead. */
export function parseNotebook(text: string): ParsedNotebook | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const notebook = json as { cells?: unknown; metadata?: { language_info?: { name?: unknown } } };
  if (!Array.isArray(notebook.cells)) return null;
  const language =
    typeof notebook.metadata?.language_info?.name === "string"
      ? notebook.metadata.language_info.name
      : "python";
  const cells: NotebookCell[] = [];
  for (const raw of notebook.cells.slice(0, NOTEBOOK_MAX_CELLS)) {
    if (typeof raw !== "object" || raw === null) continue;
    const cell = raw as Record<string, unknown>;
    const type =
      cell.cell_type === "markdown" ? "markdown" : cell.cell_type === "code" ? "code" : "raw";
    const outputs = Array.isArray(cell.outputs)
      ? cell.outputs.flatMap((entry) => {
          const parsed = parseOutput(entry);
          return parsed ? [parsed] : [];
        })
      : [];
    cells.push({
      type,
      source: joinLines(cell.source),
      executionCount: typeof cell.execution_count === "number" ? cell.execution_count : null,
      outputs,
    });
  }
  return { cells, language, truncated: notebook.cells.length > NOTEBOOK_MAX_CELLS };
}

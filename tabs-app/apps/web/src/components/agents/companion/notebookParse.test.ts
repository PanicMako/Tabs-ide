import { describe, expect, it } from "vitest";
import { NOTEBOOK_MAX_CELLS, parseNotebook } from "./notebookParse";

const notebook = (cells: unknown[], extra: object = {}) => JSON.stringify({ cells, ...extra });

describe("parseNotebook", () => {
  it("reads markdown and code cells, joining line arrays", () => {
    const parsed = parseNotebook(
      notebook(
        [
          { cell_type: "markdown", source: ["# Title\n", "text"] },
          { cell_type: "code", source: "print(1)", execution_count: 3, outputs: [] },
        ],
        { metadata: { language_info: { name: "julia" } } },
      ),
    );
    expect(parsed?.language).toBe("julia");
    expect(parsed?.cells.map((cell) => [cell.type, cell.source, cell.executionCount])).toEqual([
      ["markdown", "# Title\ntext", null],
      ["code", "print(1)", 3],
    ]);
  });

  it("reads stream, error and image outputs and strips terminal colours", () => {
    const parsed = parseNotebook(
      notebook([
        {
          cell_type: "code",
          source: "x",
          outputs: [
            { output_type: "stream", text: ["hello\n"] },
            {
              output_type: "error",
              ename: "ValueError",
              evalue: "bad",
              traceback: ["\u001b[31mTrace\u001b[0m"],
            },
            { output_type: "display_data", data: { "image/png": "aGVsbG8=" } },
            { output_type: "execute_result", data: { "text/plain": "42" } },
          ],
        },
      ]),
    );
    expect(parsed?.cells[0]?.outputs).toEqual([
      { kind: "text", value: "hello\n" },
      { kind: "error", value: "Trace" },
      { kind: "image", value: "aGVsbG8=", mimeType: "image/png" },
      { kind: "text", value: "42" },
    ]);
  });

  it("drops image data that is not base64", () => {
    const parsed = parseNotebook(
      notebook([
        {
          cell_type: "code",
          source: "",
          outputs: [{ output_type: "display_data", data: { "image/png": "<script>" } }],
        },
      ]),
    );
    expect(parsed?.cells[0]?.outputs).toEqual([]);
  });

  it("returns null for anything that is not a notebook", () => {
    expect(parseNotebook("not json")).toBeNull();
    expect(parseNotebook('{"hello": 1}')).toBeNull();
    expect(parseNotebook("[]")).toBeNull();
  });

  it("caps very long notebooks", () => {
    const cells = Array.from({ length: NOTEBOOK_MAX_CELLS + 5 }, () => ({
      cell_type: "raw",
      source: "x",
    }));
    const parsed = parseNotebook(notebook(cells));
    expect(parsed?.cells).toHaveLength(NOTEBOOK_MAX_CELLS);
    expect(parsed?.truncated).toBe(true);
  });
});

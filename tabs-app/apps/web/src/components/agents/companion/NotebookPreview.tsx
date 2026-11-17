import ChatMarkdown from "~/components/ChatMarkdown";
import { parseNotebook } from "./notebookParse";

/** Reads a notebook like a page: prose, code, and the outputs it was saved with. Nothing runs. */
export function NotebookPreview({ text, cwd }: { text: string; cwd?: string | undefined }) {
  const notebook = parseNotebook(text);
  if (!notebook) {
    return (
      <p className="companion-note">
        This file is not a notebook Tabs can read. Switch to Source to see its text.
      </p>
    );
  }
  if (notebook.cells.length === 0) return <p className="companion-note">This notebook is empty.</p>;
  return (
    <div className="companion-content flex flex-col gap-4" aria-label="Notebook">
      {notebook.cells.map((cell, index) => (
        <section key={index} className="min-w-0">
          {cell.type === "markdown" ? (
            <ChatMarkdown text={cell.source} cwd={cwd} />
          ) : (
            <div className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              <span className="pt-1 text-right font-mono text-[11px] text-muted-foreground">
                {cell.type === "code" ? `[${cell.executionCount ?? " "}]` : "raw"}
              </span>
              <pre className="min-w-0 overflow-x-auto whitespace-pre font-mono text-xs leading-5 text-foreground">
                {cell.source || " "}
              </pre>
              {cell.outputs.map((output, outputIndex) => (
                <div key={outputIndex} className="col-start-2 min-w-0">
                  {output.kind === "image" ? (
                    <img
                      alt={`Output ${outputIndex + 1} of cell ${index + 1}`}
                      className="max-h-96 max-w-full"
                      data-shape="tile"
                      src={`data:${output.mimeType};base64,${output.value.replace(/\s/g, "")}`}
                    />
                  ) : (
                    <pre
                      className={`min-w-0 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-5 ${
                        output.kind === "error" ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {output.value}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
      {notebook.truncated && (
        <p className="companion-note">
          Showing the first 500 cells. Switch to Source for the rest.
        </p>
      )}
    </div>
  );
}

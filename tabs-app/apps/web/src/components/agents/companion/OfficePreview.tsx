import { useEffect, useState } from "react";
import { readOfficeDocument, type OfficeDocument } from "./officeDocument";

type State = { readonly document: OfficeDocument } | { readonly error: string } | null;

/** Word, Excel and PowerPoint files shown as plain text and tables. Read-only, and nothing is saved. */
export function OfficePreview({ url, extension }: { url: string; extension: string }) {
  const [state, setState] = useState<State>(null);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("The file could not be loaded.");
        const document = await readOfficeDocument(await response.arrayBuffer(), extension);
        if (!cancelled) setState({ document });
      } catch (failure) {
        if (!cancelled) {
          setState({
            error: failure instanceof Error ? failure.message : "The file could not be read.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, extension]);

  if (!state) {
    return (
      <p role="status" className="companion-note">
        Reading the document…
      </p>
    );
  }
  if ("error" in state) {
    return (
      <p role="alert" className="companion-note">
        {state.error}
      </p>
    );
  }
  const { document } = state;
  if (document.kind === "document") {
    return (
      <div className="companion-content flex flex-col gap-3" aria-label="Document text">
        {document.paragraphs.map((text, index) => (
          <p key={index} className="m-0 whitespace-pre-wrap text-sm leading-6">
            {text || " "}
          </p>
        ))}
        {document.truncated && (
          <p className="companion-note">
            Showing the first 2,000 paragraphs. Open it in its own app for the rest.
          </p>
        )}
      </div>
    );
  }
  if (document.kind === "presentation") {
    return (
      <div className="companion-content flex flex-col gap-4" aria-label="Slides">
        {document.slides.map((lines, index) => (
          <section key={index} className="min-w-0">
            <h3 className="m-0 mb-1 text-xs font-medium text-muted-foreground">
              Slide {index + 1}
            </h3>
            {lines.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">No text on this slide.</p>
            ) : (
              lines.map((line, lineIndex) => (
                <p key={lineIndex} className="m-0 text-sm leading-6">
                  {line}
                </p>
              ))
            )}
          </section>
        ))}
      </div>
    );
  }
  return (
    <div className="companion-content flex flex-col gap-5" aria-label="Spreadsheet">
      {document.sheets.map((sheet) => (
        <section key={sheet.name} className="min-w-0">
          <h3 className="m-0 mb-1 text-xs font-medium text-muted-foreground">{sheet.name}</h3>
          <table className="companion-data-table">
            <tbody>
              {sheet.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell.slice(0, 2000)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {sheet.truncated && <p className="companion-note">Showing the first 200 rows.</p>}
        </section>
      ))}
    </div>
  );
}

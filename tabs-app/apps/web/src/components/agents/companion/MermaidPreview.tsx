import { useEffect, useId, useState } from "react";

type Rendered = { readonly svg: string } | { readonly error: string };

/** Draws a Mermaid diagram. Mermaid is loaded on first use, so it costs nothing until a diagram opens. */
export function MermaidPreview({ text, dark }: { text: string; dark: boolean }) {
  const id = `mermaid-${useId().replaceAll(":", "")}`;
  const [rendered, setRendered] = useState<Rendered | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRendered(null);
    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        // "strict" keeps scripts and links in the diagram text from running or being clickable.
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
        });
        const { svg } = await mermaid.render(id, text);
        if (!cancelled) setRendered({ svg });
      } catch (failure) {
        if (!cancelled) {
          setRendered({
            error: failure instanceof Error ? failure.message.split("\n")[0]! : "Unknown error",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [text, dark, id]);

  if (!rendered) {
    return (
      <p role="status" className="companion-note">
        Drawing the diagram…
      </p>
    );
  }
  if ("error" in rendered) {
    return (
      <p role="alert" className="companion-note">
        This diagram could not be drawn ({rendered.error}). Switch to Source to fix the text.
      </p>
    );
  }
  return (
    <div
      className="companion-content flex justify-center overflow-auto"
      role="img"
      aria-label="Mermaid diagram"
      dangerouslySetInnerHTML={{ __html: rendered.svg }}
    />
  );
}

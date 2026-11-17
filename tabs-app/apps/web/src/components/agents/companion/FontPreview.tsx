import { useEffect, useState } from "react";

const SAMPLE_SIZES = [12, 18, 28, 44] as const;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 !?&@#%*()";

/** Loads the font file under a private name and shows it at several sizes. */
export function FontPreview({ url, name }: { url: string; name: string }) {
  const [state, setState] = useState<{ family: string } | { error: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const family = `tabs-preview-${Math.random().toString(36).slice(2)}`;
    const face = new FontFace(family, `url(${JSON.stringify(url)})`);
    setState(null);
    face
      .load()
      .then((loaded) => {
        if (cancelled) return;
        document.fonts.add(loaded);
        setState({ family });
      })
      .catch(() => {
        if (!cancelled) setState({ error: "This font file could not be loaded." });
      });
    return () => {
      cancelled = true;
      document.fonts.delete(face);
    };
  }, [url]);
  if (!state)
    return (
      <p role="status" className="companion-note">
        Loading {name}…
      </p>
    );
  if ("error" in state)
    return (
      <p role="alert" className="companion-note">
        {state.error}
      </p>
    );
  return (
    <div className="companion-content flex flex-col gap-5" aria-label={`Preview of ${name}`}>
      {SAMPLE_SIZES.map((size) => (
        <p
          key={size}
          className="m-0 break-words text-foreground"
          style={{ fontFamily: `"${state.family}"`, fontSize: size, lineHeight: 1.3 }}
        >
          {size === 44 ? "Aa Gg Rr 123" : ALPHABET}
        </p>
      ))}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  getTourMascotBounds,
  isTourMascotArtwork,
  moveTourMascot,
  readTourMascotInput,
  tourMascotHtml,
  type TourMascotPosition,
} from "@tabs/shared/tourMascot";

const POSITION_KEY = "tabs:tour-mascot-position:v1";
const DEFAULT_POSITION = { x: 1, y: 1 };

function readPosition(): TourMascotPosition {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null");
    if (
      typeof saved?.x === "number" &&
      typeof saved?.y === "number" &&
      saved.x >= 0 &&
      saved.x <= 1 &&
      saved.y >= 0 &&
      saved.y <= 1
    )
      return saved;
  } catch {}
  return DEFAULT_POSITION;
}

function savePosition(position: TourMascotPosition) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  } catch {}
}

let artworkRequest: Promise<string> | undefined;

function loadAfterglow(): Promise<string> {
  artworkRequest ??= fetch("/brand/blue-ink-master.png")
    .then(async (response) => {
      if (!response.ok) throw new Error("Afterglow artwork unavailable");
      const blob = await response.blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (isTourMascotArtwork(reader.result)) resolve(reader.result);
          else reject(new Error("Invalid Afterglow artwork"));
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    })
    .catch((error: unknown) => {
      artworkRequest = undefined;
      throw error;
    });
  return artworkRequest;
}

export function WorkspaceTourMascot({ onResume }: { readonly onResume: () => void }) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const position = useRef<TourMascotPosition>(readPosition());
  const [bounds, setBounds] = useState(() =>
    getTourMascotBounds(
      position.current,
      typeof innerWidth === "number" ? innerWidth : 0,
      typeof innerHeight === "number" ? innerHeight : 0,
    ),
  );
  const [native, setNative] = useState(false);
  const [artwork, setArtwork] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void loadAfterglow()
      .then((image) => {
        if (mounted) setArtwork(image);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReducedMotion(
        preference.matches || document.documentElement.dataset.reducedMotion === "reduce",
      );
      setDark(document.documentElement.classList.contains("dark"));
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-reduced-motion"],
    });
    preference.addEventListener("change", update);
    update();
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!artwork || !bridge?.syncTourMascot || !bridge.onTourMascotEvent) return;
    let mounted = true;
    const unsubscribe = bridge.onTourMascotEvent((event) => {
      if (event.type === "resume") onResume();
      else {
        position.current = event.position;
        savePosition(event.position);
      }
    });
    void bridge
      .syncTourMascot({ position: position.current, reducedMotion, artwork, dark })
      .then((shown) => {
        if (mounted) setNative(shown);
      })
      .catch(() => {
        if (mounted) setNative(false);
      });
    return () => {
      mounted = false;
      unsubscribe();
      void bridge.syncTourMascot?.(null).catch(() => undefined);
    };
  }, [artwork, onResume, reducedMotion, dark]);

  useEffect(() => {
    const place = () => setBounds(getTourMascotBounds(position.current, innerWidth, innerHeight));
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== iframe.current?.contentWindow) return;
      const input = readTourMascotInput(event.data);
      if (!input) return;
      if (input.type === "resume") {
        onResume();
        return;
      }
      position.current = moveTourMascot(position.current, input, innerWidth, innerHeight);
      place();
      if (input.type === "corner" || input.done) savePosition(position.current);
    };
    window.addEventListener("resize", place);
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("message", receive);
    };
  }, [onResume]);

  return !artwork || native ? (
    <button
      type="button"
      className={
        artwork
          ? "sr-only focus-visible:not-sr-only workspace-tour-keyboard-resume"
          : "workspace-tour-keyboard-resume workspace-tour-text-resume"
      }
      onClick={onResume}
    >
      Resume workspace tour
    </button>
  ) : (
    <iframe
      ref={iframe}
      className="workspace-tour-mascot"
      title="Resume workspace tour"
      sandbox="allow-scripts"
      srcDoc={tourMascotHtml(reducedMotion, artwork, dark)}
      style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
    />
  );
}

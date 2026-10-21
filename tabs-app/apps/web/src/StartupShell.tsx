import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { SplashScreen } from "./components/SplashScreen";
import { readFirstPaintSplashSettings } from "./startupSplashSettings";
import {
  getStartupSplashState,
  subscribeStartupSplash,
  updateStartupSplash,
} from "./lib/startupSplashLifecycle";
import { useStartupAnimation } from "./hooks/useStartupAnimation";
import { markStartupStage } from "./lib/startupReadiness";

/** Keep the original animation mounted while the workspace module graph loads. */
export function StartupShell({ loadApplication }: { loadApplication: () => Promise<ReactNode> }) {
  const [application, setApplication] = useState<ReactNode>(null);
  const [visible, setVisible] = useState(true);
  const [settings] = useState(() => readFirstPaintSplashSettings(window.localStorage));
  const state = useSyncExternalStore(subscribeStartupSplash, getStartupSplashState);
  const transition = useStartupAnimation(state.ready, settings.loader);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      // Yield a paint before parsing the workspace, rather than spending the
      // first visible frame on its imports. This is not an animation hold.
      task = setTimeout(() => {
        markStartupStage("splash-first-paint");
        window.desktopBridge?.notifyStartupPaint?.();
        void loadApplication().then(
          (app) => {
            if (!cancelled) setApplication(app);
          },
          (error) => {
            if (cancelled) return;
            console.error("[tabs:startup]", error);
            updateStartupSplash({ error: "Tabs could not start. Reload the window to try again." });
          },
        );
      }, 0);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(task);
    };
  }, [loadApplication]);

  useEffect(() => {
    if (!application) return;
    markStartupStage("renderer-hydration");
    const frame = requestAnimationFrame(() => markStartupStage("shell-first-paint"));
    return () => cancelAnimationFrame(frame);
  }, [application]);

  useEffect(() => {
    if (!transition.ready) return;
    const timer = setTimeout(() => {
      setVisible(false);
      updateStartupSplash({ dismissed: true });
    }, transition.exitMs);
    return () => clearTimeout(timer);
  }, [transition.ready, transition.exitMs]);

  return (
    <>
      {visible && (
        <div
          role="status"
          aria-label="Starting Tabs"
          aria-hidden={transition.ready || undefined}
          className={`fixed inset-0 z-[9999] bg-background transition-transform duration-500 ease-in-out motion-reduce:duration-0 ${transition.ready ? "pointer-events-none -translate-y-full" : "pointer-events-auto translate-y-0"}`}
        >
          <SplashScreen {...settings} />
          {state.error ? (
            <div
              className="absolute inset-x-4 bottom-8 mx-auto max-w-2xl rounded-lg border bg-background p-5 text-sm shadow-lg"
              role="alert"
            >
              <h1 className="mb-2 font-semibold">Tabs could not open your workspace</h1>
              <p className="whitespace-pre-wrap text-muted-foreground">{state.error}</p>
            </div>
          ) : state.delayed ? (
            <p
              className="absolute inset-x-0 bottom-8 text-center text-xs text-muted-foreground"
              role="status"
            >
              Still connecting to your workspace. Your saved projects will appear when loading
              finishes.
            </p>
          ) : null}
        </div>
      )}
      {application}
    </>
  );
}

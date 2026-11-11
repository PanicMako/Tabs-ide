import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
import { startupExitBeatMs, startupExitStyle } from "./lib/startupAnimationTiming";
import { SplashScreen } from "./components/SplashScreen";
import { STARTUP_RISE_LAYER_CLASS, StartupCurtain } from "./components/StartupCurtain";
import { readFirstPaintSplashSettings } from "./startupSplashSettings";
import {
  getStartupSplashState,
  subscribeStartupSplash,
  updateStartupSplash,
} from "./lib/startupSplashLifecycle";
import { useStartupAnimation } from "./hooks/useStartupAnimation";
import { markStartupStage } from "./lib/startupReadiness";

const DataRecoverySettings = lazy(() => import("./components/settings/DataRecoverySettings"));

/** Keep the original animation mounted while the workspace module graph loads. */
export function StartupShell({ loadApplication }: { loadApplication: () => Promise<ReactNode> }) {
  const [application, setApplication] = useState<ReactNode>(null);
  const [visible, setVisible] = useState(true);
  const [settings] = useState(() => readFirstPaintSplashSettings(window.localStorage));
  const state = useSyncExternalStore(subscribeStartupSplash, getStartupSplashState);
  const transition = useStartupAnimation(state.ready, settings.loader);
  const workspaceRef = useRef<HTMLDivElement>(null);

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

  const leaving = transition.ready && !!application;

  return (
    <>
      {visible && (
        <StartupCurtain
          leaving={leaving}
          durationMs={transition.exitMs}
          beatMs={transition.exitMs > 0 ? startupExitBeatMs(settings.loader) : 0}
          exit={startupExitStyle(settings.loader)}
          riseRef={workspaceRef}
          ariaHidden={leaving}
          onLeft={() => {
            setVisible(false);
            updateStartupSplash({ dismissed: true });
          }}
        >
          <SplashScreen {...settings} />
          {state.error ? (
            <div
              className="absolute inset-x-4 top-8 bottom-8 mx-auto max-w-2xl overflow-y-auto rounded-lg border bg-background p-5 text-sm"
              role="alert"
            >
              <h1 className="mb-2 font-semibold">Tabs could not open your workspace</h1>
              <p className="whitespace-pre-wrap text-muted-foreground">{state.error}</p>
              <Suspense fallback={null}>
                <DataRecoverySettings />
              </Suspense>
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
        </StartupCurtain>
      )}
      {/* Layout-neutral except while it carries the workspace up over the splash. */}
      <div ref={workspaceRef} className={STARTUP_RISE_LAYER_CLASS}>
        {application}
      </div>
    </>
  );
}

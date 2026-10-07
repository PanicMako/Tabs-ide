import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCcw } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export interface CompanionBrowserPanelProps {
  initialUrl?: string;
}

const COMMON_DEV_PORTS = [
  { label: ":3000", url: "http://localhost:3000" },
  { label: ":5173", url: "http://localhost:5173" },
  { label: ":8080", url: "http://localhost:8080" },
  { label: ":4321", url: "http://localhost:4321" },
];

export const CompanionBrowserPanel = memo(function CompanionBrowserPanel({
  initialUrl = "http://localhost:3000",
}: CompanionBrowserPanelProps) {
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [history, setHistory] = useState<string[]>([initialUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [key, setKey] = useState(0);

  const navigateTo = useCallback(
    (targetUrl: string) => {
      let normalized = targetUrl.trim();
      if (!normalized) return;
      if (!/^https?:\/\//i.test(normalized)) {
        normalized = `http://${normalized}`;
      }
      setCurrentUrl(normalized);
      setInputUrl(normalized);
      setHistory((prev) => [...prev.slice(0, historyIndex + 1), normalized]);
      setHistoryIndex((prev) => prev + 1);
      setKey((prev) => prev + 1);
    },
    [historyIndex],
  );

  const handleBack = useCallback(() => {
    if (historyIndex > 0) {
      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      const url = history[nextIndex] ?? "";
      setCurrentUrl(url);
      setInputUrl(url);
      setKey((prev) => prev + 1);
    }
  }, [history, historyIndex]);

  const handleForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      const url = history[nextIndex] ?? "";
      setCurrentUrl(url);
      setInputUrl(url);
      setKey((prev) => prev + 1);
    }
  }, [history, historyIndex]);

  const handleReload = useCallback(() => {
    setKey((prev) => prev + 1);
  }, []);

  const handleOpenExternal = useCallback(() => {
    if (window.desktopBridge?.openExternal) {
      void window.desktopBridge.openExternal(currentUrl);
    } else {
      window.open(currentUrl, "_blank", "noopener,noreferrer");
    }
  }, [currentUrl]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      navigateTo(inputUrl);
    },
    [inputUrl, navigateTo],
  );

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-background text-foreground">
      {/* Navigation Bar */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/70 bg-muted/30 px-2 py-1.5">
        <button
          type="button"
          onClick={handleBack}
          disabled={historyIndex <= 0}
          aria-label="Back"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleForward}
          disabled={historyIndex >= history.length - 1}
          aria-label="Forward"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
        >
          <ArrowRight className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleReload}
          aria-label="Reload"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RotateCcw className="size-3.5" />
        </button>

        {/* Address Input */}
        <form onSubmit={handleSubmit} className="flex min-w-0 flex-1 items-center gap-1">
          <div className="relative flex min-w-0 flex-1 items-center">
            <Globe className="pointer-events-none absolute left-2 size-3 text-muted-foreground" />
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              className="h-7 w-full rounded-md border border-border/80 bg-background/80 pl-6.5 pr-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-hidden"
              placeholder="http://localhost:3000"
            />
          </div>
        </form>

        <button
          type="button"
          onClick={handleOpenExternal}
          aria-label="Open in external browser"
          title="Open in external browser"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </button>
      </div>

      {/* Quick Local Presets */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border/50 bg-muted/15 px-2 py-1 overflow-x-auto text-[11px]">
        <span className="text-muted-foreground shrink-0 text-[10px] uppercase font-semibold tracking-wider">
          Ports:
        </span>
        {COMMON_DEV_PORTS.map((preset) => (
          <button
            key={preset.url}
            type="button"
            onClick={() => navigateTo(preset.url)}
            className={cn(
              "rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors cursor-pointer",
              currentUrl === preset.url
                ? "bg-primary text-primary-foreground font-semibold"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Embedded Web View Frame */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden bg-white dark:bg-zinc-950">
        <iframe
          key={key}
          src={currentUrl}
          title="Companion Browser"
          className="h-full w-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      </div>
    </div>
  );
});

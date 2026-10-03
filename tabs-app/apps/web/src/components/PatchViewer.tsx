import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import { useMemo } from "react";
import { cn } from "~/lib/utils";
import { resolveDiffThemeName } from "../lib/diffRendering";
import {
  buildFileDiffRenderKey,
  getRenderablePatch,
  resolveFileDiffPath,
} from "../lib/patchParsing";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";
import { useTheme } from "../hooks/useTheme";

const PATCH_VIEWER_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 90%, var(--foreground));

  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 92%, var(--diff-addition, var(--success)));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 88%, var(--diff-addition, var(--success)));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--background) 85%, var(--diff-addition, var(--success)));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 80%, var(--diff-addition, var(--success)));

  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 92%, var(--diff-deletion, var(--destructive)));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 88%, var(--diff-deletion, var(--destructive)));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--background) 85%, var(--diff-deletion, var(--destructive)));
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--background) 80%,
    var(--diff-deletion, var(--destructive))
  );

  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-bottom: 1px solid var(--border) !important;
}
`;

function PatchViewerContent(props: {
  patch: string;
  emptyLabel?: string | undefined;
  onOpenFile?: ((path: string) => void | Promise<void>) | undefined;
}) {
  const { resolvedTheme } = useTheme();
  const renderablePatch = useMemo(
    () => getRenderablePatch(props.patch, `git-patch:${resolvedTheme}`),
    [props.patch, resolvedTheme],
  );

  if (!renderablePatch) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-6 text-xs text-muted-foreground/70">
        {props.emptyLabel ?? "No patch available for this selection."}
      </div>
    );
  }

  if (renderablePatch.kind === "raw") {
    return (
      <div className="h-full overflow-auto p-3">
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
          <pre className="rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90 whitespace-pre-wrap break-all">
            {renderablePatch.text}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <Virtualizer
      className="h-full min-h-0 overflow-auto px-2 pb-2"
      config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
    >
      {renderablePatch.files.map((fileDiff) => {
        const filePath = resolveFileDiffPath(fileDiff);
        const fileKey = `${buildFileDiffRenderKey(fileDiff)}:${resolvedTheme}`;
        return (
          <div
            key={fileKey}
            className="mb-2 rounded-md first:mt-2 last:mb-0"
            onClickCapture={(event) => {
              const nativeEvent = event.nativeEvent as MouseEvent;
              const composedPath = nativeEvent.composedPath?.() ?? [];
              const clickedHeader = composedPath.some((node) => {
                if (!(node instanceof Element)) return false;
                return node.hasAttribute("data-title");
              });
              if (!clickedHeader || !props.onOpenFile) return;
              props.onOpenFile(filePath);
            }}
          >
            <FileDiff
              fileDiff={fileDiff}
              options={{
                diffStyle: "unified",
                lineDiffType: "none",
                overflow: "wrap",
                theme: resolveDiffThemeName(resolvedTheme),
                themeType: resolvedTheme as "light" | "dark",
                unsafeCSS: PATCH_VIEWER_UNSAFE_CSS,
              }}
            />
          </div>
        );
      })}
    </Virtualizer>
  );
}

export function PatchViewer(props: {
  patch: string;
  className?: string | undefined;
  emptyLabel?: string | undefined;
  onOpenFile?: ((path: string) => void | Promise<void>) | undefined;
}) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-hidden", props.className)}>
      <DiffWorkerPoolProvider>
        <PatchViewerContent {...props} />
      </DiffWorkerPoolProvider>
    </div>
  );
}

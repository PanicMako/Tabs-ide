import { DiffsHighlighter, getSharedHighlighter, SupportedLanguages } from "@pierre/diffs";
import {
  CheckIcon,
  CopyIcon,
  InfoIcon,
  LightbulbIcon,
  Maximize2Icon,
  MessageSquareWarningIcon,
  OctagonAlertIcon,
  TriangleAlertIcon,
  WrapTextIcon,
} from "lucide-react";
import React, {
  Children,
  Suspense,
  isValidElement,
  use,
  useCallback,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "~/components/ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { openInPreferredEditor } from "../editorPreferences";
import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";
import { fnv1a32 } from "../lib/diffRendering";
import { createIncrementalHighlightedDocument } from "../lib/incrementalHighlighting";
import { LRUCache } from "../lib/lruCache";
import { useTheme } from "../hooks/useTheme";
import { remarkGithubAlerts } from "../markdown-github-alerts";
import { createIncrementalMarkdownPlugin } from "../markdown-incremental";
import { resolveMarkdownFileLinkTarget } from "../markdown-links";
import { readNativeApi } from "../nativeApi";
import { useSettings } from "../hooks/useSettings";
import { useWorkspaceActiveProjectId } from "../state/workspaceShell";
import { openLinkInIntegratedBrowser, resolveBrowserLinkTarget } from "../browserLinkTarget";
import { HighlightedCodeLines, toHtml } from "./chat/HighlightedCodeLines";
import { basenameOfPath } from "~/vscode-icons";
import { CHAT_FILE_TAG_CHIP_CLASS_NAME, FileTagChipContent } from "./chat/FileTagChip";

class CodeHighlightErrorBoundary extends React.Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  isStreaming?: boolean;
}

const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;
const MAX_HIGHLIGHT_CACHE_ENTRIES = 500;
const MAX_HIGHLIGHT_CACHE_MEMORY_BYTES = 50 * 1024 * 1024;
const highlightedCodeCache = new LRUCache<string>(
  MAX_HIGHLIGHT_CACHE_ENTRIES,
  MAX_HIGHLIGHT_CACHE_MEMORY_BYTES,
);
const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

/** GitHub alert presentations: note, tip, important, warning, caution */
const GITHUB_ALERT_PRESENTATIONS: Record<
  string,
  { label: string; Icon: typeof InfoIcon; borderClassName: string; titleClassName: string }
> = {
  note: {
    label: "Note",
    Icon: InfoIcon,
    borderClassName: "border-blue-500/70",
    titleClassName: "text-blue-600 dark:text-blue-400",
  },
  tip: {
    label: "Tip",
    Icon: LightbulbIcon,
    borderClassName: "border-emerald-500/70",
    titleClassName: "text-emerald-600 dark:text-emerald-400",
  },
  important: {
    label: "Important",
    Icon: MessageSquareWarningIcon,
    borderClassName: "border-purple-500/70",
    titleClassName: "text-purple-600 dark:text-purple-400",
  },
  warning: {
    label: "Warning",
    Icon: TriangleAlertIcon,
    borderClassName: "border-amber-500/70",
    titleClassName: "text-amber-600 dark:text-amber-500",
  },
  caution: {
    label: "Caution",
    Icon: OctagonAlertIcon,
    borderClassName: "border-red-500/70",
    titleClassName: "text-red-600 dark:text-red-400",
  },
};

function extractFenceLanguage(className: string | undefined): string {
  const match = className?.match(CODE_FENCE_LANGUAGE_REGEX);
  const raw = match?.[1] ?? "text";
  // Shiki doesn't bundle a gitignore grammar; ini is a close match (#685)
  return raw === "gitignore" ? "ini" : raw;
}

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeToPlainText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToPlainText(node.props.children);
  }
  return "";
}

function extractCodeBlock(
  children: ReactNode,
): { className: string | undefined; code: string } | null {
  const childNodes = Children.toArray(children);
  if (childNodes.length !== 1) {
    return null;
  }

  const onlyChild = childNodes[0];
  if (
    !isValidElement<{ className?: string; children?: ReactNode }>(onlyChild) ||
    onlyChild.type !== "code"
  ) {
    return null;
  }

  return {
    className: onlyChild.props.className,
    code: nodeToPlainText(onlyChild.props.children),
  };
}

function createHighlightCacheKey(code: string, language: string, themeName: DiffThemeName): string {
  return `${fnv1a32(code).toString(36)}:${code.length}:${language}:${themeName}`;
}

function estimateHighlightedSize(html: string, code: string): number {
  return Math.max(html.length * 2, code.length * 3);
}

function getHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  const promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "shiki-js",
  }).catch((err) => {
    highlighterPromiseCache.delete(language);
    if (language === "text") {
      // "text" itself failed — Shiki cannot initialize at all, surface the error
      throw err;
    }
    // Language not supported by Shiki — fall back to "text"
    return getHighlighterPromise("text");
  });
  highlighterPromiseCache.set(language, promise);
  return promise;
}

function MarkdownCodeBlock({
  code,
  language,
  children,
}: {
  code: string;
  language?: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [wrapped, setWrapped] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 2000);
      })
      .catch(() => undefined);
  }, [code]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  const displayLanguage = language && language !== "text" ? language : "";
  const wrapLabel = wrapped ? "Disable line wrap" : "Wrap lines";
  const copyLabel = copied ? "Copied" : "Copy code";
  const maximizeLabel = "Maximize code block";

  return (
    <>
      <div
        className="chat-markdown-codeblock"
        data-language={displayLanguage || undefined}
        data-wrap={wrapped ? "true" : "false"}
      >
        <div className="chat-markdown-codeblock-header select-none">
          <span className="chat-markdown-codeblock-title">
            {displayLanguage && <span>{displayLanguage}</span>}
          </span>
          <div className="flex items-center gap-1" role="toolbar" aria-label="Code block actions">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="chat-markdown-chrome-action"
                    aria-pressed={wrapped}
                    onClick={() => setWrapped((val) => !val)}
                    aria-label={wrapLabel}
                  />
                }
              >
                <WrapTextIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">{wrapLabel}</TooltipPopup>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="chat-markdown-chrome-action"
                    onClick={() => setIsMaximized(true)}
                    aria-label={maximizeLabel}
                  />
                }
              >
                <Maximize2Icon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">{maximizeLabel}</TooltipPopup>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="chat-markdown-chrome-action"
                    onClick={handleCopy}
                    aria-label={copyLabel}
                  />
                }
              >
                {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
              </TooltipTrigger>
              <TooltipPopup side="top">{copyLabel}</TooltipPopup>
            </Tooltip>
          </div>
        </div>
        {children}
      </div>

      <Dialog open={isMaximized} onOpenChange={setIsMaximized}>
        <DialogPopup className="max-w-4xl w-[90vw] max-h-[85vh] flex flex-col p-4 sm:p-6">
          <DialogHeader className="p-0 pb-3 flex flex-row items-center justify-between">
            <DialogTitle className="text-sm font-mono">{displayLanguage || "Code"}</DialogTitle>
            <div className="flex items-center gap-1 pr-8">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="chat-markdown-chrome-action"
                aria-pressed={wrapped}
                onClick={() => setWrapped((val) => !val)}
                aria-label={wrapLabel}
              >
                <WrapTextIcon className="size-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="chat-markdown-chrome-action"
                onClick={handleCopy}
                aria-label={copyLabel}
              >
                {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
              </Button>
            </div>
          </DialogHeader>
          <div
            data-wrap={wrapped ? "true" : "false"}
            className="chat-markdown-codeblock flex-1 overflow-auto rounded-md border border-border/70 bg-background/50 p-3"
          >
            {children}
          </div>
        </DialogPopup>
      </Dialog>
    </>
  );
}

interface SuspenseShikiCodeBlockProps {
  className: string | undefined;
  code: string;
  themeName: DiffThemeName;
  isStreaming: boolean;
}

interface UncachedShikiCodeBlockProps {
  code: string;
  language: string;
  themeName: DiffThemeName;
  cacheKey: string;
  isStreaming: boolean;
  preserveLines: boolean;
}

function UncachedShikiCodeBlock({
  code,
  language,
  themeName,
  cacheKey,
  isStreaming,
  preserveLines,
}: UncachedShikiCodeBlockProps) {
  const highlighter = use(getHighlighterPromise(language));
  const incrementalHighlight = useMemo(
    () =>
      preserveLines ? createIncrementalHighlightedDocument(highlighter, language, themeName) : null,
    [highlighter, preserveLines, language, themeName],
  );
  const highlighted = useMemo(() => {
    try {
      if (incrementalHighlight) return incrementalHighlight(code);
      return preserveLines
        ? highlighter.codeToHast(code, { lang: language, theme: themeName })
        : highlighter.codeToHtml(code, { lang: language, theme: themeName });
    } catch (error) {
      // Log highlighting failures for debugging while falling back to plain text
      console.warn(
        `Code highlighting failed for language "${language}", falling back to plain text.`,
        error instanceof Error ? error.message : error,
      );
      // If highlighting fails for this language, render as plain text
      return preserveLines
        ? highlighter.codeToHast(code, { lang: "text", theme: themeName })
        : highlighter.codeToHtml(code, { lang: "text", theme: themeName });
    }
  }, [code, highlighter, incrementalHighlight, language, preserveLines, themeName]);

  useEffect(() => {
    if (!isStreaming) {
      const highlightedHtml = typeof highlighted === "string" ? highlighted : toHtml(highlighted);
      highlightedCodeCache.set(
        cacheKey,
        highlightedHtml,
        estimateHighlightedSize(highlightedHtml, code),
      );
    }
  }, [cacheKey, code, highlighted, isStreaming]);

  return typeof highlighted === "string" ? (
    <div className="chat-markdown-shiki" dangerouslySetInnerHTML={{ __html: highlighted }} />
  ) : (
    <div className="chat-markdown-shiki">
      <HighlightedCodeLines root={highlighted} />
    </div>
  );
}

function SuspenseShikiCodeBlock({
  className,
  code,
  themeName,
  isStreaming,
}: SuspenseShikiCodeBlockProps) {
  const [hasStreamed, setHasStreamed] = useState(isStreaming);
  if (isStreaming && !hasStreamed) setHasStreamed(true);
  const language = extractFenceLanguage(className);
  const cacheKey = createHighlightCacheKey(code, language, themeName);
  // Once lines are mounted individually, keep that renderer when streaming
  // finishes so switching to cached HTML cannot clear an existing selection.
  const cachedHighlightedHtml =
    !isStreaming && !hasStreamed ? highlightedCodeCache.get(cacheKey) : null;

  if (cachedHighlightedHtml != null) {
    return (
      <div
        className="chat-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: cachedHighlightedHtml }}
      />
    );
  }

  return (
    <UncachedShikiCodeBlock
      code={code}
      language={language}
      themeName={themeName}
      cacheKey={cacheKey}
      isStreaming={isStreaming}
      preserveLines={isStreaming || hasStreamed}
    />
  );
}

function ChatMarkdown({ text, cwd, isStreaming = false }: ChatMarkdownProps) {
  const { resolvedTheme } = useTheme();
  const browserLinkTarget = useSettings((settings) => settings.browserLinkTarget);
  const activeProjectId = useWorkspaceActiveProjectId();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const markdownComponents = useMemo<Components>(
    () => ({
      blockquote({ node: _node, children, ...props }) {
        const alertType = String(
          (props as Record<string, unknown>)["data-alert"] ??
            (props as Record<string, unknown>)["dataAlert"] ??
            "",
        );
        const alert = GITHUB_ALERT_PRESENTATIONS[alertType];
        if (!alert) {
          return <blockquote {...props}>{children}</blockquote>;
        }
        return (
          <div
            role="note"
            className={cn(
              "my-2 rounded-r-md border-l-2 pl-3 py-1.5 bg-muted/30 text-foreground/90",
              alert.borderClassName,
            )}
          >
            <p
              className={cn(
                "flex items-center gap-1.5 font-medium text-xs mb-1",
                alert.titleClassName,
              )}
            >
              <alert.Icon aria-hidden className="size-3.5 shrink-0" />
              {alert.label}
            </p>
            <div className="[&>p:first-child]:mt-0 [&>p:last-child]:mb-0">{children}</div>
          </div>
        );
      },
      a({ node: _node, href, children, ...props }) {
        const targetPath = resolveMarkdownFileLinkTarget(href, cwd);
        if (!targetPath) {
          return (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (!href) return;
                const target = resolveBrowserLinkTarget({
                  url: href,
                  preference: browserLinkTarget,
                  projectId: activeProjectId,
                  metaKey: event.metaKey,
                  ctrlKey: event.ctrlKey,
                });
                if (target !== "app" || !activeProjectId) return;
                event.preventDefault();
                event.stopPropagation();
                openLinkInIntegratedBrowser(activeProjectId, href);
              }}
            >
              {children}
            </a>
          );
        }

        const label =
          typeof children === "string" && children.trim().length > 0
            ? children.trim()
            : basenameOfPath(targetPath);
        const theme = resolvedTheme === "light" ? "light" : "dark";

        return (
          <Tooltip>
            <TooltipTrigger
              render={
                <a
                  {...props}
                  href={href}
                  className={cn(
                    CHAT_FILE_TAG_CHIP_CLASS_NAME,
                    "cursor-pointer no-underline select-text inline-flex",
                    props.className,
                  )}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const api = readNativeApi();
                    if (api) {
                      void openInPreferredEditor(api, targetPath);
                    } else {
                      console.warn("Native API not found. Unable to open file in editor.");
                    }
                  }}
                >
                  <FileTagChipContent path={targetPath} label={label} theme={theme} selectable />
                </a>
              }
            />
            <TooltipPopup
              side="top"
              className="max-w-[min(40rem,calc(100vw-2rem))] font-mono text-[11px] leading-tight"
            >
              <div className="overflow-x-auto whitespace-nowrap [scrollbar-color:color-mix(in_srgb,var(--contrast-border)_78%,transparent)_transparent] [scrollbar-width:thin]">
                {targetPath}
              </div>
            </TooltipPopup>
          </Tooltip>
        );
      },
      pre({ node: _node, children, ...props }) {
        const codeBlock = extractCodeBlock(children);
        if (!codeBlock) {
          return <pre {...props}>{children}</pre>;
        }

        const language = extractFenceLanguage(codeBlock.className);

        return (
          <MarkdownCodeBlock code={codeBlock.code} language={language}>
            <CodeHighlightErrorBoundary fallback={<pre {...props}>{children}</pre>}>
              <Suspense fallback={<pre {...props}>{children}</pre>}>
                <SuspenseShikiCodeBlock
                  className={codeBlock.className}
                  code={codeBlock.code}
                  themeName={diffThemeName}
                  isStreaming={isStreaming}
                />
              </Suspense>
            </CodeHighlightErrorBoundary>
          </MarkdownCodeBlock>
        );
      },
    }),
    [activeProjectId, browserLinkTarget, cwd, diffThemeName, isStreaming, resolvedTheme],
  );

  const incrementalParsing = isStreaming === true && /(?:^|\n) {0,3}(?:`{3}|~{3})/.test(text);

  const remarkPlugins = useMemo(
    () => [
      remarkGfm,
      remarkGithubAlerts,
      ...(incrementalParsing ? [createIncrementalMarkdownPlugin()] : []),
    ],
    [incrementalParsing],
  );

  return (
    <div className="chat-markdown w-full min-w-0 text-sm leading-relaxed text-foreground/80">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ChatMarkdown);

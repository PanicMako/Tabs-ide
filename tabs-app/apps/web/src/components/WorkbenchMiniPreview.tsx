import React, { useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  FileCode,
  FileText,
  Folder,
  GitBranch,
  Layers,
  LayoutGrid,
  MessageSquare,
  MoreHorizontal,
  Search,
  Send,
  Settings,
  Wand2,
  Wrench,
  X,
} from "lucide-react";
import {
  evaluateThemeTokens,
  runThemeWcagCheck,
  type CustomThemeConfig,
} from "@tabs/shared/themeDerivation";

interface WorkbenchMiniPreviewProps {
  config: CustomThemeConfig;
}

type PreviewSurfaceMode = "ide" | "chat" | "tokens";

export const WorkbenchMiniPreview: React.FC<WorkbenchMiniPreviewProps> = ({ config }) => {
  const [surfaceMode, setSurfaceMode] = useState<PreviewSurfaceMode>("ide");
  const tokens = evaluateThemeTokens(config);
  const wcagResults = runThemeWcagCheck(config);

  const titleBg = tokens["titleBar.activeBackground"] || config.colors.background;
  const titleFg = tokens["titleBar.activeForeground"] || config.colors.foreground;
  const titleBorder = tokens["titleBar.border"] || config.colors.border;

  const sideBg = tokens["sideBar.background"] || config.colors.card;
  const sideFg = tokens["sideBar.foreground"] || config.colors.foreground;
  const sideBorder = tokens["sideBar.border"] || config.colors.border;
  const headerBg = tokens["sideBarSectionHeader.background"] || config.colors.card;

  const tabHeaderBg = tokens["editorGroupHeader.tabsBackground"] || config.colors.card;
  const tabActiveBg = tokens["tab.activeBackground"] || config.colors.card;
  const tabActiveFg = tokens["tab.activeForeground"] || config.colors.foreground;
  const tabInactiveBg = tokens["tab.inactiveBackground"] || config.colors.card;
  const tabInactiveFg = tokens["tab.inactiveForeground"] || config.colors.foreground;
  const tabHoverBg = tokens["tab.hoverBackground"] || "#ffffff0d";

  const editorBg = tokens["editor.background"] || config.colors.background;
  const editorFg = tokens["editor.foreground"] || config.colors.foreground;
  const lineNumberFg = tokens["editorLineNumber.foreground"] || "#888888";
  const lineNumberActiveFg = tokens["editorLineNumber.activeForeground"] || config.colors.primary;
  const cursorFg = tokens["editorCursor.foreground"] || config.colors.primary;
  const selectionBg = tokens["editor.selectionBackground"] || "#38bdf833";
  const activeLineBg = tokens["editor.lineHighlightBackground"] || "#ffffff0a";
  const indentGuideBg = tokens["editorIndentGuide.background"] || "#ffffff14";

  const suggestBg = tokens["editorSuggestWidget.background"] || config.colors.card;
  const suggestBorder = tokens["editorSuggestWidget.border"] || config.colors.border;
  const suggestActiveBg = tokens["editorSuggestWidget.selectedBackground"] || "#38bdf826";

  const statusBg = tokens["statusBar.background"] || config.colors.card;
  const statusFg = tokens["statusBar.foreground"] || config.colors.foreground;
  const statusBorder = tokens["statusBar.border"] || config.colors.border;

  const gitModified = tokens["gitDecoration.modifiedResourceForeground"] || "#eab308";
  const gitUntracked = tokens["gitDecoration.untrackedResourceForeground"] || "#4ade80";

  const listActiveBg = tokens["list.activeSelectionBackground"] || "#38bdf833";

  // App shell tokens
  const primaryBg = tokens["app.primaryBackground"] || config.colors.primary;
  const primaryFg = tokens["app.primaryForeground"] || "#ffffff";
  const cardBg = tokens["app.cardBackground"] || config.colors.card;
  const cardFg = tokens["app.cardForeground"] || config.colors.foreground;

  return (
    <div className="space-y-3 select-none w-full">
      {/* Surface Showcase Mode Switcher Deck */}
      <div className="flex items-center justify-center py-1">
        <div
          className="tabs-segmented flex items-center justify-center max-w-md w-full"
          role="group"
          aria-label="Preview surface"
        >
          <button
            type="button"
            onClick={() => setSurfaceMode("ide")}
            aria-pressed={surfaceMode === "ide"}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-all cursor-pointer whitespace-nowrap ${
              surfaceMode === "ide"
                ? "bg-card text-foreground shadow-xs border border-border/60"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Code2 className="size-3.5" />
            <span>IDE Workbench</span>
          </button>

          <button
            type="button"
            onClick={() => setSurfaceMode("chat")}
            aria-pressed={surfaceMode === "chat"}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-all cursor-pointer whitespace-nowrap ${
              surfaceMode === "chat"
                ? "bg-card text-foreground shadow-xs border border-border/60"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <MessageSquare className="size-3.5" />
            <span>Chat & App Shell</span>
          </button>

          <button
            type="button"
            onClick={() => setSurfaceMode("tokens")}
            aria-pressed={surfaceMode === "tokens"}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-all cursor-pointer whitespace-nowrap ${
              surfaceMode === "tokens"
                ? "bg-card text-foreground shadow-xs border border-border/60"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid className="size-3.5" />
            <span>Color System</span>
          </button>
        </div>
      </div>

      {/* Surface Frame */}
      <div
        className="relative flex flex-col overflow-hidden rounded-2xl border shadow-2xl transition-all duration-200 text-xs font-sans w-full"
        style={{
          backgroundColor: editorBg,
          borderColor: sideBorder,
          fontFamily: config.fonts.uiFont,
        }}
      >
        {/* Titlebar Strip */}
        <div
          className="flex h-7 items-center justify-between border-b px-3 text-[11px] font-semibold shrink-0"
          style={{
            backgroundColor: titleBg,
            color: titleFg,
            borderColor: titleBorder,
          }}
        >
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-rose-500/80" />
              <span className="size-2.5 rounded-full bg-amber-500/80" />
              <span className="size-2.5 rounded-full bg-emerald-500/80" />
            </div>
            <span className="font-mono tracking-tight ml-1.5" style={{ color: titleFg }}>
              Tabs Studio — Workspace
            </span>
          </div>
          <div
            className="flex items-center gap-3 text-[10px]"
            style={{ color: titleFg, opacity: 0.7 }}
          >
            <span>File</span>
            <span>Edit</span>
            <span>View</span>
            <span>Go</span>
          </div>
        </div>

        {surfaceMode === "ide" ? (
          /* ── 1. IDE WORKBENCH SURFACE ───────────────────────────────────── */
          <div className="flex flex-col h-80">
            <div className="flex flex-1 overflow-hidden">
              {/* Activity Bar Column */}
              <div
                className="flex w-9 flex-col items-center py-2 gap-3 border-e shrink-0"
                style={{
                  backgroundColor: sideBg,
                  borderColor: sideBorder,
                  color: sideFg,
                }}
              >
                <div
                  className="p-1 rounded-md border-s-2"
                  style={{ borderColor: config.colors.primary, color: config.colors.primary }}
                >
                  <Layers className="size-4" />
                </div>
                <Search className="size-4 opacity-70 hover:opacity-100" style={{ color: sideFg }} />
                <GitBranch
                  className="size-4 opacity-70 hover:opacity-100"
                  style={{ color: sideFg }}
                />
                <div className="mt-auto">
                  <Settings
                    className="size-4 opacity-70 hover:opacity-100"
                    style={{ color: sideFg }}
                  />
                </div>
              </div>

              {/* Explorer Sidebar */}
              <div
                className="flex w-44 flex-col border-e shrink-0"
                style={{
                  backgroundColor: sideBg,
                  color: sideFg,
                  borderColor: sideBorder,
                }}
              >
                <div
                  className="flex items-center justify-between border-b px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider"
                  style={{ backgroundColor: headerBg, borderColor: sideBorder, color: sideFg }}
                >
                  <span style={{ color: sideFg }}>Explorer</span>
                  <MoreHorizontal className="size-3" style={{ color: sideFg, opacity: 0.7 }} />
                </div>

                <div className="flex-1 space-y-0.5 p-1.5 text-[11px]" style={{ color: sideFg }}>
                  <div
                    className="flex items-center gap-1 rounded-md px-1.5 py-1 font-semibold"
                    style={{ color: sideFg }}
                  >
                    <ChevronDown className="size-3" style={{ color: sideFg, opacity: 0.7 }} />
                    <Folder className="size-3 text-sky-600 dark:text-sky-400" />
                    <span style={{ color: sideFg }}>src</span>
                  </div>
                  <div
                    className="flex items-center justify-between rounded-md px-2.5 py-1"
                    style={{ backgroundColor: listActiveBg, color: sideFg }}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileCode className="size-3 text-sky-600 dark:text-sky-400" />
                      <span className="truncate font-medium" style={{ color: sideFg }}>
                        App.tsx
                      </span>
                    </div>
                    <span
                      className="size-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: gitModified }}
                    />
                  </div>
                  <div
                    className="flex items-center justify-between rounded-md px-2.5 py-1 hover:bg-white/5"
                    style={{ color: sideFg }}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className="size-3 text-amber-600 dark:text-amber-400" />
                      <span className="truncate" style={{ color: sideFg }}>
                        index.css
                      </span>
                    </div>
                  </div>
                  <div
                    className="flex items-center justify-between rounded-md px-2.5 py-1 hover:bg-white/5"
                    style={{ color: sideFg }}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileCode className="size-3 text-emerald-600 dark:text-emerald-400" />
                      <span className="truncate" style={{ color: gitUntracked }}>
                        useTheme.ts
                      </span>
                    </div>
                    <span className="text-[9px] font-bold" style={{ color: gitUntracked }}>
                      U
                    </span>
                  </div>
                </div>
              </div>

              {/* Main Editor Area */}
              <div
                className="flex flex-1 flex-col overflow-hidden"
                style={{ backgroundColor: editorBg }}
              >
                {/* Tabs Row */}
                <div
                  className="flex h-7 items-center border-b overflow-x-auto shrink-0"
                  style={{
                    backgroundColor: tabHeaderBg,
                    borderColor: sideBorder,
                  }}
                >
                  <div
                    className="flex h-full items-center gap-1.5 border-e px-3 text-[11px] font-medium"
                    style={{
                      backgroundColor: tabActiveBg,
                      color: tabActiveFg,
                      borderColor: sideBorder,
                    }}
                  >
                    <span className="size-2 rounded-full bg-sky-400" />
                    <span style={{ color: tabActiveFg }}>App.tsx</span>
                    <X
                      className="size-3 ms-1 cursor-pointer"
                      style={{ color: tabActiveFg, opacity: 0.7 }}
                    />
                  </div>

                  <div
                    className="flex h-full items-center gap-1.5 border-e px-3 text-[11px]"
                    style={{
                      backgroundColor: tabInactiveBg,
                      color: tabInactiveFg,
                      borderColor: sideBorder,
                    }}
                  >
                    <span style={{ color: tabInactiveFg }}>index.css</span>
                    <X
                      className="size-3 ms-1 cursor-pointer"
                      style={{ color: tabInactiveFg, opacity: 0.7 }}
                    />
                  </div>

                  <div
                    className="flex h-full items-center gap-1.5 px-3 text-[11px]"
                    style={{
                      backgroundColor: tabHoverBg,
                      color: tabInactiveFg,
                    }}
                  >
                    <span style={{ color: tabInactiveFg }}>useTheme.ts</span>
                  </div>
                </div>

                {/* Breadcrumbs Strip */}
                <div
                  className="flex h-5 items-center gap-1 border-b px-2 text-[10px] font-mono shrink-0"
                  style={{ backgroundColor: sideBg, borderColor: sideBorder, color: sideFg }}
                >
                  <span style={{ color: sideFg, opacity: 0.7 }}>src</span>
                  <ChevronRight className="size-3" style={{ color: sideFg, opacity: 0.7 }} />
                  <span style={{ color: sideFg, opacity: 0.7 }}>components</span>
                  <ChevronRight className="size-3" style={{ color: sideFg, opacity: 0.7 }} />
                  <span className="font-semibold" style={{ color: config.colors.primary }}>
                    App.tsx
                  </span>
                </div>

                {/* Code Canvas & Minimap */}
                <div className="relative flex-1 flex overflow-hidden">
                  <div
                    className="flex-1 p-2.5 font-mono text-[11px] leading-relaxed overflow-hidden"
                    style={{
                      backgroundColor: editorBg,
                      color: editorFg,
                      fontFamily: config.fonts.editorFont,
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-5 text-right text-[10px]" style={{ color: lineNumberFg }}>
                        1
                      </span>
                      <span className="border-s ps-2" style={{ borderColor: indentGuideBg }}>
                        <span style={{ color: config.colors.primary }}>import</span>{" "}
                        <span style={{ color: editorFg }}>React</span>{" "}
                        <span style={{ color: config.colors.primary }}>from</span>{" "}
                        <span style={{ color: gitUntracked }}>&quot;react&quot;</span>;
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="w-5 text-right text-[10px]" style={{ color: lineNumberFg }}>
                        2
                      </span>
                      <span className="border-s ps-2" style={{ borderColor: indentGuideBg }}>
                        <span style={{ color: config.colors.primary }}>const</span>{" "}
                        <span style={{ color: editorFg }}>theme</span> ={" "}
                        <span style={{ color: gitModified }}>useCustomTheme</span>();
                      </span>
                    </div>

                    <div
                      className="flex items-center gap-3 rounded-sm my-0.5"
                      style={{ backgroundColor: activeLineBg }}
                    >
                      <span
                        className="w-5 text-right text-[10px] font-bold"
                        style={{ color: lineNumberActiveFg }}
                      >
                        3
                      </span>
                      <span
                        className="border-s ps-2 relative"
                        style={{ borderColor: indentGuideBg }}
                      >
                        <span style={{ color: config.colors.primary }}>return </span>
                        <span
                          style={{ backgroundColor: selectionBg, color: editorFg }}
                          className="px-0.5 rounded-xs"
                        >
                          &lt;<span style={{ color: config.colors.primary }}>CustomStudio</span>{" "}
                          /&gt;
                        </span>
                        <span
                          className="inline-block w-0.5 h-3.5 align-middle ms-0.5 animate-pulse"
                          style={{ backgroundColor: cursorFg }}
                        />
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="w-5 text-right text-[10px]" style={{ color: lineNumberFg }}>
                        4
                      </span>
                      <span className="border-s ps-2" style={{ borderColor: indentGuideBg }}>
                        &#125;;
                      </span>
                    </div>

                    {/* Completion Suggestion Popup */}
                    <div
                      className="absolute bottom-3 right-12 w-48 rounded-xl border p-2 shadow-2xl z-10 space-y-1 backdrop-blur-md"
                      style={{
                        backgroundColor: suggestBg,
                        borderColor: suggestBorder,
                        color: cardFg,
                      }}
                    >
                      <div
                        className="text-[9px] font-bold uppercase tracking-wider px-1"
                        style={{ color: cardFg, opacity: 0.6 }}
                      >
                        Completion Suggest
                      </div>
                      <div
                        className="flex items-center justify-between rounded-lg px-2 py-1 text-[10px] font-medium"
                        style={{ backgroundColor: suggestActiveBg, color: cardFg }}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] font-bold text-sky-600 dark:text-sky-400">
                            fn
                          </span>
                          <span style={{ color: cardFg }}>renderTheme</span>
                        </div>
                        <span className="text-[9px]" style={{ color: cardFg, opacity: 0.6 }}>
                          React.Node
                        </span>
                      </div>
                      <div
                        className="flex items-center justify-between rounded-lg px-2 py-1 text-[10px]"
                        style={{ color: cardFg }}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] font-bold text-purple-600 dark:text-purple-400">
                            v
                          </span>
                          <span style={{ color: cardFg }}>tokenMap</span>
                        </div>
                        <span className="text-[9px]" style={{ color: cardFg, opacity: 0.6 }}>
                          Record
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Minimap Preview Strip */}
                  <div
                    className="w-10 border-s p-1.5 space-y-1 shrink-0"
                    style={{ backgroundColor: sideBg, borderColor: sideBorder }}
                  >
                    <div
                      className="h-1 w-full rounded-full bg-current opacity-80"
                      style={{ color: sideFg }}
                    />
                    <div
                      className="h-1 w-3/4 rounded-full bg-current opacity-60"
                      style={{ color: sideFg }}
                    />
                    <div
                      className="h-1.5 w-full rounded-full"
                      style={{ backgroundColor: config.colors.primary }}
                    />
                    <div
                      className="h-1 w-1/2 rounded-full bg-current opacity-50"
                      style={{ color: sideFg }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Status Bar */}
            <div
              className="flex h-6 items-center justify-between border-t px-3 text-[10px] font-mono shrink-0"
              style={{
                backgroundColor: statusBg,
                color: statusFg,
                borderColor: statusBorder,
              }}
            >
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 font-semibold" style={{ color: statusFg }}>
                  <GitBranch className="size-3 text-emerald-600 dark:text-emerald-400" />
                  main*
                </span>
                <span style={{ color: statusFg, opacity: 0.75 }}>0 errors, 0 warnings</span>
              </div>
              <div className="flex items-center gap-3" style={{ color: statusFg, opacity: 0.75 }}>
                <span>UTF-8</span>
                <span>TypeScript JSX</span>
              </div>
            </div>
          </div>
        ) : surfaceMode === "chat" ? (
          /* ── 2. CHAT & APP SHELL SURFACE ────────────────────────────────── */
          <div
            className="flex flex-col h-80 p-4 space-y-3 overflow-y-auto"
            style={{ backgroundColor: editorBg, color: editorFg }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border"
                  style={{ backgroundColor: cardBg, color: cardFg, borderColor: sideBorder }}
                >
                  <Bot className="size-3.5" style={{ color: config.colors.primary }} />
                  <span style={{ color: cardFg }}>Claude 3.5 Sonnet</span>
                </div>
                <span
                  className="text-[10px] font-mono px-2.5 py-0.5 rounded-md font-bold"
                  style={{ backgroundColor: primaryBg, color: primaryFg }}
                >
                  FAST MODE
                </span>
              </div>
            </div>

            <div
              className="rounded-2xl border p-3.5 space-y-2 shadow-xs"
              style={{ backgroundColor: cardBg, color: cardFg, borderColor: sideBorder }}
            >
              <div className="flex items-center gap-2">
                <Wand2 className="size-4" style={{ color: config.colors.primary }} />
                <span className="font-bold text-xs" style={{ color: cardFg }}>
                  Antigravity Agent
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: cardFg, opacity: 0.9 }}>
                I updated{" "}
                <code
                  className="font-mono text-[11px] px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: sideBg, color: cardFg }}
                >
                  useTheme.ts
                </code>{" "}
                to inject contrast-clamped custom properties.
              </p>
            </div>

            <div
              className="rounded-xl border p-3.5 space-y-2"
              style={{ backgroundColor: sideBg, color: sideFg, borderColor: sideBorder }}
            >
              <div className="flex items-center justify-between text-xs font-semibold">
                <div className="flex items-center gap-1.5">
                  <Wrench className="size-3.5" style={{ color: config.colors.primary }} />
                  <span style={{ color: sideFg }}>Run Command</span>
                </div>
                <span className="text-[10px] font-mono" style={{ color: sideFg, opacity: 0.7 }}>
                  bun run typecheck
                </span>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-xs"
                  style={{ backgroundColor: primaryBg, color: primaryFg }}
                >
                  Approve Command
                </button>
                <button
                  type="button"
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium border opacity-80"
                  style={{ borderColor: sideBorder, color: sideFg }}
                >
                  Reject
                </button>
              </div>
            </div>

            <div
              className="mt-auto flex items-center gap-2 rounded-2xl border p-2.5 shadow-sm"
              style={{ backgroundColor: cardBg, borderColor: sideBorder }}
            >
              <input
                type="text"
                readOnly
                value="Refactor theme colors with WCAG contrast guarantee..."
                className="flex-1 bg-transparent text-xs px-2 font-sans focus:outline-none"
                style={{ color: cardFg }}
              />
              <button
                type="button"
                className="flex size-7.5 items-center justify-center rounded-xl font-bold shadow-xs shrink-0"
                style={{ backgroundColor: primaryBg, color: primaryFg }}
              >
                <Send className="size-3.5" />
              </button>
            </div>
          </div>
        ) : (
          /* ── 3. CLEAN COLOR SYSTEM & WCAG AUDIT GRID (CLEAN SWATCHES) ────── */
          <div
            className="flex flex-col h-80 p-4 space-y-3 overflow-y-auto"
            style={{ backgroundColor: editorBg, color: editorFg }}
          >
            <div className="flex items-center justify-between">
              <span
                className="text-xs font-bold uppercase tracking-wider"
                style={{ color: editorFg }}
              >
                Derived Token System ({wcagResults.length} Pairs Audited)
              </span>
              <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <Check className="size-3 stroke-[3]" />
                100% WCAG AA Compliant
              </span>
            </div>

            {/* Clean Audited Swatch Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {wcagResults.slice(0, 8).map((res) => {
                const isAAA = res.ratio >= 7.0;
                const isAA = res.ratio >= 4.5 && res.ratio < 7.0;

                let badgeStyle =
                  "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20";
                let badgeLabel = `${res.ratio}:1 Fail`;

                if (isAAA) {
                  badgeStyle =
                    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20";
                  badgeLabel = `${res.ratio}:1 AAA`;
                } else if (isAA) {
                  badgeStyle =
                    "bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/20";
                  badgeLabel = `${res.ratio}:1 AA`;
                }

                return (
                  <div
                    key={res.fgToken}
                    className="flex items-center justify-between rounded-2xl border p-3 text-xs shadow-xs"
                    style={{
                      backgroundColor: cardBg,
                      borderColor: sideBorder,
                      color: cardFg,
                    }}
                  >
                    <div className="min-w-0 flex-1 pe-3">
                      <span className="text-xs font-bold block truncate" style={{ color: cardFg }}>
                        {res.fgLabel}
                      </span>
                      <span
                        className="text-[10px] font-mono block truncate mt-0.5"
                        style={{ color: cardFg, opacity: 0.65 }}
                      >
                        {res.fgHex} vs {res.bgHex}
                      </span>
                    </div>

                    {/* Color Swatch Pill Preview */}
                    <div className="flex items-center gap-2.5 shrink-0">
                      <div
                        className="px-2.5 py-1 rounded-xl font-mono text-[10px] font-bold border border-black/10 shadow-inner"
                        style={{ backgroundColor: res.bgHex, color: res.fgHex }}
                      >
                        Sample
                      </div>
                      <span
                        className={`font-mono text-[11px] font-bold px-2 py-0.5 rounded-lg ${badgeStyle}`}
                      >
                        {badgeLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

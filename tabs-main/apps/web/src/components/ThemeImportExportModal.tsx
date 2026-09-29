import React, { useState, useMemo, useRef } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  Upload,
  X,
} from "lucide-react";
import type { CustomThemeConfig } from "@tabs/shared/themeDerivation";
import {
  exportCustomThemeAsJson,
  validateAndParseThemeString,
} from "@tabs/shared/themeImportExport";
import { runThemeWcagCheck } from "@tabs/shared/themeDerivation";
import { Button } from "./ui/button";
import { Dialog, DialogPopup } from "./ui/dialog";

interface ThemeImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentConfig: CustomThemeConfig;
  currentName?: string;
  onImportTheme: (name: string, config: CustomThemeConfig) => void;
  initialTab?: "import" | "export";
}

export const ThemeImportExportModal: React.FC<ThemeImportExportModalProps> = ({
  isOpen,
  onClose,
  currentConfig,
  currentName = "Custom Theme",
  onImportTheme,
  initialTab = "import",
}) => {
  const [activeTab, setActiveTab] = useState<"import" | "export">(initialTab);
  const [jsonInput, setJsonInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live validation of pasted or uploaded JSON
  const validationResult = useMemo(() => {
    if (!jsonInput.trim()) return null;
    return validateAndParseThemeString(jsonInput);
  }, [jsonInput]);

  const wcagResults = useMemo(() => {
    if (validationResult?.success) {
      return runThemeWcagCheck(validationResult.config);
    }
    return [];
  }, [validationResult]);

  const lowContrastCount = useMemo(
    () => wcagResults.filter((r) => r.isLowContrast).length,
    [wcagResults],
  );

  const exportedJson = useMemo(() => {
    return exportCustomThemeAsJson(currentConfig, currentName);
  }, [currentConfig, currentName]);

  if (!isOpen) return null;

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(exportedJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleDownloadJson = () => {
    const filename = `${currentName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "custom-theme"}.tabs-theme.json`;
    const blob = new Blob([exportedJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readThemeFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    readThemeFile(file);
  };

  const readThemeFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === "string") {
        setJsonInput(content);
        setActiveTab("import");
      }
    };
    reader.readAsText(file);
  };

  const handleApplyImport = () => {
    if (!validationResult || !validationResult.success) return;
    onImportTheme(validationResult.name, validationResult.config);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup
        showCloseButton={false}
        className="max-h-[85vh] w-full max-w-2xl flex-col p-0 overflow-hidden rounded-3xl border border-border/80 bg-card text-card-foreground shadow-2xl"
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-border/70 px-6 py-4 bg-background/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <FileCode2 className="size-5 text-primary" />
            <div>
              <h3 className="text-base font-bold text-foreground tracking-tight">
                Import & Export Theme
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Share custom palettes or import any VS Code color theme.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              className="tabs-segmented flex text-xs"
              role="group"
              aria-label="Theme transfer mode"
            >
              <button
                type="button"
                onClick={() => setActiveTab("import")}
                aria-pressed={activeTab === "import"}
                className={`rounded-lg px-3 py-1 font-semibold transition-colors cursor-pointer ${
                  activeTab === "import"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Import
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("export")}
                aria-pressed={activeTab === "export"}
                className={`rounded-lg px-3 py-1 font-semibold transition-colors cursor-pointer ${
                  activeTab === "export"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Export
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer ml-2"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {activeTab === "import" ? (
            <div className="space-y-4">
              {/* Drag and drop zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-5 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? "border-primary bg-primary/10"
                    : "border-border/70 hover:border-primary/50 hover:bg-muted/30"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <Upload className="size-6 text-muted-foreground mb-1.5" />
                <p className="text-xs font-semibold text-foreground">
                  Click to select a JSON file or drag and drop here
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Accepts standard VS Code{" "}
                  <code className="font-mono text-primary">*-color-theme.json</code> or Tabs custom
                  theme files (max 256 KB)
                </p>
              </div>

              {/* Paste JSON Textarea */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                  <span>Or paste theme JSON directly:</span>
                  {jsonInput && (
                    <button
                      type="button"
                      onClick={() => setJsonInput("")}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </label>
                <textarea
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                  placeholder='Paste JSON here (e.g. { "colors": { "editor.background": "#121824", ... } })'
                  rows={6}
                  className="w-full rounded-2xl border border-border/80 bg-background/50 p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>

              {/* Validation Feedback & Preview */}
              {validationResult ? (
                validationResult.success ? (
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-foreground">
                            {validationResult.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {validationResult.config.baseVariant.toUpperCase()} palette detected
                          </p>
                        </div>
                      </div>
                      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        {lowContrastCount === 0
                          ? "Contrast Compliant"
                          : `${lowContrastCount} low-contrast notices`}
                      </span>
                    </div>

                    {/* Color Swatches Preview */}
                    <div className="flex items-center gap-2 pt-1 border-t border-emerald-500/20">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="size-4 rounded-full border border-black/20 shadow-xs"
                          style={{ backgroundColor: validationResult.config.colors.background }}
                          title={`Background: ${validationResult.config.colors.background}`}
                        />
                        <span
                          className="size-4 rounded-full border border-black/20 shadow-xs"
                          style={{ backgroundColor: validationResult.config.colors.card }}
                          title={`Card: ${validationResult.config.colors.card}`}
                        />
                        <span
                          className="size-4 rounded-full border border-black/20 shadow-xs"
                          style={{ backgroundColor: validationResult.config.colors.primary }}
                          title={`Primary: ${validationResult.config.colors.primary}`}
                        />
                        <span
                          className="size-4 rounded-full border border-black/20 shadow-xs"
                          style={{ backgroundColor: validationResult.config.colors.foreground }}
                          title={`Foreground: ${validationResult.config.colors.foreground}`}
                        />
                      </div>
                      <span className="text-[11px] font-mono text-muted-foreground ml-auto">
                        Ready to import
                      </span>
                    </div>

                    {/* VS Code tokenColors notice */}
                    {jsonInput.includes("tokenColors") && (
                      <div className="flex items-start gap-2 pt-1 border-t border-emerald-500/20">
                        <AlertCircle className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          <span className="font-semibold text-amber-500">Note:</span>{" "}
                          <code className="font-mono text-primary">tokenColors</code> (syntax
                          highlighting rules) are not imported — only UI workbench colors are
                          mapped. The editor will use Tabs' default syntax theme.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3.5 flex items-start gap-2.5">
                    <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-destructive">Invalid Theme</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {validationResult.error}
                      </p>
                    </div>
                  </div>
                )
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                This JSON includes the complete palette configuration, token overrides, and font
                preferences for <strong className="text-foreground">{currentName}</strong>.
              </p>
              <div className="relative">
                <textarea
                  readOnly
                  value={exportedJson}
                  rows={10}
                  className="w-full rounded-2xl border border-border/80 bg-background/80 p-3 font-mono text-xs text-foreground focus:outline-none select-all"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-border/70 px-6 py-4 bg-background/40 shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>

          {activeTab === "import" ? (
            <Button
              variant="default"
              size="sm"
              disabled={!validationResult || !validationResult.success}
              onClick={handleApplyImport}
              className="gap-1.5"
            >
              <Check className="size-3.5" />
              <span>Apply & Save Theme</span>
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleCopyJson} className="gap-1.5">
                {copied ? (
                  <Check className="size-3.5 text-emerald-500" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                <span>{copied ? "Copied!" : "Copy JSON"}</span>
              </Button>
              <Button variant="default" size="sm" onClick={handleDownloadJson} className="gap-1.5">
                <Download className="size-3.5" />
                <span>Download .json</span>
              </Button>
            </div>
          )}
        </div>
      </DialogPopup>
    </Dialog>
  );
};

import { useId, useMemo, useRef, useState } from "react";
import { CheckCircle2, Copy, Download, FileCode2, Upload } from "lucide-react";
import { runThemeWcagCheck, type CustomThemeConfig } from "@tabs/shared/themeDerivation";
import {
  exportCustomThemeAsJson,
  MAX_THEME_FILE_BYTES,
  validateAndParseThemeString,
} from "@tabs/shared/themeImportExport";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogDetails,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { SegmentedControl } from "./ui/segmented-control";

interface ThemeImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentConfig: CustomThemeConfig;
  currentName?: string;
  onImportTheme: (name: string, config: CustomThemeConfig) => void;
  initialTab?: "import" | "export";
  destination?: "library" | "draft";
}

export function ThemeImportExportModal({
  isOpen,
  onClose,
  currentConfig,
  currentName = "Custom Theme",
  onImportTheme,
  initialTab = "import",
  destination = "library",
}: ThemeImportExportModalProps) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [jsonInput, setJsonInput] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readVersion = useRef(0);
  const validationId = useId();

  const validation = useMemo(
    () => (jsonInput.trim() ? validateAndParseThemeString(jsonInput) : null),
    [jsonInput],
  );
  const contrastIssues = useMemo(
    () =>
      validation?.success
        ? runThemeWcagCheck(validation.config).filter((result) => result.isLowContrast).length
        : 0,
    [validation],
  );
  const exportedJson = useMemo(
    () => exportCustomThemeAsJson(currentConfig, currentName),
    [currentConfig, currentName],
  );

  async function readFile(file: File) {
    const version = ++readVersion.current;
    setFileName(file.name);
    setFileError("");
    setJsonInput("");
    if (file.size > MAX_THEME_FILE_BYTES) {
      setFileError("Choose a theme file that is 256 KB or smaller.");
      return;
    }
    try {
      const content = await file.text();
      if (version !== readVersion.current) return;
      if (!content.trim()) {
        setFileError("This file is empty. Choose another theme file.");
        return;
      }
      setJsonInput(content);
    } catch {
      if (version === readVersion.current) {
        setFileError("Tabs couldn’t read this file. Try choosing it again.");
      }
    }
  }

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(exportedJson);
      setCopyStatus("JSON copied.");
    } catch {
      setCopyStatus("Couldn’t copy automatically. Select the JSON or download the file.");
    }
  }

  function downloadJson() {
    const name = currentName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "custom-theme";
    const url = URL.createObjectURL(new Blob([exportedJson], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}.tabs-theme.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup
        bottomStickOnMobile={false}
        backdropClassName="bg-black/50 backdrop-blur-none"
        className="max-w-xl overflow-hidden bg-background"
      >
        <DialogHeader>
          <DialogTitle className="text-xl">
            {activeTab === "import" ? "Import a theme" : "Export theme"}
          </DialogTitle>
          <DialogDescription>
            {activeTab === "export"
              ? "Take a copy of this palette with you."
              : destination === "draft"
                ? "Use a Tabs or VS Code theme as the starting point for this draft."
                : "Add a Tabs or VS Code theme to your palette collection."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto px-5 pb-5">
          <SegmentedControl
            size="sm"
            value={activeTab}
            onValueChange={setActiveTab}
            options={[
              { value: "import", label: "Import" },
              { value: "export", label: "Export" },
            ]}
            aria-label="Theme transfer mode"
            className="w-fit"
          />
          {activeTab === "import" ? (
            <>
              <div
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-2xl border border-dashed bg-card px-4 py-4 transition-colors",
                  dragOver ? "border-primary bg-primary/10" : "border-border",
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDragOver(false);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  const file = event.dataTransfer.files[0];
                  if (file) void readFile(file);
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="wrap-anywhere text-sm font-medium">{fileName || "Theme file"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Drop a JSON file here or browse. Up to 256 KB.
                  </p>
                </div>
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload aria-hidden="true" /> {fileName ? "Choose another file" : "Choose file"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void readFile(file);
                    event.target.value = "";
                  }}
                />
              </div>
              <DialogDetails title="Paste theme JSON">
                <textarea
                  aria-label="Theme JSON"
                  aria-describedby={validationId}
                  aria-invalid={validation?.success === false}
                  value={jsonInput}
                  onChange={(event) => {
                    readVersion.current++;
                    setFileName("");
                    setFileError("");
                    setJsonInput(event.target.value);
                  }}
                  spellCheck={false}
                  rows={5}
                  placeholder='{ "colors": { "editor.background": "#121824" } }'
                  className="w-full rounded-xl border border-border bg-background p-3 font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring"
                />
                {jsonInput && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setJsonInput("");
                      setFileName("");
                    }}
                  >
                    Clear JSON
                  </Button>
                )}
              </DialogDetails>

              <div id={validationId} aria-live="polite">
                {fileError || validation?.success === false ? (
                  <p className="text-sm text-destructive">
                    {fileError || (validation?.success === false ? validation.error : "")}
                  </p>
                ) : validation?.success ? (
                  <div className="space-y-2 rounded-xl border border-border bg-card p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 wrap-anywhere text-sm font-semibold">
                          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />{" "}
                          {validation.name}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {validation.config.baseVariant === "dark" ? "Dark" : "Light"} palette
                          {contrastIssues > 0 ? ` · ${contrastIssues} contrast warnings` : ""}
                        </p>
                      </div>
                      <div
                        aria-hidden="true"
                        className="flex overflow-hidden rounded-full border border-border"
                      >
                        {Object.entries(validation.config.colors).map(([name, color]) => (
                          <span key={name} className="h-5 w-6" style={{ backgroundColor: color }} />
                        ))}
                      </div>
                    </div>
                    {jsonInput.includes("tokenColors") && (
                      <p className="text-xs text-muted-foreground">
                        Tabs imports workbench colors and keeps its own syntax highlighting.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
                <FileCode2 className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="wrap-anywhere text-sm font-semibold">{currentName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Palette, color overrides and typography settings
                  </p>
                </div>
              </div>
              <DialogDetails title="View export JSON">
                <textarea
                  aria-label="Exported theme JSON"
                  readOnly
                  value={exportedJson}
                  rows={7}
                  className="w-full rounded-xl border border-border bg-background p-3 font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring"
                />
              </DialogDetails>
              {copyStatus && (
                <p role="status" className="text-xs text-muted-foreground">
                  {copyStatus}
                </p>
              )}
            </>
          )}
        </div>
        <DialogFooter className="flex-row flex-wrap justify-end">
          {activeTab === "import" ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={!validation?.success}
                onClick={() => {
                  if (!validation?.success) return;
                  onImportTheme(validation.name, validation.config);
                  onClose();
                }}
              >
                {destination === "draft" ? "Use in draft" : "Import and apply"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => void copyJson()}>
                <Copy aria-hidden="true" /> Copy JSON
              </Button>
              <Button onClick={downloadJson}>
                <Download aria-hidden="true" /> Download JSON
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

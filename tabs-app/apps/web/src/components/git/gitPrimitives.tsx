import { AlertTriangle, Check, CircleAlert, Copy, Loader2, Wand2, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ModelSlug, ProviderInstanceId, type ModelSelection } from "@tabs/contracts";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerConfig } from "../../state/settings";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { makeAppModelSelection, resolveAppModelSelectionState } from "../../modelSelection";
import { FusedModelPicker } from "../chat/FusedModelPicker";
import { PROVIDER_OPTIONS } from "../../session-logic";
import { pickGitProviderInstance } from "../../lib/gitModelSelection";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

const ACCENT = "var(--gt-accent, var(--primary, #ffffff))";
const ACCENT_CONTRAST = "var(--gt-accent-contrast, var(--primary-foreground, #ffffff))";

export const TONE = {
  ok: {
    color: "var(--sem-emerald)",
    dot: "var(--sem-emerald)",
    soft: "var(--sem-emerald-soft)",
    border: "var(--sem-emerald-border)",
  },
  warn: {
    color: "var(--sem-amber)",
    dot: "var(--sem-amber)",
    soft: "var(--sem-amber-soft)",
    border: "var(--sem-amber-border)",
  },
  bad: {
    color: "var(--sem-red)",
    dot: "var(--sem-red)",
    soft: "var(--sem-red-soft)",
    border: "var(--sem-red-border)",
  },
  info: {
    color: "var(--sem-sky)",
    dot: "var(--sem-sky)",
    soft: "var(--sem-sky-soft)",
    border: "var(--sem-sky-border)",
  },
};

export function Banner({
  tone = "info",
  title,
  body,
  actions,
}: {
  tone?: "ok" | "warn" | "bad" | "info";
  title: string;
  body?: string;
  actions?: ReactNode;
}) {
  const c = TONE[tone];
  const Icon = tone === "warn" ? AlertTriangle : CircleAlert;
  return (
    <div
      data-slot="git-banner"
      className="w-full flex items-center justify-between gap-4 rounded-lg border px-4 py-3 mb-4"
      style={{ borderColor: c.border, backgroundColor: c.soft }}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <Icon size={14} className="shrink-0 mt-0.5" style={{ color: c.color }} />
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs font-semibold" style={{ color: c.color }}>
            {title}
          </span>
          {body && <span className="text-xs text-foreground/90 leading-relaxed">{body}</span>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 ml-auto">{actions}</div>}
    </div>
  );
}

export function PanelToolbar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 mb-4 ${className}`}>
      <div className="flex items-center gap-2 ms-auto">{children}</div>
    </div>
  );
}

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SectionLabel({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="git-section-label"
      className={cn("flex items-center justify-between mt-5 mb-2 first:mt-0", className)}
    >
      <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground/70">
        {children}
      </span>
      {action}
    </div>
  );
}

export function Card({
  children,
  className = "",
  style,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  return (
    <div
      data-slot="git-card"
      className={`border border-border rounded-lg ${className}`}
      style={{ backgroundColor: "var(--bg-surface)", ...style }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function PathBreadcrumb({ path }: { path: string }) {
  const parts = path.split("/");
  const file = parts.pop();
  const content = (
    <span className="text-xs font-mono truncate flex items-center gap-1 min-w-0">
      {parts.length > 0 && (
        <span className="text-muted-foreground/70 truncate">{parts.join("/")}/</span>
      )}
      <span className="text-foreground/90 font-medium shrink-0">{file}</span>
    </span>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={content} />
      <TooltipPopup side="top" className="max-w-md break-all">
        {path}
      </TooltipPopup>
    </Tooltip>
  );
}

export function FilePathLabel({ path, size = "text-[11px]" }: { path: string; size?: string }) {
  const parts = path.split("/");
  const file = parts.pop();
  const dir = parts.join("/");
  const content = (
    <div className="min-w-0 flex-1">
      {dir && (
        <div className="text-[10px] font-mono text-muted-foreground/70 truncate leading-normal pb-0.5">
          {dir}/
        </div>
      )}
      <div className={`${size} font-mono text-foreground/90 truncate leading-normal pb-0.5`}>
        {file}
      </div>
    </div>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={content} />
      <TooltipPopup side="top" className="max-w-md break-all">
        {path}
      </TooltipPopup>
    </Tooltip>
  );
}

export function StatPill({ ins, del }: { ins: number; del: number }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-mono shrink-0">
      <span
        className="px-1.5 py-0.5 rounded"
        style={{ backgroundColor: "var(--sem-emerald-soft)", color: "var(--sem-emerald)" }}
      >
        +{ins}
      </span>
      <span
        className="px-1.5 py-0.5 rounded"
        style={{ backgroundColor: "var(--sem-red-soft)", color: "var(--sem-red)" }}
      >
        -{del}
      </span>
    </span>
  );
}

export function Dropdown({
  trigger,
  children,
  open,
  setOpen,
  align = "left",
  width = "w-72",
}: {
  trigger: (toggle: () => void) => ReactNode;
  children: ReactNode;
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  align?: "left" | "right";
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [setOpen]);
  return (
    <div className="relative" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div
          className={`absolute top-full mt-2 ${align === "right" ? "right-0" : "left-0"} ${width} rounded-xl shadow-2xl overflow-hidden z-50 border border-border`}
          style={{ backgroundColor: "var(--bg-surface)" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function InlineForm({
  placeholder,
  initial = "",
  onSubmit,
  onCancel,
  submitLabel = "Save",
  className = "",
}: {
  placeholder: string;
  initial?: string;
  onSubmit: (val: string) => Promise<void> | void;
  onCancel: () => void;
  submitLabel?: string;
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!value.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(value.trim());
    } finally {
      setSubmitting(false);
    }
  };

  const loadingLabel = (() => {
    if (submitLabel.toLowerCase() === "create") return "Creating…";
    if (submitLabel.toLowerCase() === "create tag") return "Creating tag…";
    if (submitLabel.toLowerCase() === "rename") return "Renaming…";
    if (submitLabel.toLowerCase() === "save") return "Saving…";
    return submitLabel.replace(/e$/i, "") + "ing…";
  })();

  return (
    <div
      className={`flex items-center gap-2 bg-muted/50 border border-border rounded-lg px-2.5 py-2 ${className || "mb-2"}`}
    >
      <input
        autoFocus
        disabled={submitting}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void handleSubmit();
          if (e.key === "Escape" && !submitting) onCancel();
        }}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-xs font-mono text-foreground outline-none min-w-0 disabled:opacity-50"
      />
      <Button size="sm" disabled={!value.trim() || submitting} onClick={() => void handleSubmit()}>
        {submitting ? <Loader2 size={12} className="animate-spin" /> : null}
        {submitting ? loadingLabel : submitLabel}
      </Button>
      <Button variant="ghost" size="sm" disabled={submitting} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

export function AutoTextarea({
  value,
  onChange,
  onKeyDown,
  placeholder,
  className = "",
  minRows = 3,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, minRows * 20)}px`;
  }, [value, minRows]);
  return (
    <textarea
      ref={ref}
      aria-label={ariaLabel ?? placeholder}
      rows={minRows}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className={className}
      style={{ backgroundColor: "var(--bg-base)", resize: "none", overflow: "hidden" }}
    />
  );
}

export const Field = ({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) => (
  <div data-slot="git-field" className="mb-3">
    <label className="text-[10px] uppercase tracking-widest text-muted-foreground/70 block mb-1">
      {label}
    </label>
    {description && (
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed mb-1.5">{description}</p>
    )}
    {children}
  </div>
);

export const TextInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`w-full border border-border rounded-lg text-foreground text-xs placeholder:text-muted-foreground/50 px-3 py-2 outline-none focus:border-border transition-colors ${props.className || ""}`}
    style={{ backgroundColor: "var(--bg-base)" }}
  />
);

import React from "react";
import {
  Select as SelectRoot,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

export const Select = ({
  value,
  onChange,
  children,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  "aria-label"?: string;
  value?: string | number;
  onChange?: (e: { target: { value: string } }) => void;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) => {
  const options: Array<{ value: string; label: React.ReactNode }> = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      const props = child.props as { value?: string | number; children?: React.ReactNode };
      const val = props.value !== undefined ? String(props.value) : "";
      const label = props.children !== undefined ? props.children : val;
      options.push({ value: val, label });
    }
  });

  const strVal = value !== undefined ? String(value) : (options[0]?.value ?? "");
  const selectedLabel = options.find((o) => o.value === strVal)?.label ?? strVal;

  return (
    <SelectRoot
      disabled={disabled}
      value={strVal}
      onValueChange={(val) => {
        if (val !== null) {
          onChange?.({ target: { value: val } });
        }
      }}
    >
      <SelectTrigger className={className} aria-label={ariaLabel}>
        <SelectValue placeholder={typeof selectedLabel === "string" ? selectedLabel : "Select…"}>
          {selectedLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent side="bottom" align="start">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
};

export interface DiffSummaryCardProps {
  summary: string;
  keyChanges: string;
  notesAndRisk: string;
  targetScope?: "staged" | "working_tree" | "commit" | "full_codebase" | undefined;
  wasTruncated?: boolean | undefined;
  truncatedReason?: string | undefined;
  onClose?: (() => void) | undefined;
  modelName?: string | undefined;
}

export function DiffSummaryCard({
  summary,
  keyChanges,
  notesAndRisk,
  targetScope,
  wasTruncated,
  truncatedReason,
  onClose,
  modelName,
}: DiffSummaryCardProps) {
  const [copied, setCopied] = useState(false);
  const settings = useSettings();
  const serverConfig = useServerConfig();

  const activeSelection = useMemo(() => {
    return resolveAppModelSelectionState(
      {
        ...settings,
        ...(settings?.gitAi?.gitTextGenerationModelSelection
          ? { textGenerationModelSelection: settings.gitAi.gitTextGenerationModelSelection }
          : {}),
      },
      serverConfig?.providers ?? [],
    );
  }, [settings, serverConfig?.providers]);

  const activeModelDisplay = modelName || activeSelection.model;

  const showSummary = settings?.gitAi?.includeSummarySection ?? true;
  const showKeyChanges = settings?.gitAi?.includeKeyChangesSection ?? true;
  const showNotesAndRisk = settings?.gitAi?.includeNotesAndRiskSection ?? true;

  const fullText = [
    showSummary ? `### Summary\n${summary}` : "",
    showKeyChanges ? `### Key Changes\n${keyChanges}` : "",
    showNotesAndRisk && notesAndRisk ? `### Notes & Risk\n${notesAndRisk}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const handleCopy = () => {
    navigator.clipboard?.writeText(fullText).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const scopeLabel =
    targetScope === "staged"
      ? "Staged changes"
      : targetScope === "commit"
        ? "Commit summary"
        : "Working tree changes";

  return (
    <div className="rounded-xl border border-primary/20 bg-card p-4 shadow-lg space-y-3 mb-4 relative">
      <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Wand2 className="size-4 text-foreground shrink-0" />
          <span className="text-xs font-semibold text-foreground tracking-tight">
            AI Diff Summary
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-foreground border border-primary/20">
            {scopeLabel}
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-muted/80 text-muted-foreground border border-border/60">
            {activeModelDisplay}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 text-[11px] gap-1">
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {wasTruncated && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>
            {truncatedReason ||
              "Summary based on partial diff — large files/patches were truncated."}
          </span>
        </div>
      )}

      <div className="space-y-3 text-xs leading-relaxed">
        {showSummary && summary && (
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1">
              Summary
            </h4>
            <p className="text-foreground/90 font-medium">{summary}</p>
          </div>
        )}

        {showKeyChanges && keyChanges && (
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1">
              Key Changes
            </h4>
            <div className="text-muted-foreground/90 font-mono text-[11px] whitespace-pre-wrap leading-relaxed">
              {keyChanges}
            </div>
          </div>
        )}

        {showNotesAndRisk && notesAndRisk && (
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1">
              Notes & Risk
            </h4>
            <p className="text-foreground/80 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {notesAndRisk}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export interface GitModelPickerProps {
  selection?: ModelSelection | undefined;
  onSelect?: (selection: ModelSelection) => void;
  className?: string | undefined;
  filterSourceMode?: "connected" | "direct_gemini" | undefined;
  persistSelection?: boolean | undefined;
  ariaLabel?: string | undefined;
  disabled?: boolean | undefined;
}

export function GitModelPicker({
  selection,
  onSelect,
  className,
  persistSelection = true,
  ariaLabel = "Select AI model",
  disabled = false,
}: GitModelPickerProps) {
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const serverConfig = useServerConfig();
  const providers = serverConfig?.providers ?? [];
  const active =
    selection ??
    settings.gitAi?.gitTextGenerationModelSelection ??
    resolveAppModelSelectionState(settings, providers);
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
  ).filter((entry) => entry.enabled && entry.isAvailable);
  const currentEntry = entries.find((entry) => entry.instanceId === active.instanceId);
  const driver =
    PROVIDER_OPTIONS.find((option) => option.value === currentEntry?.driverKind)?.value ?? "codex";
  // Fusion uses driver tabs; keep the real configured instance ID when dispatching.
  const catalog = PROVIDER_OPTIONS.flatMap(({ value }) => {
    const entry = pickGitProviderInstance(entries, value, active.instanceId);
    return entry ? [{ ...entry.snapshot, instanceId: ProviderInstanceId.makeUnsafe(value) }] : [];
  });
  const save = (next: ModelSelection) => {
    if (persistSelection)
      updateSettings.updateSettings({
        gitAi: { gitTextGenerationModelSelection: next, modelSourceMode: "connected" },
      });
    onSelect?.(next);
  };
  const instances = entries.filter((entry) => entry.driverKind === currentEntry?.driverKind);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {instances.length > 1 && (
        <Select
          aria-label="Provider account for Git"
          value={active.instanceId}
          disabled={disabled}
          onChange={(event) => {
            const entry = entries.find((item) => item.instanceId === event.target.value);
            if (entry)
              save(
                makeAppModelSelection(
                  entry.instanceId,
                  entry.models.find((model) => model.slug === active.model)?.slug ??
                    entry.models[0]?.slug ??
                    active.model,
                ),
              );
          }}
        >
          {instances.map((entry) => (
            <option key={entry.instanceId} value={entry.instanceId}>
              {entry.displayName}
            </option>
          ))}
        </Select>
      )}
      <FusedModelPicker
        provider={driver}
        model={active.model as ModelSlug}
        lockedProvider={null}
        providers={catalog}
        prompt=""
        onPromptChange={() => {}}
        modelOptions={active.options}
        ariaLabel={ariaLabel}
        disabled={disabled || catalog.length === 0}
        availableProviders={catalog.map(
          (entry) => entry.driver as import("../../session-logic").ProviderPickerKind,
        )}
        labelOverride={
          !currentEntry?.models.some((model) => model.slug === active.model)
            ? active.model
            : undefined
        }
        triggerClassName="border border-border rounded-lg px-3 h-10 text-foreground"
        side="bottom"
        onProviderModelChange={(nextDriver, model, options) => {
          const entry = pickGitProviderInstance(entries, nextDriver, active.instanceId);
          if (entry) save(makeAppModelSelection(entry.instanceId, model, options));
        }}
        onModelOptionsChange={(options) =>
          save(makeAppModelSelection(active.instanceId, active.model, options))
        }
      />
    </div>
  );
}

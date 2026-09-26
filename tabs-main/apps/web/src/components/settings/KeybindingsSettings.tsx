import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleXIcon,
  CodeIcon,
  EllipsisIcon,
  FileJsonIcon,
  InfoIcon,
  KeyboardIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  MinusIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  SplitIcon,
  SquareTerminalIcon,
  TabletSmartphoneIcon,
  TriangleAlertIcon,
  WrenchIcon,
  XIcon,
  DownloadIcon,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  type KeybindingCommand,
  type KeybindingRule,
  type KeybindingWhenNode,
  type ResolvedKeybindingRule,
  type ResolvedKeybindingsConfig,
} from "@tabs/contracts";
import { parseKeybindingShortcut } from "@tabs/shared/keybindings";
import { isElectron } from "../../env";
import { useTheme } from "../../hooks/useTheme";
import { getActiveFontCombo } from "../../lib/themes";
import { formatShortcutLabel } from "../../keybindings";
import { cn, isMacPlatform } from "../../lib/utils";
import { ensureNativeApi } from "../../nativeApi";
import { resolveAndPersistPreferredEditor } from "../../editorPreferences";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Toggle } from "../ui/toggle";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AddKeybindingDialog } from "./AddKeybindingDialog";
import { SettingsHeaderPortal } from "./SettingsLayout";
import { useConfirm } from "~/hooks/useConfirm";

import {
  buildKeybindingCommandOptions,
  buildKeybindingRows,
  buildWhenVariableOptions,
  commandLabel,
  DEFAULT_WHEN_VARIABLE,
  isKnownWhenVariable,
  keybindingConflictLabels,
  keybindingFromKeyboardEvent,
  type KeybindingRow,
  type KeybindingCommandOption,
  type WhenVariableOption,
  parseWhenExpressionDraft,
  unknownWhenVariables,
  whenAstToExpression,
  whenNodeRemoveLabel,
  parseAndValidateKeybindingImport,
} from "./keybindingsSettings.logic";

export interface KeybindingsSettingsProps {
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly onUpsert: (rule: KeybindingRule) => Promise<unknown> | unknown;
  readonly onBatchUpsert: (rules: ReadonlyArray<KeybindingRule>) => Promise<unknown> | unknown;
  readonly onBatchRemove?: (
    rules: ReadonlyArray<KeybindingRule>,
  ) => Promise<{ readonly removedCount: number; readonly failedCount: number }>;
  readonly onRemove: (rule: KeybindingRule) => Promise<unknown> | unknown;
  readonly keybindingsConfigPath?: string | null | undefined;
  readonly availableEditors?: ReadonlyArray<any> | null | undefined;
  readonly platform?: string;
}

function SettingsSection({
  title,
  headerAction,
  children,
}: {
  title: string;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const { fontPreferences } = useTheme();
  const activeFontCombo = getActiveFontCombo(fontPreferences);

  return (
    <section className="flex flex-col space-y-3 h-full min-h-0">
      <div className="flex items-center justify-between shrink-0">
        {activeFontCombo.isNeutral ? (
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {title}
          </h2>
        ) : (
          <h2
            className={cn(
              "text-[18px] leading-relaxed pb-1 text-foreground/80 mb-3",
              activeFontCombo.serifClass,
            )}
            style={{ fontFamily: "var(--font-display)" }}
          >
            {title}
          </h2>
        )}
        {headerAction}
      </div>
      <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden rounded-2xl border bg-card not-dark:bg-clip-padding text-card-foreground shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
        {children}
      </div>
    </section>
  );
}

function ExpandableHeaderSearch({
  query,
  onChange,
  isOpen,
  onOpenChange,
  inputRef,
  collapsedAccessory,
}: {
  query: string;
  onChange: (next: string) => void;
  isOpen: boolean;
  onOpenChange: (next: boolean) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  collapsedAccessory?: ReactNode;
}) {
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        inputRef?.current?.focus();
        inputRef?.current?.select();
      });
    }
  }, [isOpen, inputRef]);

  return (
    <div
      className={cn(
        "relative flex h-8 items-center rounded-md border text-xs transition-all duration-300 ease-in-out overflow-hidden shrink-0",
        isOpen
          ? "w-64 border-border bg-background shadow-xs ring-1 ring-ring/30"
          : "w-9 border-border/60 bg-background/60 hover:bg-accent/50 hover:border-border text-muted-foreground hover:text-foreground cursor-pointer justify-center",
      )}
      onClick={() => {
        if (!isOpen) {
          onOpenChange(true);
        }
      }}
    >
      {collapsedAccessory && !isOpen ? collapsedAccessory : null}

      {!isOpen ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="flex size-full items-center justify-center text-muted-foreground transition-colors hover:text-foreground outline-none"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenChange(true);
                }}
                aria-label="Search keybindings"
              >
                <SearchIcon className="size-4 shrink-0" />
              </button>
            }
          />
          <TooltipPopup side="top">Search keybindings (⌘F)</TooltipPopup>
        </Tooltip>
      ) : (
        <div className="flex w-full items-center px-2.5">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => onChange(event.currentTarget.value)}
            onBlur={() => {
              if (query.trim().length === 0) {
                onOpenChange(false);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onChange("");
                onOpenChange(false);
              }
            }}
            placeholder="Search keybindings..."
            aria-label="Search keybindings"
            className="w-full bg-transparent pl-2 pr-1 text-xs text-foreground placeholder:text-muted-foreground/70 outline-none"
          />
          {query.length > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
                inputRef?.current?.focus();
              }}
              className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Clear search"
            >
              <XIcon className="size-3" />
            </button>
          ) : (
            <Kbd className="h-4 px-1 text-[9px] text-muted-foreground/70 bg-muted/40 border-border/30 shrink-0">
              Esc
            </Kbd>
          )}
        </div>
      )}
    </div>
  );
}

type BooleanOperator = "and" | "or";

function flattenWhenChildren(
  node: KeybindingWhenNode,
  operator: BooleanOperator,
): KeybindingWhenNode[] {
  if (node.type !== operator) return [node];
  return [
    ...flattenWhenChildren(node.left, operator),
    ...flattenWhenChildren(node.right, operator),
  ];
}

function buildWhenExpressionGroup(
  children: readonly KeybindingWhenNode[],
  operator: BooleanOperator,
): KeybindingWhenNode | undefined {
  const first = children[0];
  if (!first) return undefined;
  return children.slice(1).reduce<KeybindingWhenNode>(
    (left, right) => ({
      type: operator,
      left,
      right,
    }),
    first,
  );
}

function conditionParts(node: KeybindingWhenNode): { identifier: string; negated: boolean } | null {
  if (node.type === "identifier") return { identifier: node.name, negated: false };
  if (node.type === "not" && node.node.type === "identifier") {
    return { identifier: node.node.name, negated: true };
  }
  return null;
}

function setConditionIdentifier(node: KeybindingWhenNode, identifier: string): KeybindingWhenNode {
  const parts = conditionParts(node);
  if (!parts) return node;
  const next: KeybindingWhenNode = { type: "identifier", name: identifier };
  return parts.negated ? { type: "not", node: next } : next;
}

function setConditionNegated(node: KeybindingWhenNode, negated: boolean): KeybindingWhenNode {
  const parts = conditionParts(node);
  if (!parts) return negated ? { type: "not", node } : node;
  const identifier: KeybindingWhenNode = { type: "identifier", name: parts.identifier };
  return negated ? { type: "not", node: identifier } : identifier;
}

function defaultWhenCondition(): KeybindingWhenNode {
  return { type: "identifier", name: DEFAULT_WHEN_VARIABLE };
}

function defaultWhenGroup(operator: BooleanOperator = "and"): KeybindingWhenNode {
  return {
    type: operator,
    left: defaultWhenCondition(),
    right: { type: "not", node: defaultWhenCondition() },
  };
}

function UnknownWhenVariableWarning({
  identifiers,
  focusable = true,
}: {
  identifiers: ReadonlyArray<string>;
  focusable?: boolean;
}) {
  if (identifiers.length === 0) return null;
  const label =
    identifiers.length === 1
      ? `Unknown condition: ${identifiers[0]}`
      : `Unknown conditions: ${identifiers.join(", ")}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={focusable ? 0 : undefined}
            aria-label={label}
            className="inline-flex size-4.5 shrink-0 items-center justify-center rounded-sm text-warning outline-none transition-colors hover:bg-warning/10 focus-visible:ring-[3px] focus-visible:ring-warning/25"
          >
            <TriangleAlertIcon className="size-3.5" />
          </span>
        }
      />
      <TooltipPopup side="top" className="max-w-72 whitespace-normal leading-relaxed">
        This condition is not explicitly recognized. It can still be saved, but it may not match
        unless the runtime provides it.
      </TooltipPopup>
    </Tooltip>
  );
}

function KeybindingConflictWarning({ labels }: { labels: ReadonlyArray<string> }) {
  if (labels.length === 0) return null;
  const description =
    labels.length === 1
      ? `Conflicts with ${labels[0]}.`
      : `Conflicts with ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ", and more" : ""}.`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-label={description}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-warning outline-none transition-colors hover:bg-warning/10 focus-visible:ring-[3px] focus-visible:ring-warning/25"
          >
            <TriangleAlertIcon className="size-3.5" />
          </span>
        }
      />
      <TooltipPopup side="top" className="max-w-72 whitespace-normal leading-relaxed">
        {description} The most recent matching binding wins when both conditions can apply.
      </TooltipPopup>
    </Tooltip>
  );
}

function WhenVariableSelect({
  value,
  variables,
  unknownIdentifiers,
  onChange,
}: {
  value: string;
  variables: ReadonlyArray<WhenVariableOption>;
  unknownIdentifiers?: ReadonlyArray<string>;
  onChange: (value: string) => void;
}) {
  const selected = variables.find((option) => option === value);
  const options =
    selected || variables.some((option) => option === value) ? variables : [value, ...variables];

  return (
    <Select value={value} onValueChange={(nextValue) => nextValue && onChange(nextValue)}>
      <SelectTrigger
        size="xs"
        className="h-7 min-h-7 min-w-0 flex-1 rounded-md font-mono text-xs sm:h-7"
      >
        <SelectValue placeholder="Condition" className="leading-7" />
        {unknownIdentifiers && unknownIdentifiers.length > 0 ? (
          <UnknownWhenVariableWarning identifiers={unknownIdentifiers} focusable={false} />
        ) : null}
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="max-h-72 w-fit min-w-44">
        {options.map((option) => (
          <SelectItem
            key={option}
            value={option}
            className="min-h-7 w-full py-1 font-mono text-[12px]"
          >
            <span className="truncate">{option}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function WhenExpressionRemoveButton({
  label,
  className,
  onRemove,
}: {
  label: string;
  className?: string | undefined;
  onRemove: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn("size-7 sm:size-7", className)}
            aria-label={label}
            onClick={onRemove}
          />
        }
      >
        <MinusIcon aria-hidden className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

function WhenExpressionNodeEditor({
  node,
  variables,
  depth = 0,
  onChange,
  onRemove,
}: {
  node: KeybindingWhenNode;
  variables: ReadonlyArray<WhenVariableOption>;
  depth?: number;
  onChange: (node: KeybindingWhenNode) => void;
  onRemove?: () => void;
}) {
  const condition = conditionParts(node);

  if (condition) {
    const unknownIdentifiers = isKnownWhenVariable(condition.identifier)
      ? []
      : [condition.identifier];

    return (
      <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background/60 px-2 py-2">
        <Toggle
          pressed={condition.negated}
          onPressedChange={(pressed) => onChange(setConditionNegated(node, pressed))}
          aria-label={`Negate ${condition.identifier}`}
          variant="outline"
          size="xs"
          className="h-7 min-w-10 px-2 text-[11px] sm:h-7"
        >
          Not
        </Toggle>
        <WhenVariableSelect
          value={condition.identifier}
          variables={variables}
          unknownIdentifiers={unknownIdentifiers}
          onChange={(value) => onChange(setConditionIdentifier(node, value))}
        />
        {onRemove ? (
          <WhenExpressionRemoveButton
            label={whenNodeRemoveLabel(node, depth)}
            onRemove={onRemove}
          />
        ) : null}
      </div>
    );
  }

  if (node.type === "not") {
    return (
      <div
        className={cn(
          "space-y-2 rounded-lg border border-border/70 bg-muted/20 p-2",
          depth > 0 && "border-border/50 bg-background/50",
        )}
      >
        <div className="flex items-center gap-2">
          <Toggle
            pressed
            onPressedChange={(pressed) => onChange(pressed ? node : node.node)}
            aria-label="Negate group"
            variant="outline"
            size="xs"
            className="h-7 min-w-10 px-2 text-[11px] sm:h-7"
          >
            Not
          </Toggle>
          {onRemove ? (
            <WhenExpressionRemoveButton
              label={whenNodeRemoveLabel(node, depth)}
              className="ml-auto"
              onRemove={onRemove}
            />
          ) : null}
        </div>
        <div className="relative pl-4">
          <span className="absolute top-0 bottom-0 left-1.5 w-px bg-border/70" aria-hidden />
          <span className="absolute top-4 left-1.5 h-px w-2.5 bg-border/70" aria-hidden />
          <WhenExpressionNodeEditor
            node={node.node}
            variables={variables}
            depth={depth + 1}
            onChange={(next) => onChange({ type: "not", node: next })}
          />
        </div>
      </div>
    );
  }

  const operator: BooleanOperator = node.type === "or" ? "or" : "and";
  const children = flattenWhenChildren(node, operator);
  const childKeyCounts = new Map<string, number>();
  const childEntries = children.map((child) => {
    const baseKey = `${child.type}-${whenAstToExpression(child)}`;
    const count = childKeyCounts.get(baseKey) ?? 0;
    childKeyCounts.set(baseKey, count + 1);
    return { child, key: count === 0 ? baseKey : `${baseKey}-${count}` };
  });

  const updateChild = (target: KeybindingWhenNode, next: KeybindingWhenNode) => {
    let didUpdate = false;
    const nextChildren = children.map((child) => {
      if (!didUpdate && child === target) {
        didUpdate = true;
        return next;
      }
      return child;
    });
    const nextNode = buildWhenExpressionGroup(nextChildren, operator);
    if (nextNode) onChange(nextNode);
  };

  const removeChild = (target: KeybindingWhenNode) => {
    let didRemove = false;
    const nextChildren = children.filter((child) => {
      if (!didRemove && child === target) {
        didRemove = true;
        return false;
      }
      return true;
    });
    const nextNode = buildWhenExpressionGroup(nextChildren, operator);
    if (nextNode) {
      onChange(nextNode);
    } else {
      onChange(defaultWhenCondition());
    }
  };

  const setOperator = (nextOperator: BooleanOperator) => {
    if (nextOperator === operator) return;
    const nextNode = buildWhenExpressionGroup(children, nextOperator);
    if (nextNode) onChange(nextNode);
  };

  const addCondition = () => {
    const nextNode = buildWhenExpressionGroup([...children, defaultWhenCondition()], operator);
    if (nextNode) onChange(nextNode);
  };

  const addGroup = () => {
    const nestedOperator: BooleanOperator = operator === "and" ? "or" : "and";
    const group: KeybindingWhenNode = {
      type: nestedOperator,
      left: defaultWhenCondition(),
      right: { type: "not", node: defaultWhenCondition() },
    };
    const nextNode = buildWhenExpressionGroup([...children, group], operator);
    if (nextNode) onChange(nextNode);
  };

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border border-border/60 bg-muted/10 p-2",
        depth > 0 && "border-border/70 bg-background/55",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select value={operator} onValueChange={(value) => setOperator(value as BooleanOperator)}>
          <SelectTrigger size="xs" className="h-7 min-h-7 w-24 rounded-md text-xs sm:h-7">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} className="w-fit min-w-24">
            <SelectItem value="and" className="min-h-7 py-1 font-mono text-[12px]">
              and
            </SelectItem>
            <SelectItem value="or" className="min-h-7 py-1 font-mono text-[12px]">
              or
            </SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-7 sm:h-7"
          onClick={addCondition}
        >
          <PlusIcon className="size-3.5" />
          Condition
        </Button>
        <Button type="button" variant="outline" size="xs" className="h-7 sm:h-7" onClick={addGroup}>
          <PlusIcon className="size-3.5" />
          Group
        </Button>
        {onRemove ? (
          <WhenExpressionRemoveButton
            label={whenNodeRemoveLabel(node, depth)}
            className="ml-auto"
            onRemove={onRemove}
          />
        ) : null}
      </div>
      <div className="space-y-2">
        {childEntries.map(({ child, key }) => (
          <div key={key} className="relative pl-4">
            <span
              className={cn(
                "absolute top-0 bottom-0 left-1.5 w-px",
                depth === 0 ? "bg-border" : "bg-border/70",
              )}
              aria-hidden
            />
            <span
              className={cn(
                "absolute top-4 left-1.5 h-px w-2.5",
                depth === 0 ? "bg-border" : "bg-border/70",
              )}
              aria-hidden
            />
            <WhenExpressionNodeEditor
              node={child}
              variables={variables}
              depth={depth + 1}
              onChange={(next) => updateChild(child, next)}
              onRemove={() => removeChild(child)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function WhenExpressionBuilder({
  value,
  variables,
  onChange,
  onValidityChange,
  className,
}: {
  value: KeybindingWhenNode | undefined;
  variables: ReadonlyArray<WhenVariableOption>;
  onChange: (value: KeybindingWhenNode | undefined) => void;
  onValidityChange?: (valid: boolean) => void;
  className?: string;
}) {
  const expression = whenAstToExpression(value);
  const [expressionDraft, setExpressionDraft] = useState(expression);
  const parseResult = useMemo(() => parseWhenExpressionDraft(expressionDraft), [expressionDraft]);
  const parseError = parseResult.ok ? null : parseResult.message;
  const unknownIdentifiers = parseResult.ok ? unknownWhenVariables(parseResult.value) : [];

  const updateExpressionDraft = (nextExpression: string) => {
    setExpressionDraft(nextExpression);
    const nextResult = parseWhenExpressionDraft(nextExpression);
    onValidityChange?.(nextResult.ok);
    if (nextResult.ok) {
      onChange(nextResult.value);
    }
  };

  const updateExpressionValue = (nextValue: KeybindingWhenNode | undefined) => {
    setExpressionDraft(whenAstToExpression(nextValue));
    onValidityChange?.(true);
    onChange(nextValue);
  };

  const addRootCondition = () => {
    if (!value) {
      updateExpressionValue(defaultWhenCondition());
      return;
    }
    updateExpressionValue({ type: "and", left: value, right: defaultWhenCondition() });
  };

  const addRootGroup = () => {
    const group = defaultWhenGroup("or");
    if (!value) {
      updateExpressionValue(group);
      return;
    }
    updateExpressionValue({ type: "and", left: value, right: group });
  };

  return (
    <div className={cn("w-full space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            When Expression <span className="font-normal text-muted-foreground/60">(Optional)</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-7 sm:h-7"
            onClick={addRootCondition}
          >
            <PlusIcon className="size-3.5 mr-1" />
            Condition
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-7 sm:h-7"
            onClick={addRootGroup}
          >
            <PlusIcon className="size-3.5 mr-1" />
            Group
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="relative">
          <Input
            value={expressionDraft}
            onChange={(event) => updateExpressionDraft(event.currentTarget.value)}
            placeholder="e.g. editorTextFocus && !inQuickOpen"
            aria-invalid={Boolean(parseError)}
            aria-label="When expression"
            className={cn(
              "h-8 rounded-md font-mono text-[12px] leading-8 sm:h-8 sm:leading-8",
              unknownIdentifiers.length > 0 && "pr-9",
              parseError && "border-destructive/70 focus-visible:border-destructive",
            )}
          />
          {unknownIdentifiers.length > 0 ? (
            <span className="absolute inset-y-0 right-2 flex items-center">
              <UnknownWhenVariableWarning identifiers={unknownIdentifiers} />
            </span>
          ) : null}
        </div>
        {parseError ? (
          <div className="flex items-center gap-1.5 text-[11px] text-destructive">
            <CircleXIcon className="size-3.5" />
            {parseError}
          </div>
        ) : null}
      </div>

      <div className="relative">
        {value ? (
          <WhenExpressionNodeEditor
            node={value}
            variables={variables}
            onChange={updateExpressionValue}
            onRemove={() => updateExpressionValue(undefined)}
          />
        ) : (
          <div className="rounded-md border border-dashed border-border/60 bg-muted/10 p-3 text-center text-xs text-muted-foreground">
            Applies in all contexts. Click{" "}
            <span className="font-medium text-foreground">+ Condition</span> or{" "}
            <span className="font-medium text-foreground">+ Group</span> above to restrict when this
            shortcut is active.
          </div>
        )}
        {parseError ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border border-destructive/30 bg-background/75 p-4 text-center text-xs text-destructive backdrop-blur-[1px]">
            Fix the expression above to continue editing visually.
          </div>
        ) : null}
      </div>
    </div>
  );
}

type KeybindingRowDraftState = {
  keyDraft: string;
  whenDraft: KeybindingWhenNode | undefined;
  isRecording: boolean;
  isWhenDraftValid: boolean;
};

function createKeybindingRowDraft(row: KeybindingRow): KeybindingRowDraftState {
  return {
    keyDraft: row.key,
    whenDraft: row.binding.whenAst,
    isRecording: false,
    isWhenDraftValid: true,
  };
}

function keybindingRowDraftReducer(
  state: KeybindingRowDraftState,
  patch: Partial<KeybindingRowDraftState>,
): KeybindingRowDraftState {
  return { ...state, ...patch };
}

function rowKeybindingTarget(row: KeybindingRow): KeybindingRule {
  return {
    command: row.command,
    key: row.key,
    ...(row.when.trim().length > 0 ? { when: row.when } : {}),
  };
}

function KeybindingTableRow({
  row,
  allRows,
  variables,
  isSaving,
  onSave,
  onReset,
  onRemove,
  platform,
}: {
  row: KeybindingRow;
  allRows: ReadonlyArray<KeybindingRow>;
  variables: ReadonlyArray<WhenVariableOption>;
  isSaving: boolean;
  onSave: (input: KeybindingRule) => void;
  onReset: (row: KeybindingRow) => void;
  onRemove: (row: KeybindingRow) => void;
  platform: string;
}) {
  const [draft, setDraft] = useReducer(keybindingRowDraftReducer, row, createKeybindingRowDraft);
  const { keyDraft, whenDraft, isRecording, isWhenDraftValid } = draft;
  const whenDraftExpression = whenAstToExpression(whenDraft);
  const isDirty = keyDraft !== row.key || whenDraftExpression !== row.when;
  const displayShortcut = formatShortcutLabel(row.binding.shortcut, platform);
  const canReset = row.source === "Custom" && row.defaultKey !== null;
  const canRemove = row.source !== "Default";
  const hasRowActions = canReset || canRemove;
  const showPill = !isRecording && keyDraft === row.key && row.key.length > 0 && !isDirty;
  const conflictLabels = keybindingConflictLabels(allRows, {
    rowId: row.id,
    key: keyDraft,
    when: whenDraftExpression,
  });

  const save = () => {
    onSave({
      command: row.command,
      key: keyDraft,
      when: whenDraftExpression.trim().length > 0 ? whenDraftExpression : undefined,
    });
  };

  const captureKeybinding = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) return;
    event.preventDefault();
    if (event.key === "Escape") {
      setDraft({ keyDraft: row.key, isRecording: false });
      return;
    }
    const next = keybindingFromKeyboardEvent(event.nativeEvent, platform);
    if (!next) return;
    setDraft({ keyDraft: next, isRecording: false });
  };

  return (
    <div className="grid grid-cols-[minmax(190px,1.1fr)_minmax(220px,0.85fr)_minmax(210px,1fr)_60px] items-center px-4 py-1.5 text-sm even:bg-muted/15 hover:bg-accent/40">
      <div className="min-w-0 pr-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <div
                  aria-label={row.command}
                  className="truncate text-[13px] font-medium text-foreground"
                />
              }
            >
              {commandLabel(row.command)}
            </TooltipTrigger>
            <TooltipPopup side="top">{row.command}</TooltipPopup>
          </Tooltip>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2 pr-4">
        {showPill ? (
          <button
            type="button"
            onClick={() => setDraft({ isRecording: true })}
            aria-label={`Edit shortcut for ${commandLabel(row.command)}`}
            className="group inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-1.5 outline-none transition-colors hover:border-border/70 hover:bg-background focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24"
          >
            <Kbd>{displayShortcut || "Unassigned"}</Kbd>
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/0 transition-opacity group-hover:text-muted-foreground/70 group-focus-visible:text-muted-foreground/70">
              Edit
            </span>
          </button>
        ) : (
          <Input
            autoFocus={isRecording}
            aria-label={`Keybinding for ${commandLabel(row.command)}`}
            value={isRecording ? "" : keyDraft}
            placeholder={isRecording ? "Press shortcut" : "Unassigned"}
            className={cn(
              "h-7 w-44 rounded-md font-mono text-[12px] sm:h-7",
              isRecording && "border-primary/70 bg-primary/5",
            )}
            onFocus={() => setDraft({ isRecording: true })}
            onBlur={() => setDraft({ isRecording: false })}
            onChange={(event) => setDraft({ keyDraft: event.currentTarget.value })}
            onKeyDown={captureKeybinding}
          />
        )}
        {isDirty ? (
          <Button
            size="xs"
            className="h-7 sm:h-7"
            disabled={isSaving || keyDraft.trim().length === 0 || !isWhenDraftValid}
            onClick={save}
          >
            {isSaving ? "Saving" : "Save"}
          </Button>
        ) : null}
      </div>
      <div className="pr-4">
        <Popover>
          <PopoverTrigger
            className={cn(
              "inline-flex h-7 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-left font-mono text-[12px] text-foreground shadow-xs/5 outline-none transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24",
              !whenDraftExpression && "text-muted-foreground",
            )}
            aria-label={`Edit when clause for ${commandLabel(row.command)}`}
          >
            <span className="truncate">{whenDraftExpression || "Always"}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6}>
            <WhenExpressionBuilder
              value={whenDraft}
              variables={variables}
              onChange={(nextWhenDraft) => setDraft({ whenDraft: nextWhenDraft })}
              onValidityChange={(nextIsValid) => setDraft({ isWhenDraftValid: nextIsValid })}
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex items-center justify-end gap-1">
        <KeybindingConflictWarning labels={conflictLabels} />
        {hasRowActions ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 text-muted-foreground hover:text-foreground sm:size-7"
                  disabled={isSaving}
                  aria-label={`Actions for ${commandLabel(row.command)}`}
                />
              }
            >
              <EllipsisIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-36">
              {canReset ? (
                <MenuItem disabled={isSaving} onClick={() => onReset(row)}>
                  Reset to default
                </MenuItem>
              ) : null}
              {canRemove ? (
                <MenuItem variant="destructive" disabled={isSaving} onClick={() => onRemove(row)}>
                  Remove
                </MenuItem>
              ) : null}
            </MenuPopup>
          </Menu>
        ) : null}
        <span className="sr-only">{displayShortcut}</span>
      </div>
    </div>
  );
}
export function KeybindingsSettings({
  keybindings,
  onUpsert,
  onBatchUpsert,
  onBatchRemove,
  onRemove,
  keybindingsConfigPath,
  availableEditors,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
}: KeybindingsSettingsProps) {
  const { fontPreferences } = useTheme();
  const activeFontCombo = getActiveFontCombo(fontPreferences);
  const { confirm, confirmDialog } = useConfirm();
  const [query, setQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [savingCommand, setSavingCommand] = useState<KeybindingCommand | null>(null);
  const [isRestoringDefaults, setIsRestoringDefaults] = useState(false);

  const [activeTab, setActiveTab] = useState("All");
  const rows = useMemo(() => buildKeybindingRows(keybindings, query), [keybindings, query]);
  const commandOptions = useMemo(() => buildKeybindingCommandOptions(keybindings), [keybindings]);
  const whenVariables = useMemo(() => buildWhenVariableOptions(), []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod || event.altKey || event.key.toLowerCase() !== "f") return;

      const target = event.target;
      if (
        target !== searchInputRef.current &&
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      setIsSearchOpen(true);
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const openKeybindingsFile = useCallback(() => {
    if (!keybindingsConfigPath) return;
    const api = ensureNativeApi();
    const editor = resolveAndPersistPreferredEditor((availableEditors ?? []) as ReadonlyArray<any>);
    if (!editor) {
      toastManager.add({
        title: "Unable to open keybindings file",
        description: "No available editors found.",
        type: "error",
      });
      return;
    }
    void api.shell
      .openInEditor(keybindingsConfigPath, editor)
      .then(() => {})
      .catch((error: unknown) => {
        toastManager.add({
          title: "Unable to open keybindings file",
          description:
            error instanceof Error ? error.message : "The keybindings file was not opened.",
          type: "error",
        });
      });
  }, [keybindingsConfigPath, availableEditors]);

  const saveKeybinding = useCallback(
    (input: KeybindingRule) => {
      setSavingCommand(input.command);
      void Promise.resolve(onUpsert(input))
        .catch((error: unknown) => {
          toastManager.add({
            title: "Unable to save keybinding",
            description: error instanceof Error ? error.message : "The keybinding was not saved.",
            type: "error",
          });
        })
        .finally(() => {
          setSavingCommand(null);
        });
    },
    [onUpsert],
  );

  const removeKeybinding = useCallback(
    (row: KeybindingRow) => {
      setSavingCommand(row.command);
      void Promise.resolve(onRemove(rowKeybindingTarget(row)))
        .catch((error: unknown) => {
          toastManager.add({
            title: "Unable to remove keybinding",
            description: error instanceof Error ? error.message : "The keybinding was not removed.",
            type: "error",
          });
        })
        .finally(() => {
          setSavingCommand(null);
        });
    },
    [onRemove],
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (isImporting) return;
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = (e.target?.result as string) ?? "";
        const { validRules, skippedCommands } = parseAndValidateKeybindingImport(
          content,
          commandOptions,
        );

        // Submit complete validated import as one batch operation
        let committedCount = validRules.length;
        const res = await onBatchUpsert(validRules);
        if (
          res &&
          typeof res === "object" &&
          "importedCount" in res &&
          typeof (res as any).importedCount === "number"
        ) {
          committedCount = (res as any).importedCount;
        }

        const skippedMsg =
          skippedCommands.length > 0 ? ` (${skippedCommands.length} unsupported skipped)` : "";
        toastManager.add({
          title: "Import Successful",
          description: `Imported ${committedCount} keybindings${skippedMsg}.`,
          type: "success",
        });
      } catch (err) {
        toastManager.add({
          title: "Import Failed",
          description: err instanceof Error ? err.message : "Invalid keybindings file format.",
          type: "error",
        });
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    };

    reader.onerror = () => {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      toastManager.add({
        title: "Import Failed",
        description: "Failed to read the keybindings file.",
        type: "error",
      });
    };

    reader.readAsText(file);
  };

  const resetKeybinding = useCallback(
    (row: KeybindingRow) => {
      if (!row.defaultKey) return;
      saveKeybinding({
        command: row.command,
        key: row.defaultKey,
        when: row.defaultWhen.trim().length > 0 ? row.defaultWhen : undefined,
      });
    },
    [saveKeybinding],
  );

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  return (
    <>
      {confirmDialog}
      <AddKeybindingDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        commandOptions={commandOptions}
        allRows={rows}
        variables={whenVariables}
        isSaving={savingCommand !== null}
        onSave={saveKeybinding}
        platform={platform}
      />
      <section className="space-y-6">
        <div className="border-b border-border/50 pb-5">
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <h2
                  className={cn(
                    "text-[28px] leading-relaxed pb-1 text-foreground mb-2 font-bold",
                    activeFontCombo.sansClass,
                  )}
                  style={{ fontFamily: "var(--font-sans)", textTransform: "capitalize" }}
                >
                  Keybindings
                </h2>
                <span className="flex h-5 items-center justify-center rounded-full bg-primary/10 px-2 text-[11px] font-medium text-primary">
                  {rows.length} {rows.length === 1 ? "binding" : "bindings"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Manage your application keyboard shortcuts and custom bindings.
              </p>
            </div>

            <SettingsHeaderPortal>
              <Button
                size="xs"
                variant="outline"
                className="no-drag"
                disabled={isRestoringDefaults || !rows.some((r) => r.source === "Custom")}
                aria-busy={isRestoringDefaults}
                onClick={async () => {
                  const confirmed = await confirm(
                    "Restore default keybindings?\n\nThis will remove all custom shortcuts.",
                  );
                  if (!confirmed) return;

                  const customRows = rows.filter((r) => r.source === "Custom");
                  if (customRows.length === 0) return;
                  setIsRestoringDefaults(true);
                  try {
                    const rules = customRows.map(rowKeybindingTarget);
                    const result = onBatchRemove
                      ? await onBatchRemove(rules)
                      : await Promise.allSettled(
                          rules.map((rule) => Promise.resolve(onRemove(rule))),
                        ).then((results) => ({
                          removedCount: results.filter((item) => item.status === "fulfilled")
                            .length,
                          failedCount: results.filter((item) => item.status === "rejected").length,
                        }));
                    toastManager.add(
                      result.failedCount > 0
                        ? {
                            title: "Some keybindings could not be removed",
                            description: `Removed ${result.removedCount}; ${result.failedCount} custom shortcut${result.failedCount === 1 ? " remains" : "s remain"}.`,
                            type: "error",
                          }
                        : {
                            title: "Default keybindings restored",
                            description: `Removed ${result.removedCount} custom shortcut${result.removedCount === 1 ? "" : "s"}.`,
                            type: "success",
                          },
                    );
                  } catch (error) {
                    toastManager.add({
                      title: "Could not restore all keybindings",
                      description:
                        error instanceof Error ? error.message : "Some shortcuts may remain.",
                      type: "error",
                    });
                  } finally {
                    setIsRestoringDefaults(false);
                  }
                }}
              >
                {isRestoringDefaults ? (
                  <LoaderCircleIcon className="size-3.5 mr-1 animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCcwIcon className="size-3.5 mr-1" aria-hidden="true" />
                )}
                {isRestoringDefaults ? "Restoring…" : "Restore defaults"}
              </Button>
            </SettingsHeaderPortal>
          </div>
          <div
            className="h-[5px] w-full my-5 rounded-full dark:block hidden"
            style={{ background: "linear-gradient(to right, rgba(255,255,255,0.25), transparent)" }}
          />
          <div
            className="h-[5px] w-full my-5 rounded-full dark:hidden block"
            style={{ background: "linear-gradient(to right, rgba(0,0,0,0.12), transparent)" }}
          />
          <div className="flex items-center justify-start gap-2 pt-1">
            <ExpandableHeaderSearch
              query={query}
              onChange={setQuery}
              isOpen={isSearchOpen}
              onOpenChange={setIsSearchOpen}
              inputRef={searchInputRef}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-2 px-3"
              onClick={() => setIsAddDialogOpen(true)}
              aria-label="Add keybinding"
            >
              <PlusIcon className="size-4" />
              Add keybinding
            </Button>
            <input
              type="file"
              accept=".json"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-2 px-3"
              disabled={isImporting}
              aria-busy={isImporting}
              onClick={handleImportClick}
              aria-label="Import keybindings"
            >
              <DownloadIcon className="size-4" />
              {isImporting ? "Importing..." : "Import"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-2 px-3"
              disabled={!keybindingsConfigPath}
              onClick={openKeybindingsFile}
              aria-label="Open keybindings.json"
            >
              <FileJsonIcon className="size-4" />
              Open JSON
            </Button>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border bg-card not-dark:bg-clip-padding text-card-foreground shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
          {!isElectron ? (
            <div className="flex items-center gap-3 bg-warning/5 px-5 py-3 text-sm text-warning-foreground border-b border-border/40 font-medium">
              <InfoIcon className="size-4 shrink-0" />
              <p>
                Some shortcuts may be claimed by the browser before the app sees them. Use the
                desktop version for full support.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 border-b border-border/40 bg-muted/10 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                <InfoIcon className="size-4" />
              </div>
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3 text-[13px] text-muted-foreground">
                <span>
                  <strong className="font-medium text-foreground">Project switching</strong> (
                  <Kbd className="h-5 px-1.5 text-[10px] bg-muted/50 border border-border/40 shadow-none">
                    Ctrl
                  </Kbd>{" "}
                  <span className="opacity-50">+</span>{" "}
                  <Kbd className="h-5 px-1.5 text-[10px] bg-muted/50 border border-border/40 shadow-none">
                    Tab
                  </Kbd>
                  ) may be intercepted by terminal tools.
                </span>
                <span className="hidden h-3.5 w-px bg-border/60 sm:inline-block"></span>
                <span>
                  <strong className="font-medium text-foreground">Reliable alternative:</strong>{" "}
                  <Kbd className="h-5 px-1.5 text-[10px] bg-muted/50 border border-border/40 shadow-none">
                    {isMacPlatform(platform) ? "⌘" : "Ctrl"}
                  </Kbd>{" "}
                  <span className="opacity-50">+</span>{" "}
                  <Kbd className="h-5 px-1.5 text-[10px] bg-muted/50 border border-border/40 shadow-none">
                    Shift
                  </Kbd>{" "}
                  <span className="opacity-50">+</span>{" "}
                  <Kbd className="h-5 px-1.5 text-[10px] bg-muted/50 border border-border/40 shadow-none">
                    [
                  </Kbd>{" "}
                  <span className="text-[11px] opacity-60">or</span>{" "}
                  <Kbd className="h-5 px-1.5 text-[10px] bg-muted/50 border border-border/40 shadow-none">
                    ]
                  </Kbd>
                </span>
              </div>
            </div>
          )}

          {(() => {
            const groups: Record<string, KeybindingRow[]> = {};
            for (const row of rows) {
              const label = commandLabel(row.command);
              const parts = label.split(":");
              const category = parts.length > 1 ? (parts[0] || "General").trim() : "General";
              if (!groups[category]) {
                groups[category] = [];
              }
              groups[category]!.push(row);
            }
            const sortedGroups = Object.entries(groups).sort(([a], [b]) => {
              if (a === "General") return -1;
              if (b === "General") return 1;
              return a.localeCompare(b);
            });
            const allCategories = ["All", ...sortedGroups.map(([c]) => c)];

            const categoryIcons: Record<string, React.ReactNode> = {
              General: <KeyboardIcon className="size-5" />,
              Chat: <MessageSquareIcon className="size-5" />,
              Diff: <SplitIcon className="size-5" />,
              Editor: <CodeIcon className="size-5" />,
              Project: <TabletSmartphoneIcon className="size-5" />,
              Terminal: <SquareTerminalIcon className="size-5" />,
              "Toolbar Tools": <WrenchIcon className="size-5" />,
            };

            const renderTable = (tableRows: readonly KeybindingRow[]) => (
              <ScrollArea
                scrollFade
                hideScrollbars
                className="w-full max-w-full rounded-none h-full min-h-0 flex-1"
              >
                <div className="flex flex-col min-w-[680px]">
                  <div className="grid grid-cols-[minmax(190px,1.1fr)_minmax(220px,0.85fr)_minmax(210px,1fr)_60px] border-b border-border/70 bg-muted/25 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground sticky top-0 z-10 backdrop-blur-md">
                    <div>Command</div>
                    <div>Keybinding</div>
                    <div>When</div>
                    <div>Status</div>
                  </div>
                  <div className="divide-y divide-border/40 pb-8">
                    {tableRows.map((row) => (
                      <KeybindingTableRow
                        key={row.id}
                        row={row}
                        allRows={rows}
                        variables={whenVariables}
                        isSaving={savingCommand === row.command}
                        onSave={saveKeybinding}
                        onReset={resetKeybinding}
                        onRemove={removeKeybinding}
                        platform={platform}
                      />
                    ))}

                    {tableRows.length === 0 ? (
                      <div className="py-12 text-center text-sm text-muted-foreground">
                        No keybindings found in this category.
                      </div>
                    ) : null}
                  </div>
                </div>
              </ScrollArea>
            );

            return (
              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex flex-col flex-1 min-h-0 w-full"
              >
                <TabsContent
                  value="All"
                  className="mt-0 flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden"
                >
                  {query.trim().length > 0 ? (
                    renderTable(rows)
                  ) : (
                    <ScrollArea
                      scrollFade
                      hideScrollbars
                      className="w-full max-w-full rounded-none h-full min-h-0 flex-1"
                    >
                      <div className="p-5">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {sortedGroups.map(([category, categoryRows]) => (
                            <button
                              key={category}
                              type="button"
                              onClick={() => setActiveTab(category)}
                              className="group flex flex-col gap-3 rounded-xl border border-border/50 bg-card p-4 text-left transition-all hover:border-border hover:bg-muted/30 hover:shadow-md active:scale-[0.98]"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                  <div className="flex size-8 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                    {categoryIcons[category] ?? <KeyboardIcon className="size-5" />}
                                  </div>
                                  <span className="text-sm font-semibold text-foreground">
                                    {category}
                                  </span>
                                </div>
                                <ChevronRightIcon className="size-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {categoryRows.length}{" "}
                                {categoryRows.length === 1 ? "binding" : "bindings"}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </ScrollArea>
                  )}
                </TabsContent>

                {sortedGroups.map(([category, categoryRows]) => (
                  <TabsContent
                    key={category}
                    value={category}
                    className="mt-0 flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden"
                  >
                    <div className="flex items-center gap-3 px-4 py-2 border-b border-border/60 bg-muted/10 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-md hover:bg-background/80"
                        onClick={() => setActiveTab("All")}
                      >
                        <ArrowLeftIcon className="size-4" />
                      </Button>
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-6 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
                          {categoryIcons[category] ?? <KeyboardIcon className="size-3.5" />}
                        </div>
                        <span className="text-xs font-bold uppercase tracking-[0.1em] text-foreground">
                          {category}
                        </span>
                      </div>
                    </div>
                    {renderTable(categoryRows)}
                  </TabsContent>
                ))}
              </Tabs>
            );
          })()}
        </div>
      </section>
    </>
  );
}

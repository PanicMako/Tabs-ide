import {
  ActivityIcon,
  ArrowUpRightIcon,
  BookOpenIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  CpuIcon,
  FileTextIcon,
  GitPullRequestIcon,
  GlobeIcon,
  InfoIcon,
  KeyboardIcon,
  LayersIcon,
  LightbulbIcon,
  ListChecksIcon,
  NetworkIcon,
  SearchIcon,
  ShieldIcon,
  TerminalIcon,
  TriangleAlertIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { useMemo, useState, type ComponentType, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useTheme } from "~/hooks/useTheme";
import { getActiveFontCombo } from "~/lib/themes";
import { cn } from "~/lib/utils";
import { SettingsSection } from "./SettingsLayout";
import { useSettingsViewState } from "~/state/scopedStateStore";

export type DocCategory =
  | "all"
  | "agents"
  | "environments"
  | "browser"
  | "git"
  | "diagnostics"
  | "shortcuts";

export interface DocStep {
  readonly step: number;
  readonly title: string;
  readonly description: string;
  readonly code?: string;
}

export interface DocCodeBlock {
  readonly language: string;
  readonly label: string;
  readonly code: string;
}

export interface DocTip {
  readonly kind: "tip" | "warning" | "info";
  readonly text: string;
}

export interface DocTopic {
  readonly id: string;
  readonly title: string;
  readonly category: DocCategory;
  readonly categoryLabel: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly summary: string;
  readonly details: string;
  readonly highlights: ReadonlyArray<string>;
  readonly steps?: ReadonlyArray<DocStep>;
  readonly codeBlocks?: ReadonlyArray<DocCodeBlock>;
  readonly tips?: ReadonlyArray<DocTip>;
  readonly shortcuts?: ReadonlyArray<{
    readonly label: string;
    readonly keys: ReadonlyArray<string>;
  }>;
  readonly action?: {
    readonly label: string;
    readonly section: string;
  };
}

const CATEGORIES: ReadonlyArray<{ readonly id: DocCategory; readonly label: string }> = [
  { id: "all", label: "All Topics" },
  { id: "agents", label: "Agents & Threads" },
  { id: "environments", label: "Remote Environments" },
  { id: "browser", label: "Browser Tools" },
  { id: "git", label: "Source Control" },
  { id: "diagnostics", label: "Diagnostics & System" },
  { id: "shortcuts", label: "Shortcuts" },
];

export const DOC_TOPICS: ReadonlyArray<DocTopic> = [
  {
    id: "composer-agents",
    title: "Composer & Coding Agents",
    category: "agents",
    categoryLabel: "Agents & Threads",
    icon: BotIcon,
    summary:
      "Create local or worktree threads, choose AI models and reasoning effort, attach files or browser context, and approve changes inline.",
    details:
      "Tabs wraps OpenAI Codex and Anthropic Claude in a persistent thread model. Each thread maintains its own conversation history, file context, and approval queue. Local threads apply edits directly to your working tree; worktree threads spin up an isolated git worktree so experiments never touch your main checkout.",
    highlights: [
      "Local threads apply code edits straight into the current checkout.",
      "Worktrees isolate experiments into separate branches and clean folders.",
      "Inline verification cards let you review bash commands and diffs before granting approval.",
      "Reasoning token budget controls cost vs. depth of multi-step planning.",
      "File and image attachments are included verbatim in the context window.",
    ],
    steps: [
      {
        step: 1,
        title: "Create a thread",
        description:
          "Press ⌘T or click the + button in the sidebar. Choose Local for direct edits, or Worktree to isolate work.",
      },
      {
        step: 2,
        title: "Select a model & reasoning level",
        description:
          "Use the model picker below the composer. Set reasoning effort to Low, Medium, or High depending on task complexity.",
      },
      {
        step: 3,
        title: "Write your prompt",
        description:
          "Describe what you want the agent to build or fix. Attach relevant files with @ mentions or drag-and-drop.",
      },
      {
        step: 4,
        title: "Review & approve",
        description:
          "Agent-proposed shell commands and file diffs appear in verification cards. Click Approve to execute, or Reject to skip.",
      },
    ],
    codeBlocks: [
      {
        language: "yaml",
        label: "Agent system prompt override (AGENTS.md)",
        code: `# AGENTS.md — place at your repo root
# This file is automatically injected into every thread context.

## Stack
- TypeScript 5, React 19, Vite 6
- Tailwind CSS v4, shadcn/ui components

## Conventions
- All new components live in src/components/
- Use Effect for all async patterns — no raw Promises
- Write unit tests for every new utility function`,
      },
    ],
    tips: [
      {
        kind: "tip",
        text: "Add an AGENTS.md file to your repo root to automatically inject coding conventions, stack preferences, and architectural rules into every new thread.",
      },
      {
        kind: "warning",
        text: "Always review bash commands in verification cards before approval. The agent can propose destructive file operations.",
      },
    ],
    action: {
      label: "Configure Providers & Models",
      section: "providers",
    },
  },
  {
    id: "remote-environments",
    title: "Remote Environments & Network",
    category: "environments",
    categoryLabel: "Remote Environments",
    icon: NetworkIcon,
    summary:
      "Connect to remote machines via direct HTTPS pairing, SSH tunneling, Tailscale MagicDNS, or Tabs Connect relay.",
    details:
      "Remote environments let you run agents against files and terminals on any machine — cloud VMs, home servers, or colleagues' workstations. Tabs verifies environment identity with cryptographic handshakes, maintains scoped sessions, and automatically renews WebSocket authorization after network reconnects.",
    highlights: [
      "Secure TLS WebSocket communication with scoped token renewal.",
      "Automatic MagicDNS discovery and private Let's Encrypt certificates via Tailscale.",
      "Zero cloud storage of passwords or sensitive private keys.",
      "SSH passwords are passed strictly to local SSH processes and never persisted.",
      "Multiple environments can be active simultaneously with independent thread sessions.",
    ],
    steps: [
      {
        step: 1,
        title: "Install Tabs server on the remote machine",
        description: "SSH into your remote machine and install the Tabs server process.",
        code: `curl -fsSL https://get.tabs.dev | sh
tabs-server start --port 8080`,
      },
      {
        step: 2,
        title: "Open Connections in Tabs",
        description:
          "Go to Settings → Connections and click Add Environment. Choose your connection method.",
      },
      {
        step: 3,
        title: "Enter the pairing URL",
        description:
          "Copy the pairing URL printed by tabs-server and paste it into the connection dialog.",
        code: `# The server prints something like:
Pairing URL: https://192.168.1.42:8080/pair/abc123xyz`,
      },
      {
        step: 4,
        title: "Verify the fingerprint",
        description:
          "Tabs shows a cryptographic fingerprint. Confirm it matches what the server printed to prevent MITM attacks.",
      },
    ],
    codeBlocks: [
      {
        language: "bash",
        label: "Tailscale MagicDNS auto-discovery",
        code: `# If Tailscale is installed, Tabs auto-discovers peers.
# No manual URL needed — just ensure the remote has tabs-server running:
tabs-server start --tailscale

# Tabs will list it as "my-macbook.tail12345.ts.net" in Connections.`,
      },
    ],
    tips: [
      {
        kind: "tip",
        text: "Use Tailscale for the easiest setup — zero port forwarding, automatic certificate management via Let's Encrypt, and MagicDNS discovery.",
      },
      {
        kind: "info",
        text: "Each remote environment gets an isolated thread namespace. Threads from different environments don't share context or history.",
      },
    ],
    action: {
      label: "Open Connections",
      section: "connections",
    },
  },
  {
    id: "browser-collaboration",
    title: "Browser Collaboration & DevTools",
    category: "browser",
    categoryLabel: "Browser Tools",
    icon: GlobeIcon,
    summary:
      "Share a dedicated persistent browser session with your agent while keeping full human control, DevTools, and visual annotations.",
    details:
      "Browser sessions use isolated browser profiles with dedicated user data directories. Human interactions immediately pause pending agent actions to prevent race conditions. The Pick Element tool captures live DOM coordinates and styles, while visual annotations let you draw ink markings and attach comments directly to message prompts.",
    highlights: [
      "Human-in-the-loop override interrupts stale agent web actions in real time.",
      "Pick Element extracts semantic DOM selectors, styles, and viewport bounding boxes.",
      "Visual canvas for freehand ink, highlight rectangles, and screenshot attachments.",
      "Isolated browser profile prevents session bleed between agent tasks.",
      "Full Chrome DevTools access alongside the agent's automated interactions.",
    ],
    steps: [
      {
        step: 1,
        title: "Open the Browser panel",
        description:
          "In the thread composer, click the Browser icon or press ⌘⇧B to attach a browser session to the current thread.",
      },
      {
        step: 2,
        title: "Navigate to your target page",
        description:
          "Use the address bar in the browser panel to navigate. The agent sees this as context for web-related tasks.",
      },
      {
        step: 3,
        title: "Use Pick Element for precise targeting",
        description:
          "Click the crosshair icon, then hover any element on the page. Tabs captures its CSS selector, computed styles, and bounding box.",
      },
      {
        step: 4,
        title: "Annotate with visual ink",
        description:
          "Switch to the Annotation tool to draw arrows, circles, or highlight areas. These annotations attach to your next message.",
      },
    ],
    tips: [
      {
        kind: "warning",
        text: "Click anywhere in the browser panel to immediately pause any in-progress agent action. The agent resumes only after you explicitly continue.",
      },
      {
        kind: "tip",
        text: "Use Pick Element to capture dynamic React component state — it reports both the DOM structure and the computed layout box.",
      },
    ],
  },
  {
    id: "source-control",
    title: "Source Control & Code Reviews",
    category: "git",
    categoryLabel: "Source Control",
    icon: GitPullRequestIcon,
    summary:
      "Review diffs, stage files, manage branches and worktrees, and conduct pull request reviews across GitHub and GitLab.",
    details:
      "Provider-backed review threads provide side-by-side or unified diff viewing with inline line-by-line commenting, resolution states, reactions, CI status check inspection, and verdict submissions. All Git operations execute directly within the active environment — local or remote.",
    highlights: [
      "Side-by-side and unified diff viewers with syntax highlighting and word wrapping.",
      "Interactive staging, unstaging, discard changes, and commit authoring.",
      "Pull request reviews with thread comments, approvals, and request changes.",
      "CI status check inspection inline with diff context.",
      "Worktree branch management and automatic cleanup after merge.",
    ],
    steps: [
      {
        step: 1,
        title: "Connect a Git provider",
        description:
          "Go to Settings → Connections and link your GitHub or GitLab account with OAuth.",
      },
      {
        step: 2,
        title: "Open Source Control panel",
        description:
          "Click the Git icon in the left sidebar or press ⌘⇧G to view staged changes, branches, and recent commits.",
      },
      {
        step: 3,
        title: "Stage and commit",
        description:
          "Click the + next to any file to stage it. Write a commit message and press ⌘Enter to commit.",
      },
      {
        step: 4,
        title: "Review a pull request",
        description:
          "Open the PR tab, select a pull request. Use the diff viewer to add inline comments, then submit your review verdict.",
      },
    ],
    codeBlocks: [
      {
        language: "bash",
        label: "Agent-powered commit workflow",
        code: `# Ask the agent to stage and commit related changes:
"Stage all changes related to the authentication refactor
and write a conventional commit message"

# Agent will:
# 1. Identify relevant files
# 2. Stage them with git add
# 3. Generate: feat(auth): migrate session management to Effect`,
      },
    ],
    tips: [
      {
        kind: "tip",
        text: "Worktree branches are automatically cleaned up when you delete a thread that created them. Enable this in Settings → Source Control.",
      },
      {
        kind: "info",
        text: "PR review comments added via Tabs sync bidirectionally with GitHub and GitLab — reviewers on the web see your comments immediately.",
      },
    ],
    action: {
      label: "Source Control Settings",
      section: "source-control",
    },
  },
  {
    id: "thread-lifecycle",
    title: "Thread Lifecycle & Management",
    category: "agents",
    categoryLabel: "Agents & Threads",
    icon: LayersIcon,
    summary:
      "Rename, auto-generate titles, pin important sessions, settle finished tasks, snooze reminders, or branch threads.",
    details:
      "Settling a thread archives completed conversations out of the primary list while keeping their history fully searchable. Snoozing temporarily hides threads until a specified time or notification. Deleting permanently purges a thread and can automatically prune associated git worktrees. Branching forks the exact conversation state into a new thread for parallel exploration.",
    highlights: [
      "Settle threads to keep your workspace decluttered without losing any history.",
      "Snooze threads with scheduled wakeup alarms and desktop reminders.",
      "Branch threads to fork conversation states into new parallel investigations.",
      "Auto-generated titles use a fast model pass over the conversation to produce concise names.",
      "Pin threads to always appear at the top of your workspace sidebar.",
    ],
    steps: [
      {
        step: 1,
        title: "Settle a completed thread",
        description:
          "Right-click a thread → Settle. It moves to the Settled archive but remains searchable via ⌘K.",
      },
      {
        step: 2,
        title: "Snooze a thread",
        description:
          "Right-click → Snooze. Pick a duration or specific time. The thread reappears with a notification badge when time is up.",
      },
      {
        step: 3,
        title: "Branch a thread",
        description:
          "Right-click any message → Branch from here. A new thread opens with the full conversation up to that point.",
      },
      {
        step: 4,
        title: "Auto-generate a title",
        description:
          "Right-click → Generate Title. Tabs runs a fast model summarization pass and renames the thread.",
      },
    ],
    tips: [
      {
        kind: "tip",
        text: "Branch threads before exploring risky changes. If the experiment fails, the original thread stays untouched at the branch point.",
      },
      {
        kind: "info",
        text: "Settled threads are excluded from the default sidebar view but appear in search results and can be unsettled at any time.",
      },
    ],
  },
  {
    id: "diagnostics-support",
    title: "Diagnostics, Footprint & Telemetry",
    category: "diagnostics",
    categoryLabel: "Diagnostics & System",
    icon: ActivityIcon,
    summary:
      "Monitor live system footprint, attributed CPU/memory counters, process trees, execution traces, and support bundle exports.",
    details:
      "Diagnostics inspect native OS counters for backend services, Electron desktop processes, coding agents, and terminal instances at sub-second resolution. The support bundle exporter automatically redacts home directory paths, environment tokens, and authentication secrets before packaging and download.",
    highlights: [
      "Sub-second CPU and RSS memory telemetry grouped by ownership category.",
      "Granular process tree with process signals (SIGINT / SIGKILL).",
      "Redacted diagnostics export for secure issue reporting and support.",
      "Resource timeline charts show historical CPU, memory, disk I/O, and network over configurable windows.",
      "Live process view shows all child processes with their PID, CPU%, and memory allocation.",
    ],
    steps: [
      {
        step: 1,
        title: "Open Diagnostics",
        description:
          "Go to Settings → Diagnostics, or press the Pop Out button to open a standalone diagnostics window.",
      },
      {
        step: 2,
        title: "Inspect live resource usage",
        description:
          "The Overview tab shows real-time CPU, memory, disk, and network metrics split by process category.",
      },
      {
        step: 3,
        title: "Trace slow operations",
        description:
          "Switch to the Traces tab to see structured execution spans. Look for long-running spans to identify bottlenecks.",
      },
      {
        step: 4,
        title: "Export a support bundle",
        description:
          "Click Export Support Bundle to download a redacted ZIP with logs, telemetry, and system info for support reporting.",
      },
    ],
    codeBlocks: [
      {
        language: "bash",
        label: "Support bundle contents",
        code: `# support-bundle-2026-09-06.zip contains:
├── telemetry.json          # CPU/memory snapshots
├── process-tree.json       # Full process hierarchy
├── traces.json             # Execution trace spans
├── server.log              # Backend logs (tokens redacted)
├── system-info.json        # OS, Node.js, Electron versions
└── settings.json           # Config (secrets stripped)`,
      },
    ],
    tips: [
      {
        kind: "tip",
        text: "Use the standalone Diagnostics popup (Pop Out button) while debugging — it stays visible even when you navigate away from Settings.",
      },
      {
        kind: "info",
        text: "All file paths are normalized to remove your home directory before export. API keys and tokens in logs are automatically redacted.",
      },
    ],
    action: {
      label: "Open Diagnostics",
      section: "diagnostics",
    },
  },
  {
    id: "keyboard-shortcuts",
    title: "Keyboard Shortcuts & Command Palette",
    category: "shortcuts",
    categoryLabel: "Shortcuts",
    icon: KeyboardIcon,
    summary:
      "Accelerate your workflow with global keybindings, command palette actions, and customizable shortcut mappings.",
    details:
      "The command palette provides instant fuzzy-search access to threads, workspaces, commands, and settings. Keybindings can be fully customized with conflict detection and bound to project-specific tasks like npm scripts or custom bash commands.",
    highlights: [
      "Global command palette with fuzzy search across commands, threads, and files.",
      "Conflict detection prevents overlapping key combinations from silently overriding each other.",
      "Bind custom project npm and bash scripts to dedicated hotkeys.",
      "Context-aware shortcuts change behavior based on focus (composer vs. diff viewer vs. terminal).",
      "All default shortcuts are rebindable — even system-level ones.",
    ],
    steps: [
      {
        step: 1,
        title: "Open the Command Palette",
        description:
          "Press ⌘K from anywhere in the app. Start typing to fuzzy-search commands, threads, or settings sections.",
      },
      {
        step: 2,
        title: "Customize a keybinding",
        description:
          "Go to Settings → Keybindings. Click the pencil icon next to any action to record a new key combination.",
      },
      {
        step: 3,
        title: "Bind a project script",
        description:
          "In project settings, find a npm script and click the keyboard icon to assign a custom hotkey.",
      },
    ],
    codeBlocks: [
      {
        language: "json",
        label: "keybindings.json — custom overrides",
        code: `[
  {
    "key": "cmd+shift+t",
    "command": "tabs.newWorktreeThread"
  },
  {
    "key": "cmd+shift+d",
    "command": "tabs.openDiagnostics"
  },
  {
    "key": "ctrl+shift+r",
    "command": "tabs.refreshTelemetry"
  }
]`,
      },
    ],
    shortcuts: [
      { label: "Command Palette", keys: ["⌘", "K"] },
      { label: "New Thread", keys: ["⌘", "T"] },
      { label: "New Worktree Thread", keys: ["⌘", "⇧", "T"] },
      { label: "Quick Open File", keys: ["⌘", "P"] },
      { label: "Toggle Sidebar", keys: ["⌘", "B"] },
      { label: "Open Settings", keys: ["⌘", ","] },
      { label: "Source Control", keys: ["⌘", "⇧", "G"] },
      { label: "Open Browser Panel", keys: ["⌘", "⇧", "B"] },
      { label: "Settle Thread", keys: ["⌘", "⇧", "S"] },
      { label: "Focus Composer", keys: ["⌘", "L"] },
    ],
    tips: [
      {
        kind: "tip",
        text: "Type a thread name in the Command Palette to jump to it instantly — faster than scrolling through the sidebar.",
      },
      {
        kind: "info",
        text: "keybindings.json lives at ~/.config/tabs/keybindings.json and hot-reloads whenever you save the file.",
      },
    ],
    action: {
      label: "Customize Keybindings",
      section: "keybindings",
    },
  },
];

// ── Small presentational helpers ──────────────────────────────────────────────

function CodeBlock({ block }: { readonly block: DocCodeBlock }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(block.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200/90 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/60 shadow-2xs">
      {/* Window Chrome Header */}
      <div className="flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-100/90 dark:bg-zinc-900/90 px-3.5 py-2 select-none">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* macOS window control dots */}
          <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-red-400/80 dark:bg-red-500/70" />
            <span className="size-2.5 rounded-full bg-amber-400/80 dark:bg-amber-500/70" />
            <span className="size-2.5 rounded-full bg-emerald-400/80 dark:bg-emerald-500/70" />
          </div>
          <div className="h-3 w-px bg-zinc-300/80 dark:bg-zinc-700/80 shrink-0" />
          <div className="flex items-center gap-1.5 min-w-0">
            <TerminalIcon className="size-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />
            <span className="font-mono text-[11px] font-medium text-zinc-700 dark:text-zinc-300 truncate">
              {block.label}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="rounded border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
            {block.language}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/80 transition-colors cursor-pointer border border-transparent hover:border-zinc-300/60 dark:hover:border-zinc-700/60"
            aria-label={`Copy ${block.label}`}
          >
            {copied ? (
              <>
                <CheckIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  Copied!
                </span>
              </>
            ) : (
              <>
                <CopyIcon className="size-3 text-zinc-500 dark:text-zinc-400" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
      {/* Code Area */}
      <pre className="overflow-x-auto p-4 bg-zinc-50/70 dark:bg-zinc-950/40">
        <code className="font-mono text-[11.5px] leading-relaxed text-zinc-900 dark:text-zinc-100 whitespace-pre select-text">
          {block.code}
        </code>
      </pre>
    </div>
  );
}

function TipBlock({ tip }: { readonly tip: DocTip }) {
  const config = {
    tip: {
      container: "border-border/60 bg-muted/30 dark:bg-muted/15",
      icon: <LightbulbIcon className="size-3.5 shrink-0 text-muted-foreground mt-0.5" />,
      prefix: "Tip:",
      prefixClass: "font-semibold text-foreground mr-1.5 text-xs",
    },
    warning: {
      container: "border-amber-500/25 bg-amber-500/[0.04] dark:bg-amber-500/[0.06]",
      icon: (
        <TriangleAlertIcon className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
      ),
      prefix: "Warning:",
      prefixClass: "font-semibold text-amber-800 dark:text-amber-300 mr-1.5 text-xs",
    },
    info: {
      container: "border-border/60 bg-muted/30 dark:bg-muted/15",
      icon: <InfoIcon className="size-3.5 shrink-0 text-muted-foreground mt-0.5" />,
      prefix: "Note:",
      prefixClass: "font-semibold text-foreground mr-1.5 text-xs",
    },
  }[tip.kind];

  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-xl border p-3 text-xs leading-relaxed transition-colors",
        config.container,
      )}
    >
      {config.icon}
      <p className="text-foreground/90">
        <span className={config.prefixClass}>{config.prefix}</span>
        {tip.text}
      </p>
    </div>
  );
}

function StepCodeSnippet({ code }: { readonly code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div className="group/code mt-2 flex items-center justify-between gap-3 rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/80 dark:bg-zinc-900/40 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="select-none font-mono text-xs text-zinc-400 dark:text-zinc-500 font-medium">
          $
        </span>
        <code className="font-mono text-[11px] leading-relaxed text-zinc-900 dark:text-zinc-100 whitespace-pre overflow-x-auto select-text">
          {code}
        </code>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/80 transition-colors cursor-pointer border border-transparent hover:border-zinc-300/60 dark:hover:border-zinc-700/60"
        aria-label="Copy command"
      >
        {copied ? (
          <>
            <CheckIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Copied</span>
          </>
        ) : (
          <>
            <CopyIcon className="size-3 text-zinc-500 dark:text-zinc-400" />
            <span>Copy</span>
          </>
        )}
      </button>
    </div>
  );
}

function StepList({ steps }: { readonly steps: ReadonlyArray<DocStep> }) {
  return (
    <div className="space-y-3">
      {steps.map((step) => (
        <div key={step.step} className="flex gap-3">
          <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/80 text-zinc-700 dark:text-zinc-300 mt-0.5 shadow-2xs">
            <span className="font-mono text-[9.5px] font-semibold">{step.step}</span>
          </div>
          <div className="space-y-1.5 min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">
              {step.title}
            </p>
            <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              {step.description}
            </p>
            {step.code ? <StepCodeSnippet code={step.code} /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function DocumentationSettings({
  onOpenSettingsSection,
}: {
  readonly onOpenSettingsSection?: (section: string) => void;
}) {
  const { fontPreferences } = useTheme();
  const activeFontCombo = useMemo(() => getActiveFontCombo(fontPreferences), [fontPreferences]);
  const [, updateSettingsViewState] = useSettingsViewState();

  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<DocCategory>("all");
  const [expandedTopics, setExpandedTopics] = useState<ReadonlySet<string>>(
    () => new Set(["composer-agents"]),
  );

  const toggleTopic = (id: string) => {
    setExpandedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleOpenSection = (section: string) => {
    if (onOpenSettingsSection) {
      onOpenSettingsSection(section);
    } else {
      updateSettingsViewState({ activeSection: section });
    }
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("section", section);
      window.history.pushState({}, "", url.toString());
    }
  };

  const visibleTopics = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return DOC_TOPICS.filter((topic) => {
      const matchesCategory = selectedCategory === "all" || topic.category === selectedCategory;
      if (!matchesCategory) return false;
      if (!needle) return true;
      const searchable =
        `${topic.title} ${topic.summary} ${topic.details} ${topic.categoryLabel} ${topic.highlights.join(" ")} ${(topic.steps ?? []).map((s) => `${s.title} ${s.description}`).join(" ")}`.toLowerCase();
      return searchable.includes(needle);
    });
  }, [query, selectedCategory]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <h2
              className={cn(
                "text-[28px] leading-relaxed pb-1 text-foreground mb-2 font-bold",
                activeFontCombo.sansClass,
              )}
              style={{ fontFamily: "var(--font-sans)", textTransform: "capitalize" }}
            >
              Documentation
            </h2>
            <span className="rounded-full border border-border/60 bg-muted/60 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Guides & Reference
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            In-depth guides, configuration references, step-by-step workflows, and keyboard
            shortcuts for every feature in Tabs.
          </p>
        </div>

        {/* Gradient Divider */}
        <div
          className="h-[5px] w-full my-5 rounded-full dark:block hidden"
          style={{ background: "linear-gradient(to right, rgba(255,255,255,0.25), transparent)" }}
        />
        <div
          className="h-[5px] w-full my-5 rounded-full dark:hidden block"
          style={{ background: "linear-gradient(to right, rgba(0,0,0,0.12), transparent)" }}
        />
      </div>

      {/* Knowledge Base Section */}
      <SettingsSection
        title="Knowledge Base & Topics"
        description="Step-by-step guides, configuration examples, code snippets, and shortcut references."
      >
        <div className="space-y-4 p-4 sm:p-5">
          {/* Search bar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground z-10" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search guides, shortcuts, configuration, workflows…"
                className="pl-9 pr-9"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors"
                  aria-label="Clear search"
                >
                  <XIcon className="size-3.5" />
                </button>
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground shrink-0">
              <span>
                Showing{" "}
                <span className="font-mono font-medium text-foreground">
                  {visibleTopics.length}
                </span>{" "}
                of {DOC_TOPICS.length} topics
              </span>
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {CATEGORIES.map((cat) => {
              const count =
                cat.id === "all"
                  ? DOC_TOPICS.length
                  : DOC_TOPICS.filter((t) => t.category === cat.id).length;
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs transition-all cursor-pointer select-none",
                    isSelected
                      ? "bg-foreground text-background font-semibold shadow-2xs"
                      : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/50",
                  )}
                >
                  {cat.label}{" "}
                  <span
                    className={cn(
                      "ml-1 font-mono text-[10.5px]",
                      isSelected ? "opacity-80" : "text-muted-foreground/70",
                    )}
                  >
                    ({count})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Topics */}
          <div className="space-y-3 pt-2" aria-live="polite">
            {visibleTopics.map((topic) => {
              const TopicIcon = topic.icon;
              const isExpanded = expandedTopics.has(topic.id);
              const hasSteps = (topic.steps?.length ?? 0) > 0;
              const hasCode = (topic.codeBlocks?.length ?? 0) > 0;
              const hasTips = (topic.tips?.length ?? 0) > 0;
              const hasShortcuts = (topic.shortcuts?.length ?? 0) > 0;

              return (
                <div
                  key={topic.id}
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border border-zinc-200/90 dark:border-border/60 bg-card transition-all duration-200 shadow-2xs",
                    "hover:border-zinc-300 dark:hover:border-border/80 hover:shadow-xs",
                    isExpanded && "border-zinc-300 dark:border-border/80 shadow-xs",
                  )}
                >
                  {/* Card Header */}
                  <div
                    className="flex cursor-pointer items-start justify-between gap-3 p-4 sm:p-5 select-none"
                    onClick={() => toggleTopic(topic.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleTopic(topic.id);
                      }
                    }}
                    aria-expanded={isExpanded}
                    aria-label={`Toggle ${topic.title} details`}
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      {/* Bare neutral theme-aware icon */}
                      <TopicIcon className="size-5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors mt-0.5" />

                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-[14.5px] font-semibold text-foreground tracking-tight">
                            {topic.title}
                          </h3>
                          <span className="rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {topic.categoryLabel}
                          </span>
                          {/* Feature indicator badges */}
                          {hasSteps && (
                            <span className="flex items-center gap-1 rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[9.5px] font-medium text-muted-foreground">
                              <ZapIcon className="size-2.5 text-muted-foreground" />
                              Guide
                            </span>
                          )}
                          {hasCode && (
                            <span className="flex items-center gap-1 rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[9.5px] font-medium text-muted-foreground">
                              <CodeIcon className="size-2.5 text-muted-foreground" />
                              Examples
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {topic.summary}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground shrink-0 p-1 rounded-md transition-colors mt-0.5"
                      aria-hidden="true"
                      tabIndex={-1}
                    >
                      {isExpanded ? (
                        <ChevronDownIcon className="size-4" />
                      ) : (
                        <ChevronRightIcon className="size-4" />
                      )}
                    </button>
                  </div>

                  {/* Expanded Content */}
                  {isExpanded ? (
                    <div className="border-t border-zinc-200/80 dark:border-border/40">
                      <div className="space-y-5 p-4 sm:p-5">
                        {/* Overview paragraph */}
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-zinc-500 dark:text-zinc-400">
                            <FileTextIcon className="size-3" />
                            Overview
                          </div>
                          <p className="text-[12.5px] leading-relaxed text-zinc-800 dark:text-zinc-200">
                            {topic.details}
                          </p>
                        </div>

                        {/* Key Capabilities */}
                        <div className="space-y-2.5">
                          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-zinc-500 dark:text-zinc-400">
                            <ListChecksIcon className="size-3" />
                            Key Capabilities
                          </div>
                          <ul className="grid gap-1.5">
                            {topic.highlights.map((highlight) => (
                              <li key={highlight} className="flex items-start gap-2">
                                <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                                <span className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                                  {highlight}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* Step-by-step guide */}
                        {hasSteps ? (
                          <div className="space-y-2.5">
                            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-zinc-500 dark:text-zinc-400">
                              <TerminalIcon className="size-3" />
                              Getting Started
                            </div>
                            <StepList steps={topic.steps!} />
                          </div>
                        ) : null}

                        {/* Code examples */}
                        {hasCode ? (
                          <div className="space-y-2.5">
                            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-zinc-500 dark:text-zinc-400">
                              <CodeIcon className="size-3" />
                              Code Examples
                            </div>
                            <div className="space-y-3">
                              {topic.codeBlocks!.map((block, i) => (
                                <CodeBlock key={i} block={block} />
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {/* Shortcuts reference */}
                        {hasShortcuts ? (
                          <div className="space-y-2.5">
                            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-zinc-500 dark:text-zinc-400">
                              <KeyboardIcon className="size-3" />
                              Keyboard Shortcuts
                            </div>
                            <div className="grid gap-1.5 sm:grid-cols-2">
                              {topic.shortcuts!.map((shortcut) => (
                                <div
                                  key={shortcut.label}
                                  className="flex items-center justify-between rounded-lg border border-zinc-200/80 dark:border-zinc-800/60 bg-zinc-50/60 dark:bg-zinc-900/30 px-3 py-2"
                                >
                                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                                    {shortcut.label}
                                  </span>
                                  <div className="flex items-center gap-0.5">
                                    {shortcut.keys.map((key) => (
                                      <kbd
                                        key={key}
                                        className="inline-flex items-center justify-center rounded border border-zinc-300/80 dark:border-zinc-700/80 bg-white dark:bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-800 dark:text-zinc-200 shadow-2xs"
                                      >
                                        {key}
                                      </kbd>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {/* Tips / warnings / info */}
                        {hasTips ? (
                          <div className="space-y-2">
                            {topic.tips!.map((tip, i) => (
                              <TipBlock key={i} tip={tip} />
                            ))}
                          </div>
                        ) : null}

                        {/* Action button */}
                        {topic.action ? (
                          <div className="flex items-center justify-end pt-1 border-t border-border/30">
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => handleOpenSection(topic.action!.section)}
                              className="text-xs h-7 px-3 font-medium flex items-center gap-1.5"
                            >
                              <span>{topic.action.label}</span>
                              <ArrowUpRightIcon className="size-3" />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {/* Empty search state */}
            {visibleTopics.length === 0 ? (
              <div className="py-14 text-center space-y-3 rounded-2xl border border-dashed border-border/60 bg-muted/10">
                <BookOpenIcon className="size-8 mx-auto text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">
                  No topics match &ldquo;{query}&rdquo;
                </p>
                <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                  Try a different keyword, or reset the category filter.
                </p>
                <div className="pt-2">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setQuery("");
                      setSelectedCategory("all");
                    }}
                  >
                    Reset filters
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

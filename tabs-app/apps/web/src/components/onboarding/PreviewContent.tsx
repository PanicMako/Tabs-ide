import {
  ArrowUpIcon,
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  GitBranchIcon,
  GlobeIcon,
  PlayIcon,
  PlusIcon,
} from "lucide-react";

export function PreviewContent({
  tool,
  light,
  project,
}: {
  readonly tool: string;
  readonly light: boolean;
  readonly project: string;
}) {
  const line = light ? "border-black/10" : "border-white/10";
  const muted = light ? "bg-black/[0.025]" : "bg-white/[0.025]";
  const selected = light ? "bg-black/5" : "bg-white/10";
  const code = [
    "import { useState } from 'react';",
    "",
    "export function App() {",
    "  const [theme, setTheme] = useState('light');",
    "",
    "  return <Settings theme={theme} />;",
    "}",
  ];
  if (tool === "Code")
    return (
      <div
        className="flex h-52 text-[10px]"
        aria-label="Example IDE with file explorer and code editor"
      >
        <aside className={`w-24 shrink-0 border-r p-3 ${line} ${muted}`}>
          <p className="mb-4 text-[9px] font-medium uppercase tracking-wider opacity-60">
            Explorer
          </p>
          <div className="mb-2 flex items-center gap-1">
            <ChevronRightIcon className="size-2.5 rotate-90" aria-hidden="true" />
            <FolderIcon className="size-3" aria-hidden="true" />
            src
          </div>
          {["App.tsx", "styles.css"].map((file) => (
            <p
              key={file}
              className={`mb-2 flex items-center gap-1 rounded-md px-1 py-1 ${file === "App.tsx" ? selected : ""}`}
            >
              <FileIcon className="size-2.5" aria-hidden="true" />
              {file}
            </p>
          ))}
          <p className="mt-3 opacity-60">package.json</p>
        </aside>
        <div className="min-w-0 flex-1">
          <div className={`flex items-center gap-2 border-b px-3 py-2.5 ${line}`}>
            <FileIcon className="size-3" aria-hidden="true" />
            App.tsx
          </div>
          <div className="overflow-hidden py-3 font-mono text-[9px] leading-5">
            {code.map((text, i) => (
              <div key={i} className="flex whitespace-pre">
                <span className="w-7 shrink-0 text-center opacity-35">{i + 1}</span>
                <span
                  className={
                    i === 0 || i === 2 ? (light ? "text-[#66539d]" : "text-[#bdb0de]") : ""
                  }
                >
                  {text || " "}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  if (tool === "Agents")
    return (
      <div
        className="flex h-52 text-[10px]"
        aria-label="Example agent workspace with threads and a conversation"
      >
        <aside className={`w-24 shrink-0 border-r p-3 ${line} ${muted}`}>
          <div className="mb-4 flex items-center justify-between text-[9px] font-medium opacity-70">
            <span>Threads</span>
            <PlusIcon aria-hidden="true" className="size-3" />
          </div>
          <div className={`rounded-lg p-2 font-medium ${selected}`}>Settings page</div>
          <p className="mt-3 px-2 opacity-55">Fix navigation</p>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col p-3">
          <div className={`ml-auto max-w-[85%] rounded-xl px-3 py-2 ${selected}`}>
            Add a settings page.
          </div>
          <div className="mt-3 flex items-start gap-2">
            <BotIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <div>
              <p className="mb-1 font-semibold">Codex</p>
              <p className="leading-4 opacity-75">
                Added the page and wired up appearance preferences.
              </p>
              <p
                className={`mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] ${line}`}
              >
                <CheckIcon aria-hidden="true" className="size-2.5" />
                App.tsx · View changes
              </p>
            </div>
          </div>
          <div
            className={`mt-auto flex items-center justify-between rounded-xl border px-3 py-2 ${line} ${muted}`}
          >
            <span className="opacity-50">Ask a follow-up...</span>
            <ArrowUpIcon aria-hidden="true" className="size-3" />
          </div>
        </div>
      </div>
    );
  if (tool === "Launchpad")
    return (
      <div className="h-52 p-4 text-[10px]" aria-label="Example Launchpad with project commands">
        <p className="mb-4 text-xs font-semibold">Launchpad</p>
        {[
          { name: "Dev server", command: "bun run dev" },
          { name: "Tests", command: "bun run test" },
        ].map((item) => (
          <div
            key={item.name}
            className={`mb-2 flex items-center justify-between rounded-xl border p-3 ${line} ${muted}`}
          >
            <div>
              <p className="font-medium">{item.name}</p>
              <p className="mt-1 font-mono opacity-60">{item.command}</p>
            </div>
            <PlayIcon aria-hidden="true" className="size-3.5" />
          </div>
        ))}
      </div>
    );
  if (tool === "Git")
    return (
      <div
        className="h-52 p-4 text-[10px]"
        aria-label="Example Source Control with changed files and a diff"
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold">Changes</span>
          <span className="flex items-center gap-1 opacity-60">
            <GitBranchIcon aria-hidden="true" className="size-3" />
            main
          </span>
        </div>
        <div className={`flex items-center gap-2 rounded-lg px-2 py-2 ${selected}`}>
          <FileIcon aria-hidden="true" className="size-3" />
          App.tsx<span className="ml-auto opacity-60">M</span>
        </div>
        <div
          className={`mt-3 overflow-hidden rounded-xl border font-mono text-[9px] leading-6 ${line}`}
        >
          <p className={`px-3 ${light ? "bg-red-50 text-red-800" : "bg-red-950/25 text-red-200"}`}>
            − return &lt;Home /&gt;;
          </p>
          <p
            className={`px-3 ${light ? "bg-green-50 text-green-800" : "bg-green-950/25 text-green-200"}`}
          >
            + return &lt;Settings /&gt;;
          </p>
        </div>
        <p className="mt-3 opacity-50">Review changes before you commit.</p>
      </div>
    );
  return (
    <div className="h-52 text-[10px]" aria-label="Example integrated browser">
      <div className={`flex items-center gap-2 border-b px-3 py-2 ${line} ${muted}`}>
        <GlobeIcon aria-hidden="true" className="size-3" />
        <span className={`flex-1 rounded-full border px-3 py-1 ${line}`}>localhost:3000</span>
      </div>
      <div className="p-5">
        <div className={`flex items-center justify-between border-b pb-3 ${line}`}>
          <span className="text-xs font-semibold">{project}</span>
          <span className="opacity-50">Home · Settings</span>
        </div>
        <p className="mt-5 text-lg font-semibold tracking-tight">A space for your ideas.</p>
        <div className="mt-4 flex gap-2">
          <span className={`h-8 flex-1 rounded-lg ${selected}`} />
          <span className={`h-8 flex-1 rounded-lg ${selected}`} />
          <span className={`h-8 flex-1 rounded-lg ${selected}`} />
        </div>
      </div>
    </div>
  );
}

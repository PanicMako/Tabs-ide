import { useId, useState } from "react";
import { PreviewContent } from "./PreviewContent";
import {
  BotIcon,
  GithubIcon,
  GlobeIcon,
  PlusIcon,
  RocketIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";

const PROJECTS = ["Project 1", "Project 2", "Project 3"] as const;
const TOOLS = [
  { name: "Code", icon: WorkflowIcon },
  { name: "Agents", icon: BotIcon },
  { name: "Launchpad", icon: RocketIcon },
  { name: "Git", icon: GithubIcon },
  { name: "Browser", icon: GlobeIcon },
] as const;

export function WorkbenchPreview({ mode = "light" }: { readonly mode?: "light" | "dark" }) {
  const [project, setProject] = useState<(typeof PROJECTS)[number]>("Project 1");
  const [toolsByProject, setToolsByProject] = useState<Record<string, number>>({
    "Project 1": 0,
    "Project 2": 1,
    "Project 3": 4,
  });
  const toolIndex = toolsByProject[project] ?? 0;
  const panelId = useId();
  const tool = TOOLS[toolIndex]!;
  const light = mode === "light";
  return (
    <div
      className={`overflow-hidden rounded-[28px] border shadow-xl shadow-black/10 ${light ? "border-black/10 bg-[#faf9f7] text-neutral-700" : "border-white/15 bg-[#202020] text-neutral-200"}`}
    >
      <div
        role="group"
        aria-label="Explore example projects"
        className={`flex items-end gap-1 border-b px-3 pt-3 ${light ? "border-black/10 bg-[#f0eeeb]/80" : "border-white/10 bg-white/5"}`}
      >
        {PROJECTS.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={project === name}
            aria-controls={panelId}
            onClick={() => setProject(name)}
            className={`flex min-w-0 flex-1 items-center justify-between gap-3 rounded-t-[18px] border px-3 py-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-[-3px] ${project === name ? (light ? "-mb-px border-black/10 border-b-white bg-white text-neutral-800 shadow-sm" : "-mb-px border-white/15 border-b-[#292929] bg-[#292929] text-white") : "border-transparent opacity-65 hover:opacity-100"}`}
          >
            <span>{name}</span>
            <XIcon aria-hidden="true" className="size-3 opacity-55" />
          </button>
        ))}
        <PlusIcon aria-hidden="true" className="mb-3 ml-1 mr-1 size-4 shrink-0 opacity-60" />
      </div>
      <div
        className={`border-b px-2.5 py-3 ${light ? "border-black/10 bg-white/80" : "border-white/10 bg-black/10"}`}
      >
        <div
          role="group"
          aria-label="Explore project tools"
          className={`flex items-center gap-0.5 overflow-x-auto rounded-full border p-1 [scrollbar-width:none] ${light ? "border-black/10 bg-[#f4f3ef] shadow-[inset_0_1px_3px_#00000012]" : "border-white/15 bg-white/5"}`}
          style={{
            backgroundImage: `radial-gradient(circle, ${light ? "#00000020" : "#ffffff25"} 0.8px, transparent 1px)`,
            backgroundSize: "6px 6px",
          }}
        >
          {TOOLS.map((item, index) => {
            const ToolIcon = item.icon;
            return (
              <button
                key={item.name}
                type="button"
                aria-pressed={toolIndex === index}
                aria-controls={panelId}
                onClick={() => setToolsByProject((current) => ({ ...current, [project]: index }))}
                className={`inline-flex shrink-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 py-2 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${toolIndex === index ? (light ? "bg-white text-neutral-800 shadow-sm" : "bg-white/20 text-white shadow-sm") : "opacity-75 hover:opacity-100"}`}
              >
                <ToolIcon aria-hidden="true" className="size-3.5 stroke-[1.7]" />
                {item.name}
              </button>
            );
          })}
        </div>
      </div>
      <div
        id={panelId}
        className={light ? "bg-white/80" : "bg-black/10"}
        aria-live="polite"
        aria-atomic="true"
      >
        <PreviewContent tool={tool.name} light={light} project={project} />
      </div>
      <div
        className={`flex justify-between border-t px-5 py-3 text-[10px] ${light ? "border-black/8 text-neutral-500" : "border-white/10 text-neutral-400"}`}
      >
        <span>Interactive preview</span>
        <span>{light ? "Light" : "Dark"} · Frost</span>
      </div>
    </div>
  );
}

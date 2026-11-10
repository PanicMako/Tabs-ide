/** Sample projects for the "Pick a tab" section: what each tab is holding right now. */
export type ProjectId = "studio" | "product" | "weekend";

export interface Project {
  name: string;
  hue: string;
  branch: string;
  agent: { id: string; name: string; thread: string; status: string };
  dock: { name: string; detail: string }[];
  git: { add: number; del: number; files: number };
  url: string;
}

export const PROJECTS: Record<ProjectId, Project> = {
  studio: {
    name: "studio-site", hue: "#0E2AF3", branch: "design/hero",
    agent: { id: "claude", name: "Claude", thread: "Tighten the hero spacing on mobile", status: "Editing Hero.tsx" },
    dock: [{ name: "Dev server", detail: "bun dev" }, { name: "Preview", detail: "localhost:4321" }],
    git: { add: 12, del: 4, files: 2 },
    url: "localhost:4321",
  },
  product: {
    name: "next-product", hue: "#FF5B2E", branch: "feat/usage-limits",
    agent: { id: "codex", name: "Codex", thread: "Why does the usage test fail on CI?", status: "Tests passing" },
    dock: [{ name: "API", detail: "pnpm dev:api" }, { name: "Tests", detail: "pnpm test --watch" }],
    git: { add: 3, del: 1, files: 1 },
    url: "localhost:3000/billing",
  },
  weekend: {
    name: "weekend-idea", hue: "#18B47B", branch: "main",
    agent: { id: "opencode", name: "OpenCode", thread: "Scaffold a CLI that renames photos", status: "Waiting for you" },
    dock: [{ name: "Run", detail: "cargo run -- ~/Photos" }],
    git: { add: 48, del: 0, files: 5 },
    url: "github.com/you/photo-renamer",
  },
};

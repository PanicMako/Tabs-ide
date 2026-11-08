export const PROJECT_TOUR_TOOLS = [
  {
    kind: "code",
    title: "Get familiar with Code",
    description:
      "This is the built-in Code OSS workbench. Open a file, browse the Explorer, or try the Command Palette. Take as long as you like.",
  },
  {
    kind: "server",
    title: "Run your project in Dock",
    description:
      "Open a terminal for a one-off command, or save a Dock preset for something you run often, like npm run dev.",
  },
  {
    kind: "git",
    title: "Review changes with Git",
    description:
      "Review changes, branches, and commits here. Initialize Git for a new folder, or connect GitHub to work with pull requests.",
  },
  {
    kind: "browser",
    title: "Test in the Browser",
    description: "Open a local dev URL or a website to test your work inside the project window.",
  },
] as const;

export interface WorkspaceTourTool {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowRightIcon, ChevronDownIcon, ChevronLeftIcon, MinusIcon } from "lucide-react";
import { Button } from "./ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { CommandPaletteOpenContext } from "../commandPaletteContext";
import { WorkspaceTourMascot } from "./WorkspaceTourMascot";
import { PROJECT_TOUR_TOOLS, type WorkspaceTourTool } from "./workspaceTourTools";
import {
  GUIDED_TOUR_STEPS,
  type TourProjectTool,
  useGuidedTourStore,
} from "../stores/guidedTourStore";
import "./workspace-tour.css";

type SettingsStop = "themes" | "workspace" | "quick-actions" | "providers";

const SETUP_GUIDANCE: Readonly<Record<string, { title: string; description: string }>> = {
  "browser-add": {
    title: "Add a Browser tab",
    description: "Choose Add Tab to save a site in this project’s toolbar.",
  },
  "browser-name": {
    title: "Name the tab",
    description: "Choose a label you’ll recognize, such as Figma or Local preview.",
  },
  "browser-url": {
    title: "Enter the site URL",
    description: "Paste the full address of the site you want to open from Tabs.",
  },
  "browser-save": {
    title: "Save your Browser tab",
    description: "Choose Save Changes to add the tab to your toolbar.",
  },
  "browser-done": {
    title: "Browser tab added",
    description: "Your saved site is ready to open from the project toolbar.",
  },
  "terminal-add": {
    title: "Add a Terminal tab",
    description: "Choose Add Terminal to give a recurring command its own place in your toolbar.",
  },
  "terminal-name": {
    title: "Name the terminal",
    description: "Pick a label that describes the job, such as Tests or Dev server.",
  },
  "terminal-command": {
    title: "Enter a command",
    description: "Use a command you already run in this project, such as npm test.",
  },
  "terminal-save": {
    title: "Save your Terminal tab",
    description: "Choose Save Changes. The command runs when you open the new tab.",
  },
  "terminal-done": {
    title: "Terminal tab added",
    description: "The new tab is available in the project toolbar.",
  },
  "preset-add": {
    title: "Add a Dock preset",
    description: "Choose Add Preset to save commands you run together.",
  },
  "preset-name": {
    title: "Name the preset",
    description: "Use a name that describes the task, such as Frontend or Dev server.",
  },
  "preset-command": {
    title: "Enter the first command",
    description:
      "Add a command such as npm run dev. You can add more commands in the order they should run.",
  },
  "preset-save": {
    title: "Save your Dock preset",
    description: "Choose Save Changes. You’ll be able to run the preset from Dock.",
  },
  "preset-done": {
    title: "Dock preset saved",
    description: "Open Dock whenever you want to run the preset.",
  },
};

interface TourStop {
  title: string;
  description: string;
  selector: string;
  action?: string | undefined;
  open?: (() => void) | undefined;
  options?: ReadonlyArray<{ label: string; open: () => void }>;
  hint?: string;
}

export function WorkspaceTour({
  tools,
  activeToolId,
  hasProject,
  settingsSection,
  settingsTool,
  onSelectTool,
  onOpenSettings,
  onReturnToProject,
  canLeaveSettings,
}: {
  readonly tools: ReadonlyArray<WorkspaceTourTool>;
  readonly activeToolId?: string | undefined;
  readonly hasProject: boolean;
  readonly settingsSection: string | null;
  readonly settingsTool: TourProjectTool | null;
  readonly onSelectTool: (id: string) => void;
  readonly onOpenSettings: (section: SettingsStop, tool?: TourProjectTool) => void;
  readonly onReturnToProject: () => void;
  readonly canLeaveSettings: () => boolean;
}) {
  const {
    currentStepIndex,
    toolCursor,
    setToolCursor,
    isStarted,
    isDismissed,
    isCollapsed,
    isExploring,
    setExploring,
    nextStep,
    prevStep,
    dismissTour,
    setCollapsed,
    toggleCollapsed,
  } = useGuidedTourStore();
  const commandPaletteOpen = useContext(CommandPaletteOpenContext);
  const guideRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const resume = useCallback(() => {
    setCollapsed(false);
    requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
  }, [setCollapsed]);
  const [anchor, setAnchor] = useState<{
    selector: string;
    setupStep: string | undefined;
    left: number;
    top: number;
    target: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const phase = GUIDED_TOUR_STEPS[currentStepIndex]?.id;
  const lessons = PROJECT_TOUR_TOOLS.flatMap((lesson) => {
    const tool = tools.find((entry) => entry.kind === lesson.kind);
    return tool ? [{ ...lesson, tool }] : [];
  });
  const toolIndex = Math.min(toolCursor, Math.max(0, lessons.length - 1));
  const lesson = lessons[toolIndex];
  const agents = tools.find((entry) => entry.kind === "agents");
  const waitingForProject = phase === "add_project" || (!hasProject && phase !== "project_tabs");
  const isSettings = settingsSection !== null;
  const ready =
    isStarted &&
    !isDismissed &&
    !commandPaletteOpen &&
    Boolean(phase) &&
    !(waitingForProject && isSettings);
  const explore = () => setExploring(true);
  const openSettings = (section: SettingsStop, tool?: TourProjectTool) => {
    if (!canLeaveSettings()) return;
    explore();
    if (tool) setCollapsed(false);
    onOpenSettings(section, tool);
  };
  const tabSelector = (id: string) => `button[data-workspace-tool-id=${JSON.stringify(id)}]`;
  const settingsSelector = (section: SettingsStop) =>
    isSettings
      ? `button[data-settings-nav-item="${section}"]`
      : '[data-slot="workspace-settings-trigger"]';
  const openTool = (id: string) => {
    if (!canLeaveSettings()) return;
    explore();
    onSelectTool(id);
  };

  let stop: TourStop;
  if (waitingForProject) {
    stop = {
      title: "Start with a project",
      description:
        "Open or create a folder, open a file, or clone a Git repository. Your tour picks up when the project opens.",
      selector: "[data-tour-project-actions]",
    };
  } else if (phase === "project_tools" && lesson) {
    stop = {
      title: lesson.title,
      description: lesson.description,
      selector: tabSelector(lesson.tool.id),
      action:
        activeToolId === lesson.tool.id && !isSettings
          ? `Explore ${lesson.tool.label}`
          : `Open ${lesson.tool.label}`,
      open: () => openTool(lesson.tool.id),
      hint:
        lesson.kind === "server" && settingsTool === "preset"
          ? "Choose Add Preset, name it, and save one or more commands. You can run the preset later from Dock."
          : "Select Next when you’re ready.",
    };
    if (lesson.kind === "server") {
      stop.options = [
        { label: "Set up a Dock preset", open: () => openSettings("workspace", "preset") },
      ];
    }
  } else if (phase === "themes") {
    stop = {
      title: "Make Tabs feel like yours",
      description: "Try a different theme, font, or accent. You can come back to Themes anytime.",
      selector: settingsSelector("themes"),
      action: "Explore Themes",
      open: () => openSettings("themes"),
    };
  } else if (phase === "workspace_settings") {
    stop = {
      title: "Set up your project toolbar",
      description:
        "Change the project icon, choose whether icons show in the top row, and drag tools into your preferred order.",
      selector: settingsSelector("workspace"),
      action: "Open Workspace Settings",
      open: () => openSettings("workspace"),
      options: [
        { label: "Add a Browser tab", open: () => openSettings("workspace", "browser") },
        { label: "Add a Terminal tab", open: () => openSettings("workspace", "terminal") },
      ],
      hint:
        settingsTool === "browser"
          ? "Use Add Tab, enter a name and URL, then save. For example, keep your project’s Figma file beside your code."
          : settingsTool === "terminal"
            ? "Use Add Terminal, enter a name and a command like npm test, then save."
            : "Project Tools is where you add Browser tabs, Terminal tabs, and Dock presets.",
    };
  } else if (phase === "quick_actions") {
    stop = {
      title: "Put your shortcuts within reach",
      description:
        "Arrange the Quick Actions wheel around the tools you use most. You can also turn the launcher off here.",
      selector: settingsSelector("quick-actions"),
      action: "Configure Quick Actions",
      open: () => openSettings("quick-actions"),
      hint: "Pick a design, reorder actions, or turn off Enable Quick Actions. Your choices are kept if you turn it back on.",
    };
  } else if (phase === "providers") {
    stop = {
      title: "Connect a coding agent",
      description:
        "Choose any provider. OpenCode is an option if you want to try its available free models. You can also set this up later.",
      selector: settingsSelector("providers"),
      action: "Open Providers",
      open: () => openSettings("providers"),
      hint: "Enable your provider and refresh its status after setup. The npm installer needs Node.js and npm on the shell’s PATH.",
    };
  } else if (phase === "agents") {
    const inAgents = Boolean(agents) && activeToolId === agents?.id && !isSettings;
    stop = {
      title: "Start a first thread",
      description:
        "Create a thread, choose a connected model, and try sending “Hi” when you’re ready. You can explore the Agents desk without a provider.",
      selector: inAgents ? '[aria-label="New thread"]' : agents ? tabSelector(agents.id) : "",
      action: inAgents ? "Create a thread" : agents ? "Open Agents" : undefined,
      open: inAgents
        ? () => {
            const trigger = [
              ...document.querySelectorAll<HTMLButtonElement>('[aria-label="New thread"]'),
            ].find((button) => button.getClientRects().length > 0);
            trigger?.click();
            explore();
          }
        : agents
          ? () => onSelectTool(agents.id)
          : undefined,
      hint: "Active is work in progress. Settled keeps completed work handy. Archive clears it from your working list. Workspace Actions keeps project tools such as Dock and Git close to your conversation.",
    };
  } else if (phase === "project_tabs") {
    stop = {
      title: "One window, another project",
      description:
        "Use the plus in the top row to open a second project. Each project keeps its own files, chats, and tools as you switch.",
      selector: hasProject ? "[data-tour-new-tab]" : "[data-tour-project-actions]",
      action: hasProject ? "Open a new project tab" : undefined,
      open: hasProject
        ? () => document.querySelector<HTMLButtonElement>("[data-tour-new-tab]")?.click()
        : undefined,
      hint: "Keep a site like Figma in its own project tab, then switch projects without leaving Tabs. You’re ready to build.",
    };
  } else {
    stop = {
      title: "Make Tabs feel like yours",
      description: "Set up the look and tools for your project.",
      selector: settingsSelector("themes"),
      action: "Open Themes",
      open: () => openSettings("themes"),
    };
  }

  const setupTarget =
    settingsSection === "workspace" &&
    settingsTool &&
    (phase === "workspace_settings" || (lesson?.kind === "server" && settingsTool === "preset"))
      ? "#workspace-project-tools [data-tour-setup-step]"
      : "";
  const selector = isCollapsed ? "" : setupTarget || stop.selector;
  useEffect(() => {
    if (!ready || !selector) return;
    const guide = guideRef.current;
    if (!guide) return;

    let currentTarget: HTMLElement | null | undefined = null;
    let cleanupTarget: (() => void) | undefined;
    const bind = () => {
      const target = [...document.querySelectorAll<HTMLElement>(selector)].find(
        (element) =>
          element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden",
      );
      if (target === currentTarget) return;
      cleanupTarget?.();
      cleanupTarget = undefined;
      currentTarget = target;
      if (!target) {
        setAnchor(null);
        return;
      }
      if (!setupTarget) {
        targetObserver.disconnect();
        target.dataset.tourSpotlight = "overlay";
      }
      if (phase !== "add_project") target.scrollIntoView({ block: "nearest", inline: "nearest" });
      const measure = () => {
        const frame = guide.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        const inset = waitingForProject ? 3 : 1;
        const x = Math.max(0, rect.left - inset);
        const y = Math.max(0, rect.top - inset);
        const right = Math.min(frame.width, rect.right + inset);
        const bottom = Math.min(frame.height, rect.bottom + inset);
        if (right <= x || bottom <= y) {
          setAnchor(null);
          return;
        }
        const center = (x + right) / 2;
        const width = Math.min(376, frame.width - 24);
        const left = Math.max(12, Math.min(center - width / 2, frame.width - width - 12));
        const height = cardRef.current?.offsetHeight ?? 0;
        const above = bottom + 13 + height > frame.height - 12 && y - 13 - height >= 12;
        const preferredTop = above ? y - 13 - height : bottom + 13;
        const top = Math.max(12, Math.min(preferredTop, frame.height - height - 12));
        setAnchor({
          selector,
          setupStep: target.dataset.tourSetupStep,
          left,
          top,
          target: { x, y, width: right - x, height: bottom - y },
        });
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(guide);
      observer.observe(target);
      if (cardRef.current) observer.observe(cardRef.current);
      const open = () => {
        if (!waitingForProject && !setupTarget) setExploring(true);
      };
      target.addEventListener("click", open);
      document.addEventListener("scroll", measure, { passive: true, capture: true });
      cleanupTarget = () => {
        if (!setupTarget) delete target.dataset.tourSpotlight;
        observer.disconnect();
        target.removeEventListener("click", open);
        document.removeEventListener("scroll", measure, true);
      };
    };

    const targetObserver = new MutationObserver(bind);
    targetObserver.observe(document.body, {
      childList: true,
      subtree: true,
      ...(setupTarget ? { attributes: true, attributeFilter: ["data-tour-setup-step"] } : {}),
    });
    bind();
    return () => {
      targetObserver.disconnect();
      cleanupTarget?.();
    };
  }, [ready, selector, phase, waitingForProject, setupTarget, setExploring]);

  if (!ready) return null;

  const move = (direction: 1 | -1) => {
    if (!canLeaveSettings()) return;
    if (phase === "project_tools" && direction > 0 && toolIndex + 1 < lessons.length) {
      setToolCursor(toolIndex + 1);
      if (isSettings) onReturnToProject();
    } else if (phase === "project_tools" && direction < 0 && toolIndex > 0) {
      setToolCursor(toolIndex - 1);
      if (isSettings) onReturnToProject();
    } else {
      const nextPhase = GUIDED_TOUR_STEPS[currentStepIndex + direction]?.id;
      if (direction > 0) nextStep();
      else prevStep();
      if (nextPhase === "themes" || nextPhase === "providers") onOpenSettings(nextPhase);
      if (nextPhase === "workspace_settings") onOpenSettings("workspace");
      if (nextPhase === "quick_actions") onOpenSettings("quick-actions");
      if (nextPhase === "agents" && agents) onSelectTool(agents.id);
      if (isSettings && (nextPhase === "project_tools" || nextPhase === "project_tabs"))
        onReturnToProject();
    }
    headingRef.current?.focus({ preventScroll: true });
  };
  const step = waitingForProject
    ? 1
    : phase === "project_tools"
      ? Math.max(
          0,
          PROJECT_TOUR_TOOLS.findIndex((entry) => entry.kind === lesson?.kind),
        ) + 2
      : currentStepIndex + PROJECT_TOUR_TOOLS.length;
  const total = GUIDED_TOUR_STEPS.length - 1 + PROJECT_TOUR_TOOLS.length;
  const currentAnchor = anchor?.selector === selector ? anchor : null;
  const setupGuidance = currentAnchor?.setupStep
    ? SETUP_GUIDANCE[currentAnchor.setupStep]
    : undefined;
  const spotlight = currentAnchor?.target;
  let scrimStyle: CSSProperties | undefined;
  if (spotlight) {
    const radius = Math.min(spotlight.height / 2, waitingForProject ? 18 : 12);
    const { x, y, width, height } = spotlight;
    const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
      <filter id="soft"><feGaussianBlur stdDeviation="1.4"/></filter>
      <rect width="100%" height="100%" fill="white"/>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="black" filter="url(#soft)"/>
    </svg>`;
    scrimStyle = { maskImage: `url("data:image/svg+xml,${encodeURIComponent(mask)}")` };
  }
  const overlay = (
    <aside
      ref={guideRef}
      aria-label="Workspace tour"
      data-slot="workspace-tour"
      className="workspace-tour"
    >
      {!isCollapsed && (
        <div
          data-slot="workspace-tour-overlay"
          className="workspace-tour-overlay"
          aria-hidden="true"
        >
          <div className="workspace-tour-scrim" style={scrimStyle} />
        </div>
      )}
      {isCollapsed ? (
        <WorkspaceTourMascot onResume={resume} />
      ) : (
        <div
          ref={cardRef}
          className="workspace-tour-coach"
          style={currentAnchor ? { left: currentAnchor.left, top: currentAnchor.top } : undefined}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.stopPropagation();
              toggleCollapsed();
            }
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground tabular-nums">
              Workspace tour <span aria-hidden="true">·</span> {step} of {total}
            </span>
            <Button size="xs" variant="ghost" onClick={toggleCollapsed}>
              Minimize and explore <MinusIcon aria-hidden="true" />
            </Button>
          </div>
          <div aria-live="polite" aria-atomic="true">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="mt-2 text-base font-semibold tracking-tight outline-none"
            >
              {setupGuidance?.title ?? stop.title}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {setupGuidance?.description ??
                (isExploring && stop.hint ? stop.hint : stop.description)}
            </p>
          </div>
          {!waitingForProject && !setupTarget && isExploring && stop.options?.length ? (
            <div className="mt-2">
              <Menu>
                <MenuTrigger render={<Button size="xs" variant="outline" />}>
                  Optional setup <ChevronDownIcon aria-hidden="true" />
                </MenuTrigger>
                <MenuPopup align="start">
                  {stop.options.map((option) => (
                    <MenuItem key={option.label} onClick={option.open}>
                      {option.label}
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
            </div>
          ) : (
            !waitingForProject &&
            !setupTarget &&
            !isExploring &&
            stop.action && (
              <div className="mt-2">
                <Button
                  size="xs"
                  variant="link"
                  className="workspace-tour-context-action"
                  onClick={stop.open}
                >
                  {stop.action}
                </Button>
              </div>
            )
          )}
          <div className="workspace-tour-footer">
            <Button
              size="xs"
              variant="ghost"
              className="text-muted-foreground"
              onClick={dismissTour}
            >
              Skip tour
            </Button>
            {!waitingForProject && (
              <div className="ml-auto flex items-center gap-1">
                {step > 2 && (
                  <Button size="xs" variant="outline" onClick={() => move(-1)}>
                    <ChevronLeftIcon aria-hidden="true" /> Back
                  </Button>
                )}
                <Button size="xs" variant="default" className="min-w-16" onClick={() => move(1)}>
                  {phase === "project_tabs" ? "Finish tour" : "Next"}
                  <ArrowRightIcon aria-hidden="true" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
  return typeof document === "undefined" ? overlay : createPortal(overlay, document.body);
}

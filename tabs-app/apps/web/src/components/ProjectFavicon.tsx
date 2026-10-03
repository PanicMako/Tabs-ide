import type { ProjectIconColor, ProjectIconOverride } from "@tabs/contracts";
import {
  BotIcon,
  BookOpenIcon,
  BracesIcon,
  CircuitBoardIcon,
  CloudCogIcon,
  Code2Icon,
  DatabaseIcon,
  FlaskConicalIcon,
  FolderCodeIcon,
  FolderIcon,
  Gamepad2Icon,
  Globe2Icon,
  ImageIcon,
  Layers3Icon,
  MonitorIcon,
  MusicIcon,
  PackageIcon,
  ServerIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  SmartphoneIcon,
  TerminalIcon,
  VideoIcon,
} from "lucide-react";
import type { IconName } from "lucide-react/dynamic";
import type { ComponentType } from "react";
import { lazy, Suspense, useState } from "react";
import { selectProjectIcon, type ProjectIconName } from "../projectIconModel";
import { projectIconColorClassName } from "../projectIconColors";
import { cn } from "~/lib/utils";

const DynamicIcon = lazy(() =>
  import("lucide-react/dynamic").then((module) => ({ default: module.DynamicIcon })),
);

function DynamicProjectIconFallback() {
  return <FolderCodeIcon className="size-full text-[inherit]" />;
}

const PROJECT_ICONS: Record<ProjectIconName, ComponentType<{ className?: string }>> = {
  ai: BotIcon,
  book: BookOpenIcon,
  braces: BracesIcon,
  circuit: CircuitBoardIcon,
  cloud: CloudCogIcon,
  code: Code2Icon,
  database: DatabaseIcon,
  desktop: MonitorIcon,
  "folder-code": FolderCodeIcon,
  game: Gamepad2Icon,
  image: ImageIcon,
  layers: Layers3Icon,
  mobile: SmartphoneIcon,
  music: MusicIcon,
  package: PackageIcon,
  security: ShieldCheckIcon,
  server: ServerIcon,
  shopping: ShoppingBagIcon,
  terminal: TerminalIcon,
  test: FlaskConicalIcon,
  video: VideoIcon,
  web: Globe2Icon,
};

const PROJECT_ICON_COLOR_BY_NAME: Record<ProjectIconName, ProjectIconColor> = {
  ai: "violet",
  book: "amber",
  braces: "purple",
  circuit: "teal",
  cloud: "sky",
  code: "blue",
  database: "cyan",
  desktop: "indigo",
  "folder-code": "orange",
  game: "emerald",
  image: "pink",
  layers: "fuchsia",
  mobile: "lime",
  music: "fuchsia",
  package: "orange",
  security: "teal",
  server: "blue",
  shopping: "rose",
  terminal: "green",
  test: "yellow",
  video: "red",
  web: "sky",
};

export function getServerHttpOrigin(): string {
  if (typeof window === "undefined") return "";
  const bridgeUrl = (
    window as unknown as { desktopBridge?: { getWsUrl?: () => string } }
  ).desktopBridge?.getWsUrl?.();
  const envUrl = (import.meta.env?.VITE_WS_URL as string | undefined) ?? "";
  const wsUrl =
    bridgeUrl && bridgeUrl.length > 0
      ? bridgeUrl
      : envUrl && envUrl.length > 0
        ? envUrl
        : `${window.location?.protocol === "https:" ? "wss" : "ws"}://${window.location?.hostname || "localhost"}:${window.location?.port || ""}`;
  const httpUrl = wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  try {
    return new URL(httpUrl).origin;
  } catch {
    return httpUrl;
  }
}

export type ProjectFaviconProject = {
  readonly workspaceRoot: string;
  readonly title?: string | undefined;
  readonly faviconPath?: string | null | undefined;
  readonly projectIcon?: ProjectIconOverride | null | undefined;
  readonly environmentId?: string | null | undefined;
};

export interface ProjectFaviconProps {
  readonly project?: ProjectFaviconProject;
  readonly cwd?: string;
  readonly className?: string;
  readonly fallbackIcon?: ComponentType<{ className?: string }>;
}

const loadedProjectFaviconSrcs = new Set<string>();

export function ProjectFavicon(props: ProjectFaviconProps) {
  const project: ProjectFaviconProject = props.project ?? {
    workspaceRoot: props.cwd ?? "",
    title: "",
    faviconPath: null,
    projectIcon: null,
  };

  if (project.projectIcon?.kind === "emoji") {
    return <ProjectFaviconFallback className={props.className} emoji={project.projectIcon.emoji} />;
  }

  if (project.projectIcon?.kind === "lucide") {
    const colorClassName = projectIconColorClassName(project.projectIcon.color);
    const iconClassName = cn(
      "inline-flex size-3.5 shrink-0 items-center justify-center",
      colorClassName,
      props.className,
    );
    return (
      <span aria-hidden="true" className={iconClassName}>
        <Suspense fallback={<DynamicProjectIconFallback />}>
          <DynamicIcon
            name={project.projectIcon.name as IconName}
            className={cn("size-full", colorClassName)}
            fallback={DynamicProjectIconFallback}
          />
        </Suspense>
      </span>
    );
  }

  const automaticIconName = props.fallbackIcon
    ? null
    : selectProjectIcon(project.title ?? "", project.workspaceRoot);
  const FallbackIcon =
    props.fallbackIcon ??
    (automaticIconName?.kind === "lucide" ? PROJECT_ICONS[automaticIconName.icon] : FolderIcon);
  const fallbackEmoji = automaticIconName?.kind === "emoji" ? automaticIconName.emoji : undefined;
  const fallbackColorClassName =
    automaticIconName?.kind === "lucide"
      ? projectIconColorClassName(PROJECT_ICON_COLOR_BY_NAME[automaticIconName.icon])
      : undefined;

  if (!project.workspaceRoot) {
    return (
      <ProjectFaviconFallback
        className={props.className}
        colorClassName={fallbackColorClassName}
        icon={FallbackIcon}
        emoji={fallbackEmoji}
      />
    );
  }

  const serverHttpOrigin = getServerHttpOrigin();
  const queryParams = new URLSearchParams({ cwd: project.workspaceRoot });
  if (project.faviconPath) {
    queryParams.set("path", project.faviconPath);
  }
  const src = `${serverHttpOrigin}/api/project-favicon?${queryParams.toString()}`;

  return (
    <ProjectFaviconImage
      key={src}
      src={src}
      className={props.className}
      fallbackIcon={FallbackIcon}
      fallbackEmoji={fallbackEmoji}
      fallbackColorClassName={fallbackColorClassName}
    />
  );
}

function ProjectFaviconFallback({
  className,
  colorClassName,
  icon: Icon,
  emoji,
}: {
  readonly className?: string | undefined;
  readonly colorClassName?: string | undefined;
  readonly icon?: ComponentType<{ className?: string }> | undefined;
  readonly emoji?: string | undefined;
}) {
  if (emoji) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-3.5 shrink-0 items-center justify-center leading-none [container-type:size]",
          className,
        )}
      >
        <span className="text-[length:80cqh] leading-none">{emoji}</span>
      </span>
    );
  }

  if (!Icon) return null;
  return (
    <Icon className={cn("size-3.5 shrink-0 text-muted-foreground/60", colorClassName, className)} />
  );
}

function ProjectFaviconImage({
  src,
  className,
  fallbackIcon: FallbackIcon,
  fallbackEmoji,
  fallbackColorClassName,
}: {
  readonly src: string;
  readonly className?: string | undefined;
  readonly fallbackIcon?: ComponentType<{ className?: string }> | undefined;
  readonly fallbackEmoji?: string | undefined;
  readonly fallbackColorClassName?: string | undefined;
}) {
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(() =>
    loadedProjectFaviconSrcs.has(src) ? src : null,
  );
  const [loadError, setLoadError] = useState(false);

  if (loadError || (!displayedSrc && loadedProjectFaviconSrcs.has(src) === false)) {
    // If we haven't loaded it yet or failed, we render fallback and an invisible preloader img
    return (
      <>
        <ProjectFaviconFallback
          className={className}
          colorClassName={fallbackColorClassName}
          icon={FallbackIcon}
          emoji={fallbackEmoji}
        />
        {!loadError ? (
          <img
            src={src}
            alt=""
            className="hidden"
            onLoad={() => {
              loadedProjectFaviconSrcs.add(src);
              setDisplayedSrc(src);
            }}
            onError={() => {
              setLoadError(true);
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <img
      src={displayedSrc ?? src}
      alt=""
      className={cn("size-3.5 shrink-0 rounded-sm object-contain", className)}
      onError={() => {
        setLoadError(true);
        setDisplayedSrc(null);
      }}
    />
  );
}

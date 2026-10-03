import {
  BlocksIcon,
  BugIcon,
  FilesIcon,
  GitBranchIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import { type ComponentType, Fragment, useState } from "react";
import {
  CODE_ACTIVITY_ITEMS,
  CODE_CHROME_COMMANDS,
  CODE_MENU_BAR,
  type CodeActivityItem,
  type CodeChromeState,
  type CustomActivityBarItem,
} from "@tabs/shared/codeChrome";

import { cn } from "../../lib/utils";
import { getVisibleCustomActivityBarItems } from "./CodeActivityRail.logic";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const ICONS: Record<CodeActivityItem["icon"], ComponentType<{ className?: string }>> = {
  files: FilesIcon,
  search: SearchIcon,
  "git-branch": GitBranchIcon,
  bug: BugIcon,
  puzzle: BlocksIcon,
};

interface CodeActivityRailProps {
  chromeState: CodeChromeState;
  onApplicationMenuOpenChange?: (open: boolean) => void | Promise<void>;
  onRunCommand: (commandId: string) => void;
}

function RailButton(props: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            aria-pressed={props.active}
            onClick={props.onClick}
            className={cn(
              "group relative flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              props.active && "text-foreground",
            )}
          >
            {props.active ? (
              <span
                aria-hidden="true"
                className="absolute -left-1.5 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
              />
            ) : null}
            {props.children}
          </button>
        }
      />
      <TooltipPopup side="right">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function CustomActivityIcon({ item }: { item: CustomActivityBarItem }) {
  if (item.icon.type === "themeIcon" && item.icon.value) {
    return <span aria-hidden="true" className={`codicon codicon-${item.icon.value} text-[18px]`} />;
  }
  if (item.icon.type === "uri" && item.icon.value) {
    return (
      <span
        aria-hidden="true"
        className="size-[18px] bg-current"
        style={{
          WebkitMaskImage: `url(${JSON.stringify(item.icon.value)})`,
          WebkitMaskPosition: "center",
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskSize: "contain",
          maskImage: `url(${JSON.stringify(item.icon.value)})`,
          maskPosition: "center",
          maskRepeat: "no-repeat",
          maskSize: "contain",
        }}
      />
    );
  }
  if (item.icon.type === "themeUri" && (item.icon.light || item.icon.dark)) {
    return (
      <picture aria-hidden="true">
        {item.icon.dark ? (
          <source media="(prefers-color-scheme: dark)" srcSet={item.icon.dark} />
        ) : null}
        <img alt="" className="size-[18px]" src={item.icon.light ?? item.icon.dark} />
      </picture>
    );
  }
  return <BlocksIcon aria-hidden="true" className="size-[18px]" />;
}

function ApplicationMenu(props: CodeActivityRailProps) {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setOpen(false);
          void props.onApplicationMenuOpenChange?.(false);
          return;
        }
        if (opening) return;
        setOpening(true);
        void Promise.resolve(props.onApplicationMenuOpenChange?.(true)).finally(() => {
          setOpening(false);
          setOpen(true);
        });
      }}
    >
      <DropdownMenuTrigger
        aria-label="Code application menu"
        className="flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent data-popup-open:text-foreground"
      >
        <MenuIcon aria-hidden="true" className="size-[18px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label="Code application menu"
        align="start"
        className="w-56 rounded-xl"
        side="right"
        sideOffset={6}
      >
        {CODE_MENU_BAR.map((menu) => (
          <DropdownMenuSub key={menu.id}>
            <DropdownMenuSubTrigger>{menu.label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-72 rounded-xl">
              {menu.groups.map((group, groupIndex) => (
                <Fragment key={`${menu.id}-${group.items.map((item) => item.commandId).join("-")}`}>
                  {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
                  {group.items.map((item) =>
                    item.commandId === "workbench.action.toggleAutoSave" ? (
                      <DropdownMenuCheckboxItem
                        checked={props.chromeState.autoSaveEnabled}
                        key={item.commandId}
                        onClick={() => props.onRunCommand(item.commandId)}
                      >
                        {item.label}
                      </DropdownMenuCheckboxItem>
                    ) : (
                      <DropdownMenuItem
                        key={item.commandId}
                        onClick={() => props.onRunCommand(item.commandId)}
                      >
                        {item.label}
                        {item.shortcut ? (
                          <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>
                        ) : null}
                      </DropdownMenuItem>
                    ),
                  )}
                </Fragment>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Stable Tabs activity rail backed only by allowlisted workbench commands. */
export function CodeActivityRail(props: CodeActivityRailProps) {
  return (
    <nav
      aria-label="Code views"
      className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r border-border/70 bg-background py-2"
    >
      <ApplicationMenu {...props} />
      {CODE_ACTIVITY_ITEMS.map((item) => {
        const Icon = ICONS[item.icon];
        const active = props.chromeState.activeViewId === item.id;
        return (
          <Fragment key={item.id}>
            {item.id === "debug" ? (
              <span aria-hidden="true" className="my-1 h-px w-5 bg-border/70" />
            ) : null}
            <RailButton
              label={item.label}
              active={active}
              onClick={() => props.onRunCommand(item.commandId)}
            >
              <span aria-hidden="true">
                <Icon className="size-[18px]" />
              </span>
            </RailButton>
          </Fragment>
        );
      })}
      {getVisibleCustomActivityBarItems(props.chromeState.activityBarItems).map((item) => (
        <RailButton
          active={props.chromeState.activeViewId === item.id}
          key={item.id}
          label={item.label}
          onClick={() => props.onRunCommand(item.commandId)}
        >
          <CustomActivityIcon item={item} />
        </RailButton>
      ))}
      <div className="mt-auto">
        <RailButton
          label="Open settings"
          onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.settings)}
        >
          <SettingsIcon aria-hidden="true" className="size-[18px]" />
        </RailButton>
      </div>
    </nav>
  );
}

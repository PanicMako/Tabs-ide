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
            className={cn("code-rail-action", props.active && "is-active")}
          >
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
        className="size-5 bg-current"
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
        <img alt="" className="size-5" src={item.icon.light ?? item.icon.dark} />
      </picture>
    );
  }
  return <BlocksIcon aria-hidden="true" className="size-5" />;
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
      <DropdownMenuTrigger aria-label="Code application menu" className="code-rail-action">
        <MenuIcon aria-hidden="true" className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label="Code application menu"
        align="start"
        className="code-actions-menu w-56"
        side="right"
        sideOffset={6}
      >
        {CODE_MENU_BAR.map((menu) => (
          <DropdownMenuSub key={menu.id}>
            <DropdownMenuSubTrigger>{menu.label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="code-actions-menu w-72">
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
      inert={props.chromeState.modalOpen}
      className="code-activity-rail"
      data-sidebar-open={props.chromeState.activeViewId !== null}
    >
      <ApplicationMenu {...props} />
      {CODE_ACTIVITY_ITEMS.map((item) => {
        const Icon = ICONS[item.icon];
        const active = props.chromeState.activeViewId === item.id;
        return (
          <Fragment key={item.id}>
            <RailButton
              label={item.label}
              active={active}
              onClick={() => props.onRunCommand(item.commandId)}
            >
              <span aria-hidden="true">
                <Icon className="size-5" />
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
      <div className="code-rail-settings">
        <RailButton
          label="Open settings"
          onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.settings)}
        >
          <SettingsIcon aria-hidden="true" className="size-5" />
        </RailButton>
      </div>
    </nav>
  );
}

import type { ReactNode } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  RefreshCwIcon,
  CameraIcon,
  WrenchIcon,
  SlidersHorizontalIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  PanelTopCloseIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../ui/menu";
import { Popover, PopoverTrigger, PopoverPopup, PopoverTitle } from "../ui/popover";

export interface BrowserToolbarAction {
  label: string;
  description?: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}

function ActionMenu({
  label,
  icon,
  actions,
  onOpenChange,
}: {
  label: string;
  icon: ReactNode;
  actions: BrowserToolbarAction[];
  onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  return (
    <Menu onOpenChange={onOpenChange}>
      <MenuTrigger
        render={
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" aria-label={label}>
            {icon}
            <span>{label}</span>
            <ChevronDownIcon className="size-3 text-muted-foreground" />
          </Button>
        }
      />
      <MenuPopup align="end" className="w-64">
        {actions.map((action) => (
          <MenuItem
            key={action.label}
            disabled={action.disabled}
            onClick={action.onClick}
            className="gap-2.5 py-2"
          >
            <span className={action.active ? "text-foreground" : "text-muted-foreground"}>
              {action.icon}
            </span>
            <span className="flex min-w-0 flex-col">
              <span>{action.label}</span>
              {action.description && (
                <span className="text-[11px] text-muted-foreground">{action.description}</span>
              )}
            </span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

/** The same navigation bar is used for the project browser and added website tabs. */
export function BrowserToolbar(props: {
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: (ignoreCache: boolean) => void;
  onExternal: () => void;
  onCollapse: () => void;
  address: ReactNode;
  captureActions: BrowserToolbarAction[];
  toolActions: BrowserToolbarAction[];
  viewControls: ReactNode;
  onViewOpenChange?: ((open: boolean) => void) | undefined;
  onCaptureOpenChange?: ((open: boolean) => void) | undefined;
  onToolsOpenChange?: ((open: boolean) => void) | undefined;
  status?: ReactNode;
}) {
  return (
    <div className="@container/browser-toolbar" data-testid="browser-toolbar">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 @min-[700px]/browser-toolbar:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
        <div
          className="col-start-1 row-start-1 flex items-center gap-0.5"
          role="group"
          aria-label="Page navigation"
        >
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={!props.canGoBack}
            onClick={props.onBack}
            aria-label="Back"
            title="Back"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={!props.canGoForward}
            onClick={props.onForward}
            aria-label="Forward"
            title="Forward"
          >
            <ArrowRightIcon className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={(event) => props.onReload(event.shiftKey)}
            aria-label="Reload page"
            title="Reload (Shift to bypass cache)"
          >
            <RefreshCwIcon className="size-4" />
          </Button>
        </div>
        <div className="col-start-2 row-start-1 min-w-0">{props.address}</div>
        <div
          className="col-span-3 row-start-2 flex flex-wrap items-center justify-end gap-1 border-t border-border/50 pt-1.5 @min-[700px]/browser-toolbar:col-span-1 @min-[700px]/browser-toolbar:col-start-3 @min-[700px]/browser-toolbar:row-start-1 @min-[700px]/browser-toolbar:border-0 @min-[700px]/browser-toolbar:pt-0"
          role="group"
          aria-label="Browser tools"
        >
          {props.status && (
            <div className="flex items-center gap-1.5" aria-live="polite">
              {props.status}
            </div>
          )}
          <ActionMenu
            label="Capture"
            icon={<CameraIcon className="size-3.5" />}
            actions={props.captureActions}
            onOpenChange={props.onCaptureOpenChange}
          />
          <ActionMenu
            label="Tools"
            icon={<WrenchIcon className="size-3.5" />}
            actions={props.toolActions}
            onOpenChange={props.onToolsOpenChange}
          />
          <Popover onOpenChange={props.onViewOpenChange}>
            <PopoverTrigger
              render={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5"
                  aria-label="View settings"
                >
                  <SlidersHorizontalIcon className="size-3.5" />
                  View
                  <ChevronDownIcon className="size-3 text-muted-foreground" />
                </Button>
              }
            />
            <PopoverPopup align="end" className="w-72" viewportClassName="space-y-3 p-3">
              <PopoverTitle className="text-sm">Browser view</PopoverTitle>
              {props.viewControls}
            </PopoverPopup>
          </Popover>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={props.onExternal}
            aria-label="Open in system browser"
            title="Open in system browser"
          >
            <ExternalLinkIcon className="size-3.5" />
          </Button>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          className="col-start-3 row-start-1 text-muted-foreground @min-[700px]/browser-toolbar:col-start-4"
          onClick={props.onCollapse}
          aria-label={`Collapse ${props.title} controls`}
          title="Hide address bar"
        >
          <PanelTopCloseIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

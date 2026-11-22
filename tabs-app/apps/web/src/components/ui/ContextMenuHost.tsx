import type { ContextMenuItem } from "@tabs/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { installEditContextMenu } from "~/lib/editContextMenu";
import { registerContextMenuPresenter, type ContextMenuRequest } from "~/contextMenuFallback";
import { BrowserContextMenuLayer } from "./BrowserContextMenuLayer";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "./menu";

function renderItems(
  items: readonly ContextMenuItem<string>[],
  choose: (id: string) => void,
): React.ReactNode {
  return items.map((item) => {
    if (item.header) return <MenuGroupLabel key={item.id}>{item.label}</MenuGroupLabel>;
    if (item.children && item.children.length > 0) {
      return (
        <MenuSub key={item.id}>
          <MenuSubTrigger disabled={item.disabled}>{item.label}</MenuSubTrigger>
          <MenuSubPopup>{renderItems(item.children, choose)}</MenuSubPopup>
        </MenuSub>
      );
    }
    return (
      <MenuItem
        key={item.id}
        disabled={item.disabled}
        variant={item.destructive || item.id === "delete" ? "destructive" : "default"}
        onClick={() => choose(item.id)}
      >
        {item.label}
      </MenuItem>
    );
  });
}

/**
 * Renders the app's context menus with the themed Menu primitive, anchored at the pointer.
 * Mount once near the root; callers use `api.contextMenu.show(...)` as before.
 */
export function ContextMenuHost() {
  const [request, setRequest] = useState<ContextMenuRequest | null>(null);
  const requestRef = useRef<ContextMenuRequest | null>(null);
  requestRef.current = request;

  useEffect(
    () =>
      registerContextMenuPresenter((next) => {
        // A new menu replaces the open one; the old caller sees a dismissal.
        requestRef.current?.resolve(null);
        setRequest(next);
      }),
    [],
  );

  useEffect(() => installEditContextMenu(), []);

  const anchor = useMemo(() => {
    const { x, y } = request?.position ?? { x: 0, y: 0 };
    return {
      getBoundingClientRect: () => ({
        x,
        y,
        left: x,
        top: y,
        right: x,
        bottom: y,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      }),
    };
  }, [request]);

  const settle = (id: string | null) => {
    const current = requestRef.current;
    if (!current) return;
    requestRef.current = null;
    current.resolve(id);
  };

  return (
    <>
      <BrowserContextMenuLayer />
      <Menu
        open={request !== null}
        onOpenChange={(open) => {
          if (!open) {
            settle(null);
            setRequest(null);
          }
        }}
      >
        <MenuPopup
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={2}
          className="min-w-44"
          data-slot="context-menu-popup"
        >
          {request
            ? renderItems(request.items, (id) => {
                settle(id);
                setRequest(null);
              })
            : null}
        </MenuPopup>
      </Menu>
    </>
  );
}

import { SlidersHorizontalIcon } from "lucide-react";

import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuSeparator,
  MenuItem,
  MenuTrigger,
} from "../ui/menu";
import { WORKSPACE_DETAILS, isDetailShown, useWorkspaceDetails } from "./workspaceDetails";

/** "Show in thread details": choose which parts of the workspace card appear. */
export function WorkspaceDetailsMenu() {
  const hidden = useWorkspaceDetails((state) => state.hidden);
  const toggle = useWorkspaceDetails((state) => state.toggle);
  const showAll = useWorkspaceDetails((state) => state.showAll);
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label="Choose what the workspace card shows"
            title="Show in thread details"
            className="workspace-action-icon-button"
          />
        }
      >
        <SlidersHorizontalIcon className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>Show in thread details</MenuGroupLabel>
          {WORKSPACE_DETAILS.map((detail) => (
            <MenuCheckboxItem
              key={detail.id}
              checked={isDetailShown(hidden, detail.id)}
              onCheckedChange={() => toggle(detail.id)}
              closeOnClick={false}
            >
              {detail.label}
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem onClick={showAll}>Show all</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

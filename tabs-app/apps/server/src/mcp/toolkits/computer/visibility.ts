import { hideTools } from "../../toolVisibility.ts";

/** Every tool the computer-use toolkit registers shares this prefix. */
export const COMPUTER_TOOL_PREFIX = "computer_";

export const isComputerTool = (name: string) => name.startsWith(COMPUTER_TOOL_PREFIX);

/** Removes the computer_* tools from a `tools/list` body, while the Labs switch is off. */
export const hideComputerTools = (body: string, contentType: string): string =>
  hideTools(body, contentType, isComputerTool);

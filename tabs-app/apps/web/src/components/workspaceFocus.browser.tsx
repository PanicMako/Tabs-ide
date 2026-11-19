import { afterEach, beforeEach, expect, it } from "vitest";
import {
  focusWorkspaceArea,
  installWorkspaceFocusTracking,
  resetWorkspaceFocusTrackingForTest,
} from "~/lib/workspaceFocus";

let stop: () => void = () => undefined;

beforeEach(() => {
  resetWorkspaceFocusTrackingForTest();
  stop = installWorkspaceFocusTracking();
  document.body.innerHTML = `
    <div data-sidebar="sidebar"><button id="thread-a">A</button><button id="thread-b">B</button></div>
    <div data-chat-messages="true"><a href="#x" id="link">link</a></div>
    <form data-chat-composer-form="true"><textarea id="box"></textarea></form>
    <div data-companion-design="grouped" style="display:none"><button id="panel-btn">P</button></div>`;
});

afterEach(() => {
  stop();
  document.body.innerHTML = "";
});

it("moves between the visible areas and skips the hidden panel", () => {
  document.getElementById("thread-a")!.focus();
  expect(focusWorkspaceArea(1)).toBe(true);
  expect(document.activeElement?.id).toBe("link");
  expect(focusWorkspaceArea(1)).toBe(true);
  expect(document.activeElement?.id).toBe("box");
  // The panel is hidden, so forward from the composer wraps to the sidebar.
  expect(focusWorkspaceArea(1)).toBe(true);
  expect(document.activeElement?.id).toBe("thread-a");
});

it("goes back to the last control focused in an area", () => {
  document.getElementById("thread-b")!.focus();
  focusWorkspaceArea(1);
  focusWorkspaceArea(-1);
  expect(document.activeElement?.id).toBe("thread-b");
});

it("reports false when no area is on screen", () => {
  document.body.innerHTML = "<p>nothing here</p>";
  expect(focusWorkspaceArea(1)).toBe(false);
});

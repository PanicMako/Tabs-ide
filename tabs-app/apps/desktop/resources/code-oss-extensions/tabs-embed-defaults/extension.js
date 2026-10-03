"use strict";

const vscode = require("vscode");

function isWelcomeLikeTab(tab) {
  const label = typeof tab.label === "string" ? tab.label : "";
  if (label === "Welcome" || label.startsWith("Walkthrough:") || label.startsWith("Get Started")) {
    return true;
  }

  const input = tab.input;
  const viewType = input && typeof input.viewType === "string" ? input.viewType : "";
  const uri =
    input && input.uri && typeof input.uri.toString === "function" ? input.uri.toString() : "";
  return (
    viewType === "workbench.editors.gettingStartedInput" ||
    uri === "walkThrough:/gettingStarted" ||
    uri.startsWith("walkThrough:")
  );
}

async function closeWelcomeTabs() {
  const tabsToClose = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (isWelcomeLikeTab(tab)) {
        tabsToClose.push(tab);
      }
    }
  }
  if (tabsToClose.length > 0) {
    await vscode.window.tabGroups.close(tabsToClose, true);
  }
}

function activate(context) {
  const scheduleClose = () => {
    queueMicrotask(() => {
      void closeWelcomeTabs();
    });
  };

  scheduleClose();
  for (const delay of [50, 250, 1000, 2500]) {
    const handle = setTimeout(scheduleClose, delay);
    context.subscriptions.push({ dispose: () => clearTimeout(handle) });
  }
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(() => {
      scheduleClose();
    }),
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};

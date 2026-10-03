function showBootError(error: unknown): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.textContent = "Tabs could not start. Reload the window to try again.";
  root.setAttribute("role", "alert");
  console.error("[tabs:startup]", error);
}

void import("./appStartup").then(({ startup }) => startup).catch(showBootError);

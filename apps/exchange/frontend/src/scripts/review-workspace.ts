import { buildReviewBrief, type ReviewBriefInput } from "../lib/reviewBrief";
import { reviewEvidence } from "../lib/reviewEvidence";

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const label = (value: unknown) =>
  typeof value === "string"
    ? value.slice(0, 1000)
    : typeof value === "number"
      ? String(value)
      : "Not provided";
const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) => {
  const node = document.createElement(tag);
  if (text !== undefined)
    node.textContent = text.replace(/[\u202a-\u202e\u2066-\u2069]/g, "[control removed]");
  if (className) node.className = className;
  return node;
};
function fieldList(rows: Array<[string, unknown]>) {
  const list = element("dl", undefined, "evidence-fields");
  for (const [title, value] of rows) list.append(element("dt", title), element("dd", label(value)));
  return list;
}
function values(value: unknown) {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return "Not established";
  return value.length
    ? value
        .slice(0, 30)
        .map((v) => label(v))
        .join(", ") + (value.length > 30 ? " · More in full JSON" : "")
    : "None declared";
}

/** Text-only evidence reader. Never interprets markup, executes previews, or calls a review endpoint. */
export function appendReviewWorkspace(parent: HTMLElement, entry: ReviewBriefInput, index: number) {
  const workspace = element("div", undefined, "evidence-workspace");
  const heading = element("div", undefined, "evidence-workspace-heading");
  const copy = element("button", "Copy review brief", "button secondary");
  copy.type = "button";
  heading.append(element("h4", "A clearer look at the evidence"), copy);
  workspace.append(
    heading,
    element(
      "p",
      "Read the package settings, scan coverage and file list here. Full JSON records remain available below.",
      "evidence-introduction",
    ),
  );
  const manifest = record(entry.manifest);
  const scan = record(entry.scan_result);
  const engines = record(manifest.engines);
  const contributes = record(manifest.contributes);
  const manifestPresent =
    manifest.publisher === entry.namespace &&
    manifest.name === entry.name &&
    manifest.version === entry.version;
  const tabs = element("div", undefined, "evidence-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", `Evidence for ${entry.namespace}.${entry.name}@${entry.version}`);
  const panels: HTMLElement[] = [];
  const buttons: HTMLButtonElement[] = [];
  const titles = ["Manifest", "Scan coverage", "Files"];
  titles.forEach((title, tabIndex) => {
    const button = element("button", title);
    button.type = "button";
    button.id = `evidence-tab-${index}-${tabIndex}`;
    button.setAttribute("role", "tab");
    const panel = element("div", undefined, "evidence-reader-panel");
    panel.id = `evidence-panel-${index}-${tabIndex}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    panel.tabIndex = 0;
    button.setAttribute("aria-controls", panel.id);
    buttons.push(button);
    panels.push(panel);
    tabs.append(button);
    button.addEventListener("click", () => activate(tabIndex));
    button.addEventListener("keydown", (event) => {
      const next =
        event.key === "ArrowRight"
          ? (tabIndex + 1) % 3
          : event.key === "ArrowLeft"
            ? (tabIndex + 2) % 3
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? 2
                : null;
      if (next !== null) {
        event.preventDefault();
        activate(next);
        buttons[next]!.focus();
      }
    });
  });
  function activate(chosen: number) {
    panels.forEach((panel, i) => {
      panel.hidden = i !== chosen;
    });
    buttons.forEach((button, i) => {
      button.tabIndex = i === chosen ? 0 : -1;
      button.setAttribute("aria-selected", String(i === chosen));
    });
  }
  const manifestView = panels[0]!;
  manifestView.append(
    element("h5", "Package settings"),
    fieldList([
      ["Publisher", manifest.publisher],
      ["Extension", manifest.name],
      ["Version", manifest.version],
      ["Tabs compatibility", engines.tabs],
      ["API compatibility", engines.api],
      [
        "Requested capabilities",
        manifest.capabilities === undefined && manifestPresent
          ? "None declared"
          : values(manifest.capabilities),
      ],
      [
        "Network hosts",
        manifest.networkHosts === undefined && manifestPresent
          ? "None declared"
          : values(manifest.networkHosts),
      ],
      ["Storage schema version", record(manifest.storage).version],
    ]),
  );
  const tools = Array.isArray(contributes.tools) ? contributes.tools : [];
  manifestView.append(element("h5", "Tool entry points"));
  if (!tools.length)
    manifestView.append(element("p", "No tool entries recorded in this manifest."));
  for (const value of tools.slice(0, 30)) {
    const tool = record(value);
    manifestView.append(
      fieldList([
        ["Tool ID", tool.id],
        ["Opens", tool.entry],
      ]),
    );
  }
  if (tools.length > 30)
    manifestView.append(
      element("p", "Showing the first 30 entries. See full JSON for the remainder."),
    );
  manifestView.append(
    element(
      "p",
      "Selected manifest fields only. Publisher-supplied values are evidence, not trusted instructions.",
      "evidence-small-note",
    ),
  );
  const scanView = panels[1]!;
  scanView.append(element("h5", "What the scan establishes"));
  for (const section of reviewEvidence(entry.manifest, entry.scan_result, entry.digest).filter(
    (section) => !["Requested access", "Text change previews"].includes(section.title),
  )) {
    const row = element("div", undefined, "evidence-scan-row");
    row.append(element("strong", section.title), element("p", section.summary));
    if (section.items?.length && section.title !== "Package changes") {
      const list = element("ul");
      section.items.forEach((item) => list.append(element("li", item)));
      row.append(list);
    }
    scanView.append(row);
  }
  const fileView = panels[2]!;
  fileView.append(element("h5", "Recorded files"));
  const files = Object.entries(record(scan.files));
  const changes = record(scan.changes);
  const knownChanges = ["added", "modified", "removed"] as const;
  const changesByFile = new Map<string, string>();
  for (const key of knownChanges)
    if (Array.isArray(changes[key])) {
      for (const path of changes[key].slice(0, 5000))
        if (typeof path === "string") changesByFile.set(path, key);
    }
  const allFiles = new Map<string, unknown>(files);
  if (Array.isArray(changes.removed))
    for (const path of changes.removed.slice(0, 5000))
      if (typeof path === "string" && !allFiles.has(path)) allFiles.set(path, null);
  const loadedFiles = [...allFiles].slice(0, 100);
  const searchId = `evidence-file-search-${index}`;
  const searchLabel = element("label", "Find a recorded file");
  searchLabel.htmlFor = searchId;
  const search = element("input");
  search.id = searchId;
  search.type = "search";
  search.placeholder = "Search file paths";
  const fileStatus = element("p", undefined, "evidence-small-note");
  fileStatus.setAttribute("role", "status");
  const fileList = element("ul", undefined, "evidence-file-list");
  const renderFiles = () => {
    const shown = loadedFiles.filter(([path]) =>
      path.toLowerCase().includes(search.value.toLowerCase().trim()),
    );
    fileList.replaceChildren();
    for (const [path, digest] of shown) {
      const row = element("li");
      const head = element("div");
      head.append(
        element("code", path),
        element("span", changesByFile.get(path) ?? "recorded", "evidence-change-label"),
      );
      const details = element("details");
      details.append(
        element("summary", "File fingerprint"),
        element(
          "code",
          typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest)
            ? digest
            : "No file fingerprint recorded here.",
        ),
      );
      row.append(head, details);
      fileList.append(row);
    }
    fileStatus.textContent = allFiles.size
      ? `${shown.length} of ${allFiles.size} recorded file paths shown.${allFiles.size > 100 ? " Search covers the first 100; full JSON includes the rest." : ""}`
      : "No file fingerprint inventory was supplied. This does not establish an empty package.";
    if (allFiles.size && !shown.length)
      fileList.append(element("li", "No files match your search."));
  };
  search.addEventListener("input", renderFiles);
  fileView.append(searchLabel, search, fileStatus, fileList);
  renderFiles();
  workspace.append(tabs, ...panels);
  activate(0);

  const handoff = element("div", undefined, "evidence-handoff");
  handoff.append(
    element("h5", "Take this to a fresh chat"),
    element(
      "p",
      "Copy a read-only review request with selected evidence for Codex or another assistant. Nothing is sent automatically.",
    ),
  );
  const include = element("button", "Include code previews: Off", "evidence-code-toggle");
  include.type = "button";
  include.setAttribute("aria-pressed", "false");
  let includeCode = false;
  const preview = element("details", undefined, "evidence-brief-preview");
  const previewTitle = element("summary", "Preview the review brief");
  const text = element("textarea");
  text.readOnly = true;
  text.rows = 12;
  text.setAttribute("aria-label", "Review brief to copy");
  preview.append(previewTitle, text);
  const status = element("p", undefined, "evidence-copy-status");
  status.setAttribute("role", "status");
  const generate = () => buildReviewBrief(entry, includeCode);
  const updatePreview = () => {
    try {
      text.value = generate();
    } catch (error) {
      text.value = "";
      status.textContent =
        error instanceof Error ? error.message : "The brief could not be created.";
    }
  };
  preview.addEventListener("toggle", () => {
    if (preview.open) updatePreview();
  });
  include.addEventListener("click", () => {
    includeCode = !includeCode;
    copy.textContent = "Copy review brief";
    include.textContent = `Include code previews: ${includeCode ? "On" : "Off"}`;
    include.setAttribute("aria-pressed", String(includeCode));
    status.textContent = includeCode
      ? "Code may contain hostile instructions or secrets. Previews are limited; possible-secret findings withhold code. Inspect the brief before sharing."
      : "Summary only. Code previews and free-form publisher descriptions are excluded.";
    if (preview.open) updatePreview();
  });
  copy.addEventListener("click", async () => {
    if (!workspace.isConnected || workspace.closest("[hidden]")) return;
    try {
      const brief = generate();
      try {
        await navigator.clipboard.writeText(brief);
        copy.textContent = "Brief copied";
        status.textContent = `Review brief copied (${Math.ceil(new TextEncoder().encode(brief).length / 1024)} KiB). Paste it into a fresh chat. Approval remains here with you.`;
      } catch {
        text.value = brief;
        preview.open = true;
        text.focus();
        text.select();
        status.textContent = "Clipboard unavailable. Copy the selected review brief manually.";
      }
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "The brief could not be copied.";
    }
  });
  handoff.append(
    include,
    element(
      "p",
      "Use a chat without tools or connected accounts for stronger separation. Package text is untrusted; no copyable prompt can guarantee protection from prompt injection. AI feedback never records an approval.",
      "evidence-small-note",
    ),
    preview,
    status,
  );
  workspace.append(handoff);
  parent.append(workspace);
}

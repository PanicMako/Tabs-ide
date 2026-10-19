import { buildReviewBrief, type ReviewBriefInput } from "../lib/reviewBrief";
import { reviewEvidence } from "../lib/reviewEvidence";
import { reviewCodeLines, reviewCodePreviews } from "../lib/reviewCode";
import { reviewArchivePath } from "../lib/reviewDecision";
import { request, RegistryRequestError } from "./api";
import { createReviewCodeStudio } from "./review-code-studio";

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
export function appendReviewWorkspace(
  parent: HTMLElement,
  entry: ReviewBriefInput,
  index: number,
  onAccessLost?: () => void,
  onUseNotes?: (text: string) => void,
  handoffParent?: HTMLElement,
) {
  const workspace = element("div", undefined, "evidence-workspace");
  const heading = element("div", undefined, "evidence-workspace-heading");
  const copy = element("button", "Copy for AI review", "button secondary");
  copy.type = "button";
  const openCode = element("button", "Open code review ↗", "button studio-launch");
  openCode.type = "button";
  heading.append(element("h4", "A clearer look at the evidence"), openCode, copy);
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
  const coverage = element("div", undefined, "evidence-scan-row");
  coverage.append(
    element("strong", "Malware coverage: limited static checks"),
    element(
      "p",
      "The current Tabs pipeline checks known-bad hashes, executable formats, selected secret patterns and dependency advisories. It does not run a general antivirus engine or observe extension behavior. No findings does not mean malware-free.",
    ),
  );
  scanView.append(coverage);
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
  const previews = reviewCodePreviews(entry.scan_result, entry.digest);
  const previewsByFile = new Map(previews.map((preview) => [preview.file, preview]));
  for (const preview of previews) if (!allFiles.has(preview.file)) allFiles.set(preview.file, null);
  const loadedFiles = [...allFiles];
  const openStudio = createReviewCodeStudio({
    entry,
    files: loadedFiles,
    changes: changesByFile,
    owner: workspace,
    onAccessLost,
    onUseNotes,
  });
  openCode.addEventListener("click", () => openStudio(openCode));
  const source = element("section", undefined, "evidence-source-reader");
  source.setAttribute("aria-label", "Code change reader");
  const sourceTitle = element("h5", "Choose a file to read its code");
  sourceTitle.tabIndex = -1;
  const sourceStatus = element("p");
  sourceStatus.setAttribute("role", "status");
  const sourceBody = element("div", undefined, "evidence-source-body");
  const archiveLink = element("a", "Download exact archive for full inspection ↗");
  archiveLink.href = reviewArchivePath(entry);
  const sourceNotice = element(
    "p",
    "Read-only, untrusted source. Nothing here is executed. Direction controls are shown explicitly. Change previews mark added (+) and removed (−) lines; submitted files use source line numbers.",
    "evidence-small-note",
  );
  const readSubmitted = element("button", "Read submitted file", "button secondary");
  readSubmitted.type = "button";
  const sourceActions = element("div", undefined, "evidence-source-actions");
  sourceActions.append(readSubmitted, archiveLink);
  source.append(sourceTitle, sourceStatus, sourceActions, sourceNotice, sourceBody);
  let sourceRequest: AbortController | undefined;
  let selectedPath: string | undefined;
  const fileButtons = new Map<string, HTMLButtonElement>();
  readSubmitted.addEventListener("click", async () => {
    if (
      !selectedPath ||
      !workspace.isConnected ||
      workspace.closest('[hidden], [data-panel-active="false"]')
    )
      return;
    const path = selectedPath;
    sourceRequest?.abort();
    const controller = new AbortController();
    sourceRequest = controller;
    readSubmitted.disabled = true;
    readSubmitted.textContent = "Reading verified archive…";
    sourceStatus.textContent =
      "Checking the exact archive and reading this file. Nothing is executed.";
    try {
      const url =
        reviewArchivePath(entry).replace(/\/download$/, "/source") +
        `?digest=${entry.digest}&file=${encodeURIComponent(path)}`;
      const data = await request<{
        digest: string;
        file: string;
        bytes: number;
        sha256?: string;
        text?: string;
        omitted?: string;
      }>(url, "GET", undefined, controller.signal);
      if (
        controller.signal.aborted ||
        !workspace.isConnected ||
        workspace.closest('[hidden], [data-panel-active="false"]') ||
        selectedPath !== path
      )
        return;
      if (
        data.digest !== entry.digest ||
        data.file !== path ||
        !Number.isSafeInteger(data.bytes) ||
        data.bytes < 0
      )
        throw new Error("File evidence does not match this package. Refresh the review queue.");
      sourceBody.replaceChildren();
      if (typeof data.text !== "string" || data.text.length > 384 * 1024) {
        sourceStatus.textContent =
          data.omitted === "too-large"
            ? "This file exceeds the 384 KiB reader limit. Download the exact archive for complete inspection."
            : "This file is binary or is not valid plain text. Download the archive for independent inspection.";
        return;
      }
      const expected = allFiles.get(path);
      if (
        typeof data.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(data.sha256) ||
        (typeof expected === "string" && expected !== data.sha256)
      )
        throw new Error(
          "File fingerprint does not match the scan. Refresh and investigate before approval.",
        );
      const lines = data.text.split("\n");
      let page = 0;
      const navigation = element("div", undefined, "evidence-source-pager");
      const previous = element("button", "Previous lines");
      const next = element("button", "Next lines");
      previous.type = next.type = "button";
      const position = element("span");
      position.setAttribute("role", "status");
      const code = element("pre", undefined, "evidence-code-lines");
      code.tabIndex = 0;
      code.setAttribute("aria-label", `Submitted source for ${path}`);
      const renderPage = () => {
        const start = page * 200;
        code.replaceChildren();
        for (const [i, text] of lines.slice(start, start + 200).entries()) {
          const row = element("span", undefined, "evidence-code-line submitted");
          row.append(
            element("span", String(start + i + 1), "evidence-line-number"),
            element("code", text || " "),
          );
          code.append(row);
        }
        position.textContent = `Lines ${start + 1}–${Math.min(start + 200, lines.length)} of ${lines.length}`;
        previous.disabled = page === 0;
        next.disabled = start + 200 >= lines.length;
        code.scrollTop = 0;
      };
      previous.addEventListener("click", () => {
        page--;
        renderPage();
      });
      next.addEventListener("click", () => {
        page++;
        renderPage();
      });
      navigation.append(previous, position, next);
      sourceBody.append(navigation, code);
      renderPage();
      sourceStatus.textContent = `Submitted file · ${data.bytes.toLocaleString()} bytes · full text loaded from the verified archive, shown 200 lines at a time. This is source inspection, not proof of safety.`;
    } catch (error) {
      if (
        controller.signal.aborted ||
        !workspace.isConnected ||
        workspace.closest('[hidden], [data-panel-active="false"]')
      )
        return;
      sourceBody.replaceChildren();
      if (error instanceof RegistryRequestError && [401, 403].includes(error.status)) {
        sourceStatus.textContent = "Reviewer access expired. Sign in again to read source.";
        onAccessLost?.();
      } else
        sourceStatus.textContent =
          error instanceof Error
            ? error.message
            : "Could not read the file. Retry or download the exact archive.";
    } finally {
      if (sourceRequest === controller) {
        readSubmitted.disabled = false;
        readSubmitted.textContent = "Read submitted file";
      }
    }
  });
  const showSource = (path: string, moveFocus = false) => {
    sourceRequest?.abort();
    selectedPath = path;
    readSubmitted.disabled = false;
    readSubmitted.textContent = "Read submitted file";
    for (const [file, button] of fileButtons)
      button.setAttribute("aria-pressed", String(file === path));
    sourceTitle.textContent = path.replace(/[\u202a-\u202e\u2066-\u2069]/g, "[control removed]");
    sourceBody.replaceChildren();
    const preview = previewsByFile.get(path);
    sourceStatus.textContent =
      preview?.explanation ??
      "No text preview is available for this file. It may be unchanged, outside preview limits, or absent from the scan. Download the exact archive to inspect it; this does not mean the file is safe.";
    if (preview?.patch !== undefined) {
      const code = element("pre", undefined, "evidence-code-lines");
      code.tabIndex = 0;
      code.setAttribute("aria-label", `Code changes for ${path}`);
      for (const line of reviewCodeLines(preview.patch)) {
        const row = element("span", undefined, `evidence-code-line ${line.kind}`);
        const before = element(
          "span",
          line.before === null ? "" : String(line.before),
          "evidence-line-number",
        );
        const after = element(
          "span",
          line.after === null ? "" : String(line.after),
          "evidence-line-number",
        );
        const content = element("code", line.text || " ");
        row.append(before, after, content);
        code.append(row);
      }
      sourceBody.append(code);
    }
    if (moveFocus) sourceTitle.focus();
  };
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
    const matches = loadedFiles.filter(([path]) =>
      path.toLowerCase().includes(search.value.toLowerCase().trim()),
    );
    const shown = matches.slice(0, 100);
    fileList.replaceChildren();
    fileButtons.clear();
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
      const read = element(
        "button",
        previewsByFile.get(path)?.patch !== undefined ? "Read code changes" : "Preview details",
        "evidence-read-code",
      );
      read.type = "button";
      read.setAttribute("aria-label", `Read code changes for ${path}`);
      read.setAttribute("aria-pressed", String(selectedPath === path));
      read.addEventListener("click", () => showSource(path, true));
      fileButtons.set(path, read);
      row.append(head, read, details);
      fileList.append(row);
    }
    fileStatus.textContent = allFiles.size
      ? `${shown.length} of ${matches.length} matching files shown · ${allFiles.size} recorded paths.${matches.length > 100 ? " Refine your search to see other files." : ""}`
      : "No file fingerprint inventory was supplied. This does not establish an empty package.";
    if (allFiles.size && !shown.length)
      fileList.append(element("li", "No files match your search."));
  };
  search.addEventListener("input", renderFiles);
  const launch = element("div", undefined, "studio-launch-card");
  const launchButton = element("button", "Open code review ↗", "button");
  launchButton.type = "button";
  launchButton.addEventListener("click", () => openStudio(launchButton));
  launch.append(
    element("h5", "Your package, in a familiar workspace."),
    element(
      "p",
      "Browse folders, read syntax-colored source, find a line, and leave comments or suggested changes beside the code.",
    ),
    launchButton,
  );
  const quickReader = element("details", undefined, "studio-quick-reader");
  quickReader.append(
    element("summary", "Quick file lookup & fingerprints"),
    source,
    searchLabel,
    search,
    fileStatus,
    fileList,
  );
  fileView.append(launch, quickReader);
  renderFiles();
  const initialPreview =
    previews.find(
      (preview) => preview.patch !== undefined && /\.(?:js|ts|html|jsx|tsx)$/.test(preview.file),
    ) ?? previews.find((preview) => preview.patch !== undefined);
  if (initialPreview) showSource(initialPreview.file);
  else if (loadedFiles[0]) showSource(loadedFiles[0][0]);
  else readSubmitted.disabled = true;
  workspace.append(tabs, ...panels);
  activate(0);

  const handoff = element("div", undefined, "evidence-handoff");
  handoff.append(
    element("h5", "Get a second opinion"),
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
  let handoffOptions: HTMLDetailsElement | undefined;
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
    copy.textContent = "Copy for AI review";
    include.textContent = `Include code previews: ${includeCode ? "On" : "Off"}`;
    include.setAttribute("aria-pressed", String(includeCode));
    status.textContent = includeCode
      ? "Code may contain hostile instructions or secrets. Previews are limited; possible-secret findings withhold code. Inspect the brief before sharing."
      : "Summary only. Code previews and free-form publisher descriptions are excluded.";
    if (preview.open) updatePreview();
  });
  copy.addEventListener("click", async () => {
    if (!workspace.isConnected || workspace.closest('[hidden], [data-panel-active="false"]'))
      return;
    try {
      const brief = generate();
      try {
        await navigator.clipboard.writeText(brief);
        copy.textContent = "Brief copied";
        status.textContent = `Review brief copied (${Math.ceil(new TextEncoder().encode(brief).length / 1024)} KiB). Paste it into a fresh chat. Approval remains here with you.`;
      } catch {
        text.value = brief;
        preview.open = true;
        if (handoffOptions) handoffOptions.open = true;
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
  if (handoffParent) {
    const options = element("details", undefined, "review-ai-options");
    handoffOptions = options;
    options.append(
      element("summary", "AI review options & preview"),
      ...Array.from(handoff.childNodes).filter((node) => node !== status),
    );
    handoff.replaceChildren(
      copy,
      element("p", "Copies a summary by default. Add code previews in options."),
      status,
      options,
    );
    handoffParent.append(handoff);
  } else workspace.append(handoff);
  parent.append(workspace);
  return openStudio;
}

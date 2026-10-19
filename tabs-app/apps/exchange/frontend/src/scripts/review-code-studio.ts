import { reviewArchivePath } from "../lib/reviewDecision";
import { reviewCodeLines, reviewCodePreviews } from "../lib/reviewCode";
import { sourceLanguage, sourceTokens } from "../lib/reviewSyntax";
import { formatCodeReviewNotes, type CodeReviewNote } from "../lib/reviewNotes";
import type { ReviewBriefInput } from "../lib/reviewBrief";
import { request, RegistryRequestError } from "./api";

const visibleText = (text: string) =>
  text.replace(/[\u202a-\u202e\u2066-\u2069]/g, "[direction control]");
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = visibleText(text);
  if (className) element.className = className;
  return element;
}
function button(text: string, action: () => void, className = "") {
  const value = node("button", text, className);
  value.type = "button";
  value.setAttribute("data-quiet-control", "");
  value.addEventListener("click", action);
  return value;
}
interface StudioOptions {
  entry: ReviewBriefInput;
  files: Array<[string, unknown]>;
  changes: Map<string, string>;
  owner: HTMLElement;
  onAccessLost?: (() => void) | undefined;
  onUseNotes?: ((text: string) => void) | undefined;
}
interface SourceFile {
  text: string;
  bytes: number;
}
/** A reviewer-only text workspace. Suggested changes never modify package bytes or record decisions. */
export function createReviewCodeStudio(options: StudioOptions) {
  const { entry } = options;
  const notes: CodeReviewNote[] = [];
  const cache = new Map<string, SourceFile>();
  const previews = new Map(
    reviewCodePreviews(entry.scan_result, entry.digest).map((value) => [value.file, value]),
  );
  const files = options.files
    .filter(([path]) => path.length <= 512)
    .sort(([a], [b]) => a.localeCompare(b));
  let closeCurrent: (() => void) | undefined;
  return function openStudio(trigger: HTMLElement) {
    if (closeCurrent || !options.owner.isConnected || options.owner.closest("[hidden]")) return;
    const root = node("div", undefined, "review-code-studio");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", `Code review · ${entry.namespace}.${entry.name}`);
    let controller: AbortController | undefined;
    let closed = false;
    const background = [...document.body.children]
      .filter((value) => value instanceof HTMLElement)
      .map((value) => [value as HTMLElement, (value as HTMLElement).inert] as const);
    background.forEach(([value]) => {
      value.inert = true;
    });
    const close = () => {
      if (closed) return;
      closed = true;
      controller?.abort();
      cache.clear();
      observer.disconnect();
      root.remove();
      background.forEach(([value, inert]) => {
        value.inert = inert;
      });
      closeCurrent = undefined;
      if (trigger.isConnected && !trigger.closest("[hidden]")) trigger.focus();
    };
    closeCurrent = close;
    const observer = new MutationObserver(() => {
      if (!options.owner.isConnected || options.owner.closest("[hidden]")) close();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
    const top = node("header", undefined, "studio-top");
    const identity = node("div");
    identity.append(
      node("span", "PACKAGE REVIEW", "studio-eyebrow"),
      node("strong", `${entry.namespace}.${entry.name}`),
      node("span", `v${entry.version} · ${entry.digest.slice(0, 12)}…`, "studio-fingerprint"),
    );
    const feedback = node("span", "Draft notes stay in this tab until refresh.", "studio-feedback");
    feedback.setAttribute("role", "status");
    const notesToggle = button(`Review notes (${notes.length})`, () => {
      notesPanel.hidden = !notesPanel.hidden;
      root.classList.toggle("studio-has-notes", !notesPanel.hidden);
      if (!notesPanel.hidden) {
        if (!notes.length) compose(false);
        else comment.focus();
      }
    });
    const closeButton = button("Close review ×", close, "studio-close");
    top.append(identity, feedback, notesToggle, closeButton);
    const body = node("div", undefined, "studio-body");
    const explorer = node("aside", undefined, "studio-explorer");
    explorer.setAttribute("aria-label", "Package file explorer");
    const explorerTitle = node("div", undefined, "studio-explorer-title");
    explorerTitle.append(node("strong", "Explorer"), node("span", `${files.length} files`));
    const fileSearch = node("input");
    fileSearch.type = "search";
    fileSearch.placeholder = "Find a file…";
    fileSearch.setAttribute("aria-label", "Find a package file");
    const tree = node("nav", undefined, "studio-tree");
    tree.setAttribute("aria-label", "Package folders and files");
    const treeStatus = node("span", undefined, "studio-tree-status");
    treeStatus.setAttribute("role", "status");
    explorer.append(explorerTitle, fileSearch, treeStatus, tree);
    const editor = node("main", undefined, "studio-editor");
    const tabBar = node("div", undefined, "studio-file-tabs");
    tabBar.setAttribute("aria-label", "Open files");
    const toolbar = node("div", undefined, "studio-editor-toolbar");
    const breadcrumbs = node("span", "Choose a file", "studio-breadcrumbs");
    const original = button("Submitted file", () => {
      mode = "source";
      void loadFile(active);
    });
    const diff = button("Changes", () => {
      mode = "diff";
      renderDocument();
    });
    const wrap = button("Wrap", () => {
      root.classList.toggle("studio-wrap");
      wrap.setAttribute("aria-pressed", String(root.classList.contains("studio-wrap")));
    });
    wrap.setAttribute("aria-pressed", "false");
    const mark = button("Add note", () => compose(false));
    const suggest = button("Suggest change", () => compose(true));
    toolbar.append(breadcrumbs, original, diff, wrap, mark, suggest);
    const findBar = node("div", undefined, "studio-findbar");
    const find = node("input");
    find.type = "search";
    find.placeholder = "Find in this file…";
    find.setAttribute("aria-label", "Find in code");
    const matchStatus = node("span");
    matchStatus.setAttribute("role", "status");
    const previousMatch = button("↑", () => navigateMatch(-1));
    previousMatch.setAttribute("aria-label", "Previous code match");
    const nextMatch = button("↓", () => navigateMatch(1));
    nextMatch.setAttribute("aria-label", "Next code match");
    const goto = node("input");
    goto.type = "text";
    goto.inputMode = "numeric";
    goto.placeholder = "Go to line";
    goto.setAttribute("aria-label", "Go to line");
    findBar.append(find, matchStatus, previousMatch, nextMatch, goto);
    const status = node("p", "Choose a file from the explorer.", "studio-code-status");
    status.setAttribute("role", "status");
    const code = node("div", undefined, "studio-code");
    code.tabIndex = 0;
    code.setAttribute("role", "region");
    code.setAttribute("aria-label", "Read-only package code");
    const footer = node("footer", undefined, "studio-editor-footer");
    const previousPage = button("‹", () => {
      page--;
      renderPage();
    });
    previousPage.setAttribute("aria-label", "Previous code page");
    const nextPage = button("›", () => {
      page++;
      renderPage();
    });
    nextPage.setAttribute("aria-label", "Next code page");
    const pageStatus = node("span");
    const language = node("span");
    const selection = node("span", "Click a line number to mark it. Shift-click for a range.");
    footer.append(previousPage, pageStatus, nextPage, language, selection);
    editor.append(tabBar, toolbar, findBar, status, code, footer);
    const notesPanel = node("aside", undefined, "studio-notes");
    notesPanel.hidden = true;
    notesPanel.setAttribute("aria-label", "Draft review notes");
    const notesTitle = node("div", undefined, "studio-notes-heading");
    notesTitle.append(
      node("h3", "Review notes"),
      button("×", () => {
        notesPanel.hidden = true;
        root.classList.remove("studio-has-notes");
        notesToggle.focus();
      }),
    );
    const noteHelp = node(
      "p",
      "Draft only. Use these in your decision when you’re ready to give the publisher feedback.",
    );
    const target = node("p", "Choose a file and mark a line.", "studio-note-target");
    const commentLabel = node("label", "Your comment");
    const comment = node("textarea");
    comment.rows = 4;
    comment.maxLength = 600;
    comment.placeholder = "Explain what needs attention…";
    commentLabel.append(comment);
    const replacementLabel = node("label", "Suggested replacement · never applied to the package");
    replacementLabel.hidden = true;
    const replacement = node("textarea");
    replacement.rows = 7;
    replacement.maxLength = 2000;
    replacement.spellcheck = false;
    replacementLabel.append(replacement);
    let editingIndex: number | undefined;
    let noteTarget: { file: string; line: number; endLine: number } | undefined;
    const save = button("Save draft note", () => {
      if (!noteTarget || !comment.value.trim()) {
        feedback.textContent = "Write a comment before saving the note.";
        comment.focus();
        return;
      }
      if (editingIndex === undefined && notes.length >= 30) {
        feedback.textContent = "This draft supports 30 notes. Remove a note before adding another.";
        return;
      }
      const note = {
        ...noteTarget,
        comment: comment.value.trim(),
        ...(!replacementLabel.hidden ? { replacement: replacement.value } : {}),
      };
      if (editingIndex === undefined) notes.push(note);
      else notes[editingIndex] = note;
      editingIndex = undefined;
      noteTarget = undefined;
      comment.value = "";
      replacementLabel.hidden = true;
      replacement.value = "";
      renderNotes();
      renderPage();
      feedback.textContent = "Draft note saved. Nothing sent to the publisher.";
    });
    const noteList = node("div", undefined, "studio-note-list");
    const useNotes = button(
      "Use notes in decision",
      () => {
        try {
          const text = formatCodeReviewNotes(
            notes,
            `${entry.namespace}.${entry.name}@${entry.version}`,
          );
          options.onUseNotes?.(text);
          close();
        } catch (error) {
          feedback.textContent =
            error instanceof Error ? error.message : "Could not use these notes.";
        }
      },
      "studio-primary",
    );
    useNotes.disabled = !options.onUseNotes;
    const copyNotes = button("Copy draft notes", async () => {
      try {
        if (!notes.length) throw new Error("Add a note first.");
        const text = notes
          .map(
            (note) =>
              `${note.file}:${note.line}–${note.endLine}\n${note.comment}${note.replacement !== undefined ? `\nSuggested replacement (not applied):\n${note.replacement}` : ""}`,
          )
          .join("\n\n");
        await navigator.clipboard.writeText(text);
        feedback.textContent = "Draft notes copied. Nothing sent.";
      } catch {
        feedback.textContent = "Could not copy. Select your notes and copy them manually.";
      }
    });
    notesPanel.append(
      notesTitle,
      noteHelp,
      target,
      commentLabel,
      replacementLabel,
      save,
      noteList,
      useNotes,
      copyNotes,
    );
    body.append(explorer, editor, notesPanel);
    root.append(top, body);
    let active = "";
    let mode: "source" | "diff" = "source";
    let page = 0;
    let rows: Array<{ number: number; text: string; kind: string }> = [];
    let selectedStart = 1;
    let selectedEnd = 1;
    let matches: number[] = [];
    let matchIndex = -1;
    const opened: string[] = [];
    const collapsed = new Set<string>();
    function renderTabs() {
      tabBar.replaceChildren();
      for (const path of opened) {
        const tab = button(path.split("/").pop() ?? path, () => openFile(path), "studio-file-tab");
        tab.setAttribute("aria-label", `Open ${path}`);
        tab.setAttribute("aria-pressed", String(path === active));
        tab.title = path;
        tabBar.append(tab);
      }
    }
    function renderTree() {
      tree.replaceChildren();
      const matched = files.filter(([path]) =>
        path.toLowerCase().includes(fileSearch.value.trim().toLowerCase()),
      );
      treeStatus.textContent = `${Math.min(matched.length, 200)} of ${matched.length} matching files${matched.length > 200 ? " · refine your search" : ""}`;
      interface TreeNode {
        directories: Map<string, TreeNode>;
        files: string[];
      }
      const branch = (): TreeNode => ({ directories: new Map(), files: [] });
      const model = branch();
      for (const [path] of matched.slice(0, 200)) {
        const parts = path.split("/");
        let group = model;
        for (const part of parts.slice(0, Math.min(parts.length - 1, 16))) {
          if (!group.directories.has(part)) group.directories.set(part, branch());
          group = group.directories.get(part)!;
        }
        group.files.push(path);
      }
      function appendBranch(group: TreeNode, parent: HTMLElement, prefix: string) {
        const list = node("ul");
        parent.append(list);
        for (const [name, child] of group.directories) {
          const path = prefix + name + "/";
          const row = node("li");
          const toggle = button(
            `▾  ${name}`,
            () => {
              if (collapsed.has(path)) collapsed.delete(path);
              else collapsed.add(path);
              renderTree();
              [...tree.querySelectorAll<HTMLButtonElement>(".studio-folder")]
                .find((value) => value.dataset.folder === path)
                ?.focus();
            },
            "studio-folder",
          );
          const expanded = fileSearch.value.length > 0 || !collapsed.has(path);
          toggle.textContent = visibleText(`${expanded ? "▾" : "▸"}  ${name}`);
          toggle.setAttribute("aria-expanded", String(expanded));
          toggle.dataset.folder = path;
          toggle.setAttribute("aria-label", `Folder ${path}`);
          row.append(toggle);
          list.append(row);
          if (expanded) appendBranch(child, row, path);
        }
        for (const path of group.files) {
          const row = node("li");
          const leaf = button("", () => openFile(path), "studio-file");
          const icon = node(
            "span",
            /\.(?:json)$/.test(path)
              ? "{}"
              : /\.(?:js|ts|jsx|tsx)$/.test(path)
                ? "JS"
                : /\.(?:css)$/.test(path)
                  ? "#"
                  : "◇",
            "studio-file-icon",
          );
          leaf.append(
            icon,
            node("span", path.split("/").pop() ?? path),
            node(
              "span",
              options.changes.get(path)?.slice(0, 1).toUpperCase() ?? "",
              "studio-file-change",
            ),
          );
          leaf.title = path;
          leaf.setAttribute("aria-label", `Read ${path}`);
          leaf.setAttribute("aria-current", String(path === active));
          row.append(leaf);
          list.append(row);
        }
      }
      appendBranch(model, tree, "");
    }
    function renderPage() {
      code.replaceChildren();
      const start = page * 200;
      for (const [index, row] of rows.slice(start, start + 200).entries()) {
        const line = node("div", undefined, `studio-line ${row.kind}`);
        const marked = notes.some(
          (note) => note.file === active && row.number >= note.line && row.number <= note.endLine,
        );
        line.classList.toggle("has-note", marked);
        line.classList.toggle("selected", row.number >= selectedStart && row.number <= selectedEnd);
        const gutter = node(
          "button",
          row.kind === "meta" ? "·" : String(row.number),
          "studio-gutter",
        );
        gutter.type = "button";
        gutter.setAttribute("data-quiet-control", "");
        gutter.tabIndex = row.number === selectedStart ? 0 : -1;
        gutter.setAttribute(
          "aria-label",
          `Mark line ${row.number}${marked ? ", has review note" : ""}`,
        );
        gutter.addEventListener("click", (event) => {
          if (event.shiftKey) {
            selectedEnd = row.number;
            if (selectedEnd < selectedStart)
              [selectedStart, selectedEnd] = [selectedEnd, selectedStart];
          } else selectedStart = selectedEnd = row.number;
          selection.textContent = `Selected ${selectedStart === selectedEnd ? "line " + selectedStart : "lines " + selectedStart + "–" + selectedEnd}`;
          renderPage();
          code.querySelector<HTMLButtonElement>(`[data-line="${selectedStart}"] button`)?.focus();
        });
        gutter.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const next = Math.max(
            0,
            Math.min(rows.length - 1, start + index + (event.key === "ArrowDown" ? 1 : -1)),
          );
          reveal(next);
          code.querySelector<HTMLButtonElement>(`[data-index="${next}"] button`)?.focus();
        });
        const text = node("code");
        for (const token of sourceTokens(row.text || " ", active))
          text.append(node("span", token.text, `syntax-${token.kind}`));
        line.append(gutter, text);
        line.dataset.line = String(row.number);
        line.dataset.index = String(start + index);
        code.append(line);
      }
      pageStatus.textContent = rows.length
        ? `${start + 1}–${Math.min(start + 200, rows.length)} of ${rows.length} lines`
        : "No code loaded";
      previousPage.disabled = page === 0;
      nextPage.disabled = start + 200 >= rows.length;
      language.textContent = active ? sourceLanguage(active) : "";
      mark.disabled = suggest.disabled = !active || !rows.length;
    }
    function renderDocument() {
      page = 0;
      selectedStart = selectedEnd = 1;
      original.setAttribute("aria-pressed", String(mode === "source"));
      diff.setAttribute("aria-pressed", String(mode === "diff"));
      if (mode === "diff") {
        const preview = previews.get(active);
        rows =
          preview?.patch !== undefined
            ? reviewCodeLines(preview.patch).map((line, index) => ({
                number: line.after ?? line.before ?? index + 1,
                text: line.text,
                kind: line.kind,
              }))
            : [];
        status.textContent =
          preview?.explanation ??
          "No recorded diff for this file. Open Submitted file to inspect its actual code.";
      } else {
        const data = cache.get(active);
        rows = data
          ? data.text
              .split("\n")
              .map((text, index) => ({ number: index + 1, text, kind: "source" }))
          : [];
        if (data)
          status.textContent = `Verified submitted file · ${data.bytes.toLocaleString()} bytes · read-only`;
      }
      renderPage();
      updateMatches();
      code.scrollTop = 0;
    }
    async function loadFile(path: string) {
      if (!path) return;
      if (cache.has(path)) {
        renderDocument();
        return;
      }
      controller?.abort();
      const pending = new AbortController();
      controller = pending;
      rows = [];
      renderPage();
      status.textContent = "Reading the fingerprint-verified archive…";
      try {
        const data = await request<{
          digest: string;
          file: string;
          bytes: number;
          sha256?: string;
          text?: string;
          omitted?: string;
        }>(
          reviewArchivePath(entry).replace(/\/download$/, "/source") +
            `?digest=${entry.digest}&file=${encodeURIComponent(path)}`,
          "GET",
          undefined,
          pending.signal,
        );
        if (closed || pending.signal.aborted || active !== path) return;
        const expected = files.find(([file]) => file === path)?.[1];
        if (
          data.digest !== entry.digest ||
          data.file !== path ||
          !Number.isSafeInteger(data.bytes) ||
          data.bytes < 0
        )
          throw new Error("File identity does not match this review. Refresh the queue.");
        if (typeof data.text !== "string") {
          status.textContent =
            data.omitted === "too-large"
              ? "File exceeds the 384 KiB reader limit. Download the archive to inspect it."
              : "Binary or non-text file. Download the archive for independent inspection.";
          return;
        }
        if (
          data.text.length > 384 * 1024 ||
          !data.sha256 ||
          !/^[a-f0-9]{64}$/.test(data.sha256) ||
          (typeof expected === "string" && expected !== data.sha256)
        )
          throw new Error("File fingerprint or size does not match this review.");
        while (cache.size >= 6) cache.delete(cache.keys().next().value!);
        cache.set(path, { text: data.text, bytes: data.bytes });
        renderDocument();
      } catch (error) {
        if (closed || pending.signal.aborted) return;
        if (error instanceof RegistryRequestError && [401, 403].includes(error.status)) {
          close();
          options.onAccessLost?.();
          return;
        }
        status.textContent =
          error instanceof Error
            ? error.message
            : "Could not read this file. Retry or download the exact archive.";
      }
    }
    function openFile(path: string, line?: number, endLine?: number) {
      const origin = tree.contains(document.activeElement)
        ? "tree"
        : tabBar.contains(document.activeElement)
          ? "tabs"
          : "other";
      controller?.abort();
      active = path;
      breadcrumbs.textContent = visibleText(path);
      find.value = "";
      mode = "source";
      if (!opened.includes(path)) {
        if (opened.length >= 8) opened.shift();
        opened.push(path);
      }
      renderTabs();
      renderTree();
      if (origin === "tree")
        tree.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus();
      if (origin === "tabs")
        tabBar.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
      void loadFile(path).then(() => {
        if (line !== undefined && active === path && !closed) {
          const index = rows.findIndex((row) => row.number === line);
          if (index >= 0) {
            reveal(index);
            selectedEnd = endLine ?? line;
            renderPage();
          }
        }
      });
    }
    function updateMatches() {
      matches = [];
      matchIndex = -1;
      const query = find.value.toLowerCase();
      if (query)
        for (const [index, row] of rows.entries())
          if (row.text.toLowerCase().includes(query) && matches.length < 1000) matches.push(index);
      matchStatus.textContent = query
        ? `${matches.length}${matches.length === 1000 ? "+" : ""} matching lines`
        : "";
      previousMatch.disabled = nextMatch.disabled = !matches.length;
    }
    function reveal(index: number) {
      page = Math.floor(index / 200);
      selectedStart = selectedEnd = rows[index]?.number ?? 1;
      renderPage();
      code
        .querySelector<HTMLElement>(`[data-index="${index}"]`)
        ?.scrollIntoView({ block: "center" });
      selection.textContent = `Selected line ${selectedStart}`;
    }
    function navigateMatch(direction: number) {
      if (!matches.length) return;
      matchIndex = (matchIndex + direction + matches.length) % matches.length;
      reveal(matches[matchIndex]!);
      matchStatus.textContent = `${matchIndex + 1} of ${matches.length} matching lines`;
    }
    function compose(suggestion: boolean) {
      if (!active || !rows.length) return;
      if (suggestion && mode !== "source") {
        feedback.textContent = "Open Submitted file before suggesting a replacement.";
        return;
      }
      editingIndex = undefined;
      noteTarget = { file: active, line: selectedStart, endLine: selectedEnd };
      notesPanel.hidden = false;
      root.classList.add("studio-has-notes");
      target.textContent = visibleText(`${active} · lines ${selectedStart}–${selectedEnd}`);
      replacementLabel.hidden = !suggestion;
      if (suggestion) {
        const snippet =
          cache
            .get(active)
            ?.text.split("\n")
            .slice(selectedStart - 1, selectedEnd)
            .join("\n") ?? "";
        if (snippet.length > 2000) {
          feedback.textContent =
            "Select a smaller range for a suggestion (up to 2,000 characters).";
          replacementLabel.hidden = true;
          return;
        }
        replacement.value = snippet;
      }
      comment.focus();
    }
    function renderNotes() {
      notesToggle.textContent = `Review notes (${notes.length})`;
      useNotes.disabled = !options.onUseNotes || !notes.length;
      copyNotes.disabled = !notes.length;
      noteList.replaceChildren();
      notes.forEach((note, index) => {
        const card = node("article", undefined, "studio-note-card");
        card.append(
          button(`${note.file}:${note.line}–${note.endLine}`, () => {
            openFile(note.file, note.line, note.endLine);
          }),
          node("p", note.comment),
        );
        if (note.replacement !== undefined) card.append(node("pre", note.replacement));
        card.append(
          button("Edit draft note", () => {
            editingIndex = index;
            noteTarget = { file: note.file, line: note.line, endLine: note.endLine };
            target.textContent = visibleText(`${note.file} · lines ${note.line}–${note.endLine}`);
            comment.value = note.comment;
            replacementLabel.hidden = note.replacement === undefined;
            replacement.value = note.replacement ?? "";
            comment.focus();
          }),
        );
        card.append(
          button("Remove draft note", () => {
            notes.splice(index, 1);
            editingIndex = undefined;
            noteTarget = undefined;
            renderNotes();
            renderPage();
          }),
        );
        noteList.append(card);
      });
    }
    fileSearch.addEventListener("input", renderTree);
    fileSearch.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const path = files.find(([path]) =>
          path.toLowerCase().includes(fileSearch.value.trim().toLowerCase()),
        )?.[0];
        if (path) {
          openFile(path);
          code.focus();
        }
      }
    });
    find.addEventListener("input", updateMatches);
    find.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        navigateMatch(event.shiftKey ? -1 : 1);
      }
    });
    goto.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const line = Number(goto.value);
        const index = rows.findIndex((row) => row.number === line);
        if (Number.isSafeInteger(line) && index >= 0) reveal(index);
        else feedback.textContent = "Enter a line number in the current view.";
      }
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if ((event.ctrlKey || event.metaKey) && ["f", "p"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        (event.key.toLowerCase() === "p" ? fileSearch : find).focus();
      }
      if (event.key === "Tab") {
        const focusable = [
          ...root.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,textarea,[tabindex="0"]',
          ),
        ].filter((value) => value.tabIndex >= 0 && !value.closest("[hidden]"));
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    });
    document.body.append(root);
    renderTree();
    renderNotes();
    const initial =
      files.find(([path]) => path === "tabs-extension.json")?.[0] ??
      files.find(([path]) => /\.(js|ts|json|html)$/.test(path))?.[0] ??
      files[0]?.[0];
    if (initial) openFile(initial);
    else renderPage();
    fileSearch.focus();
  };
}

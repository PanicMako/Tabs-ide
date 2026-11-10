const select = (selector, root = document) => root.querySelector(selector);
const selectAll = (selector, root = document) => [...root.querySelectorAll(selector)];
const workspace = select(".workspace");
const workArea = select(".work-area");
const toolbar = select(".tool-tabs");
const addDialog = select(".tool-dialog");
const quickDialog = select(".quick-dialog");
const form = select(".tool-form");
const nameInput = form.elements.namedItem("name");
const valueInput = form.elements.namedItem("value");

const tools = {
  code: { label: "Code", icon: "</>", kind: "code" },
  agents: { label: "Agents", icon: "", kind: "agents" },
  browser: { label: "Browser", icon: "↗", kind: "browser" },
  git: { label: "Git", icon: "⑂", kind: "git" },
  dock: { label: "Dock", icon: ">_", kind: "terminal" },
};
const examples = {
  field: {
    name: "Field Notes",
    branch: "journal-layout",
    domain: "https://field-notes.example/journal",
    files: {
      "index.html": [
        "<!doctype html>",
        '<html lang="en">',
        "  <head>",
        '    <link rel="stylesheet" href="journal.css">',
        "    <title>Field Notes Journal</title>",
        "  </head>",
        "  <body>",
        '    <main class="journal">',
        "      <h1>Go a little further.</h1>",
        "      <p>Stories from the way out.</p>",
        "    </main>",
        "  </body>",
        "</html>",
      ],
      "journal.css": [
        "/* Earth and paper */",
        ".journal {",
        "  background: #17382f;",
        "  color: #f9e5bd;",
        "  padding: clamp(24px, 6vw, 80px);",
        "}",
      ],
      "README.md": [
        "# Field Notes",
        "An editorial journal for the outdoors.",
        "",
        "Open the Browser tool to preview the latest layout.",
        "Run npm test before publishing a change.",
      ],
    },
  },
  morrow: {
    name: "Morrow",
    branch: "studio-home",
    domain: "https://morrow-studio.example/collection",
    files: {
      "index.html": [
        "<!doctype html>",
        '<html lang="en">',
        "  <head>",
        '    <link rel="stylesheet" href="studio.css">',
        "    <title>Morrow Studio</title>",
        "  </head>",
        "  <body>",
        '    <main class="studio">',
        "      <h1>Good things take light.</h1>",
        "      <p>Objects for the hours in between.</p>",
        "    </main>",
        "  </body>",
        "</html>",
      ],
      "studio.css": [
        "/* Clay and late-afternoon light */",
        ".studio {",
        "  background: #efddbb;",
        "  color: #402b24;",
        "  padding: clamp(24px, 6vw, 80px);",
        "}",
      ],
      "README.md": [
        "# Morrow Studio",
        "A small collection of objects for the home.",
        "",
        "Open the Browser tool to see the collection.",
        "Run npm test before publishing a change.",
      ],
    },
  },
};

const projects = Object.fromEntries(
  Object.entries(examples).map(([id, example]) => [
    id,
    { ...example, active: "browser", file: "index.html", added: new Map(), asked: false },
  ]),
);
let projectId = "field";
let nextTool = 0;
const project = () => projects[projectId];

function textNode(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(text, state) {
  const control = textNode("button", text);
  control.type = "button";
  control.setAttribute("aria-pressed", String(state));
  return control;
}

function announce(message) {
  select(".announcement").textContent = message;
}

function complete(check) {
  const item = select(`[data-check="${check}"]`);
  if (item.hasAttribute("data-done")) return;
  item.dataset.done = "";
  item.setAttribute("aria-label", `${item.textContent}, complete`);
}

function renderToolbar() {
  const current = project();
  toolbar.replaceChildren();
  for (const [id, tool] of [...Object.entries(tools), ...current.added]) {
    const control = button(tool.label, id === current.active);
    control.dataset.tool = id;
    const icon = textNode("span", tool.icon);
    icon.setAttribute("aria-hidden", "true");
    if (id === "agents") icon.append(select('[data-quick-tool="agents"] svg').cloneNode(true));
    control.prepend(icon);
    toolbar.append(control);
  }
}

function renderEditor(pane) {
  const current = project();
  pane.classList.add("editor");
  const files = document.createElement("nav");
  files.setAttribute("aria-label", "Project files");
  const fileList = textNode("div", "", "file-list");
  for (const name of Object.keys(current.files)) {
    const control = button(name, name === current.file);
    control.dataset.file = name;
    fileList.append(control);
  }
  files.append(textNode("h2", current.name), fileList);
  const documentPane = document.createElement("div");
  const fileBar = textNode("div", "", "file-bar");
  fileBar.append(textNode("strong", current.file), textNode("span", current.branch));
  const code = document.createElement("pre");
  for (const line of current.files[current.file]) {
    const className = /^\s*</.test(line) ? "markup" : "";
    code.append(textNode("span", line, className));
  }
  documentPane.append(fileBar, code);
  pane.append(files, documentPane);
}

function renderBrowser(pane, tool) {
  pane.classList.add("browser-pane");
  const bar = textNode("div", "", "address-bar");
  const address = tool.value ?? project().domain;
  bar.append(
    textNode("strong", address, "address"),
    textNode("span", "Sample preview", "preview-label"),
  );
  const example = select(`#${projectId}-preview`);
  pane.append(bar, example.content.cloneNode(true));
}

function renderTerminal(pane, tool) {
  pane.classList.add("terminal");
  const command = tool.value ?? "npm test";
  const bar = textNode("div", "", "file-bar");
  bar.append(textNode("strong", tool.label), textNode("span", "Example output"));
  const output = document.createElement("pre");
  output.append(textNode("strong", `${projectId}@tabs ~ $ ${command}\n\n`));
  const result =
    command === "npm test"
      ? "PASS  layout.test.js\nPASS  navigation.test.js\n\n2 tests passed."
      : "This command is saved to the demo toolbar.";
  output.append(document.createTextNode(`${result}\n\nNo command runs in this browser demo.`));
  pane.append(bar, output);
}

function renderAgents(pane) {
  pane.classList.add("reading-pane");
  pane.append(
    textNode("h2", "Start a conversation"),
    textNode("p", `This example conversation is scoped to ${project().name}.`),
  );
  const prompt = button("Ask what’s in this project", project().asked);
  prompt.dataset.ask = "";
  const controls = textNode("div", "", "example-controls");
  controls.append(prompt);
  pane.append(controls);
  if (project().asked) {
    pane.append(
      textNode(
        "p",
        "Start with index.html to see the page structure, then open Browser to preview it. The project’s README has the next steps.",
        "reply",
      ),
    );
  }
}

function renderGit(pane) {
  pane.classList.add("reading-pane");
  pane.append(textNode("h2", "Working tree"), textNode("p", `Branch: ${project().branch}`));
  const files = document.createElement("ul");
  files.append(
    textNode("li", "Modified · index.html"),
    textNode("li", `Modified · ${Object.keys(project().files)[1]}`),
  );
  pane.append(files);
}

const renderPane = {
  code: renderEditor,
  browser: renderBrowser,
  terminal: renderTerminal,
  agents: renderAgents,
  git: renderGit,
};

function render() {
  const current = project();
  const tool = tools[current.active] ?? current.added.get(current.active);
  for (const control of selectAll("[data-project]")) {
    control.setAttribute("aria-pressed", String(control.dataset.project === projectId));
  }
  renderToolbar();
  const pane = textNode("section", "", "pane");
  pane.setAttribute("aria-label", tool.label);
  renderPane[tool.kind](pane, tool);
  workArea.replaceChildren(pane);
  select("[data-project-status]").textContent = `${current.name} · ${tool.label}`;
}

function openTool(id, focus = true) {
  project().active = id;
  render();
  if (focus) select(`[data-tool="${id}"]`).focus();
}

function toggleExpand() {
  const expanded = workspace.classList.toggle("is-expanded");
  document.body.classList.toggle("expanded", expanded);
  select("[data-expand]").setAttribute("aria-pressed", String(expanded));
  select("[data-expand-label]").textContent = expanded ? "Exit expanded view" : "Expand workspace";
  for (const section of selectAll(".masthead, .intro, .guide")) section.inert = expanded;
  select("[data-expand]").focus({ preventScroll: true });
  announce(expanded ? "Workspace expanded. Press Escape to exit." : "Workspace restored.");
}

function updateForm() {
  const browser = form.elements.kind.value === "browser";
  select("[data-input-label]").textContent = browser ? "Website URL" : "Terminal command";
  select("[data-save]").textContent = browser ? "Save browser tab" : "Save terminal tab";
  select("[data-tool-note]").textContent = browser
    ? "The URL appears in the toolbar preview. The demo shows a local sample site."
    : "Tabs can run this command when you open the tab. This demo shows sample output.";
  valueInput.type = browser ? "url" : "text";
  valueInput.placeholder = browser ? "https://example.com" : "npm test";
  valueInput.setCustomValidity("");
}

function openAddTool() {
  form.reset();
  nameInput.setCustomValidity("");
  updateForm();
  select("[data-tool-project]").textContent = project().name;
  addDialog.showModal();
  nameInput.focus();
}

function useExample() {
  const browser = form.elements.kind.value === "browser";
  nameInput.value = browser
    ? projectId === "field"
      ? "Journal preview"
      : "Studio preview"
    : "Run tests";
  valueInput.value = browser ? project().domain : "npm test";
  nameInput.setCustomValidity("");
  valueInput.setCustomValidity("");
  select("[data-save]").focus();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const kind = form.elements.kind.value;
  const label = nameInput.value.trim();
  const value = valueInput.value.trim();
  const alreadyUsed = [...Object.values(tools), ...project().added.values()].some(
    (tool) => tool.label.toLowerCase() === label.toLowerCase(),
  );
  nameInput.setCustomValidity(
    !label ? "Enter a name for your tab." : alreadyUsed ? "Choose a different tab name." : "",
  );
  valueInput.setCustomValidity(
    kind === "browser" && !/^https?:\/\//i.test(value)
      ? "Enter a URL that starts with https:// or http://."
      : !value
        ? "Enter a terminal command."
        : "",
  );
  if (!form.reportValidity()) return;
  const id = `saved-${++nextTool}`;
  project().added.set(id, { label, value, kind, icon: kind === "browser" ? "↗" : ">_" });
  addDialog.close();
  openTool(id);
  complete(kind);
  announce(`${label} saved to ${project().name}.`);
});

form.addEventListener("input", (event) => {
  if (event.target.name === "kind") {
    valueInput.value = "";
    updateForm();
  } else {
    event.target.setCustomValidity("");
  }
});
select("[data-example]").addEventListener("click", useExample);
select("[data-add]").addEventListener("click", openAddTool);
select("[data-expand]").addEventListener("click", toggleExpand);

function toggleQuickActions() {
  if (quickDialog.open) {
    quickDialog.close();
  } else if (!addDialog.open) {
    quickDialog.showModal();
    select('[data-quick-tool="code"]').focus();
    complete("quick");
    announce("Quick Actions open.");
  }
}

select("[data-quick]").addEventListener("click", toggleQuickActions);

document.addEventListener("keydown", (event) => {
  if (
    event.altKey &&
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.isComposing &&
    event.code === "KeyK"
  ) {
    event.preventDefault();
    if (!event.repeat) toggleQuickActions();
  }
  if (
    event.key === "Escape" &&
    !quickDialog.open &&
    !addDialog.open &&
    workspace.classList.contains("is-expanded")
  ) {
    toggleExpand();
  }
});

document.addEventListener("click", (event) => {
  const control = event.target.closest("button");
  if (!control) return;
  const { project: targetProject, tool, file, quickTool } = control.dataset;
  if (targetProject && projectId !== targetProject) {
    projectId = targetProject;
    render();
    complete("switch");
    announce(`Switched to ${project().name}.`);
  }
  if (tool) openTool(tool);
  if (file) {
    project().file = file;
    render();
    selectAll("[data-file]")
      .find((entry) => entry.dataset.file === file)
      .focus();
  }
  if (control.hasAttribute("data-ask")) {
    project().asked = true;
    render();
    select("[data-ask]").focus();
    announce("The example agent replied.");
  }
  if (control.hasAttribute("data-close")) control.closest("dialog").close();
  if (quickTool) {
    quickDialog.close();
    if (quickTool.startsWith("scratch-") && !project().added.has(quickTool)) {
      const kind = quickTool === "scratch-browser" ? "browser" : "terminal";
      project().added.set(quickTool, {
        label: kind === "browser" ? "Temporary browser" : "Temporary terminal",
        kind,
        icon: kind === "browser" ? "↗" : ">_",
      });
    }
    openTool(quickTool);
    announce(`Opened ${select("[data-project-status]").textContent}.`);
  }
});

render();

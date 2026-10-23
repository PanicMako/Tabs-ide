(() => {
  try {
    if (!localStorage.getItem("relay-studio-v3"))
      localStorage.setItem("relay-studio-v3", JSON.stringify({
        version: 3,
        projects: ["My project"],
        projectDetails: { "My project": { description: "A place to pick up where you left off.", color: "#3259ed" } },
        folders: [],
        cards: []
      }));
  } catch {}
  const relayRules = new Map;
  const relaySheet = document.querySelector("#relay-runtime-styles").sheet;
  const relayDecode = document.createElement("textarea");
  function relayMarkup(markup) {
    return markup.replace(/\sstyle="([^"]*)"/g, (_, encoded) => {
      relayDecode.innerHTML = encoded;
      const declaration = relayDecode.value;
      let name = relayRules.get(declaration);
      if (!name) {
        name = "relay-style-" + relayRules.size;
        relaySheet.insertRule('[data-relay-style="' + name + '"]{' + declaration + "}", relaySheet.cssRules.length);
        relayRules.set(declaration, name);
      }
      return ' data-relay-style="' + name + '"';
    });
  }
  function subtreeIds(state, rootId) {
    const root = state.folders.find((folder) => folder.id === rootId);
    if (!root)
      throw new Error("This folder no longer exists.");
    const ids = new Set([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of state.folders) {
        if (folder.project === root.project && ids.has(folder.parent) && !ids.has(folder.id)) {
          ids.add(folder.id);
          changed = true;
        }
      }
    }
    return ids;
  }
  function trashFolder(state, rootId, makeId = () => crypto.randomUUID(), now = Date.now()) {
    const ids = subtreeIds(state, rootId);
    const folder = state.folders.find((folder) => folder.id === rootId);
    const entry = {
      id: makeId(),
      deletedAt: now,
      project: folder.project,
      rootId,
      folders: structuredClone(state.folders.filter((item) => item.project === folder.project && ids.has(item.id))),
      cards: structuredClone(state.cards.filter((note) => note.project === folder.project && ids.has(note.folder)))
    };
    state.trash ||= [];
    state.trash.unshift(entry);
    state.folders = state.folders.filter((item) => !entry.folders.some((removed) => removed.id === item.id));
    state.cards = state.cards.filter((note) => !entry.cards.some((removed) => removed.id === note.id));
    if (state.folderUndo && (ids.has(state.folderUndo.folder.id) || ids.has(state.folderUndo.folder.parent) || state.folderUndo.children.some((id) => ids.has(id))))
      delete state.folderUndo;
    return entry;
  }
  function restoreFolder(state, entryId, makeId = () => crypto.randomUUID()) {
    const entry = state.trash?.find((item) => item.id === entryId);
    if (!entry)
      throw new Error("This item is no longer in Trash.");
    const project = state.projects.includes(entry.project) ? entry.project : state.projects[0];
    if (!project)
      throw new Error("Create a project before restoring this folder.");
    const folderIds = new Set(state.folders.map((item) => item.id));
    const mapping = new Map(entry.folders.map((item) => [item.id, folderIds.has(item.id) ? makeId() : item.id]));
    const folders = structuredClone(entry.folders);
    for (const folder of folders) {
      const originalId = folder.id;
      folder.project = project;
      folder.id = mapping.get(originalId);
      folder.parent = mapping.get(folder.parent) || (state.folders.some((item) => item.id === folder.parent && item.project === project) ? folder.parent : "");
      if (originalId === entry.rootId) {
        const base = folder.name;
        let index = 1;
        while (state.folders.some((item) => item.project === project && item.parent === folder.parent && item.name.toLowerCase() === folder.name.toLowerCase()))
          folder.name = `${base} (restored${index++ === 1 ? "" : " " + (index - 1)})`;
      }
    }
    const noteIds = new Set(state.cards.map((item) => item.id));
    const cards = structuredClone(entry.cards);
    for (const note of cards) {
      if (noteIds.has(note.id))
        note.id = makeId();
      note.project = project;
      note.folder = mapping.get(note.folder) || "";
      if (!state.columns.some((column) => column.id === note.status))
        note.status = state.columns[0].id;
      if (!state.templates.some((template) => template.id === note.template))
        note.template = state.templates[0].id;
    }
    state.folders.push(...folders);
    state.cards.push(...cards);
    state.trash = state.trash.filter((item) => item.id !== entryId);
    return { project, folder: mapping.get(entry.rootId), notes: cards.length };
  }
  function validProjectLogo(value) {
    return typeof value === "string" && value.length <= 350000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value);
  }
  const R = {};
  R.e = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  R.paths = {
    plus: "M12 5v14M5 12h14",
    arrow: "M5 12h14m-5-5 5 5-5 5",
    chevron: "m9 5 7 7-7 7",
    down: "m6 9 6 6 6-6",
    folder: "M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    grid: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
    search: "M21 21l-5-5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0",
    clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    bookmark: "M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4z",
    branch: "M6 7v10m0-4c0-5 12 1 12-6M8 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0m0 14a2 2 0 1 1-4 0 2 2 0 0 1 4 0M20 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
    file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 0v6h6M8 14h8m-8 3h5",
    check: "m5 12 4 4L19 6",
    close: "m6 6 12 12M6 18 18 6",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    archive: "M4 9v11h16V9M3 3h18v6H3zm6 10h6",
    edit: "m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z",
    export: "M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5",
    link: "m10 13 4-4m-5 8-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2-2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
    info: "M12 11v6m0-10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    play: "m8 4 12 8-12 8z",
    lines: "M4 6h16M4 12h16M4 18h10",
    back: "M19 12H5m5-5-5 5 5 5",
    moon: "M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10",
    copy: "M8 8h13v13H8zM4 16H2V2h14v2",
    pin: "M8 3h8l-1 7 4 4H5l4-4zm4 11v8",
    settings: "M9.5 3h5l.6 2.4 2.1 1.2 2.4-.7 2.5 4.2-1.8 1.7v2.4l1.8 1.7-2.5 4.2-2.4-.7-2.1 1.2-.6 2.4h-5l-.6-2.4-2.1-1.2-2.4.7-2.5-4.2 1.8-1.7v-2.4L1.9 10l2.5-4.2 2.4.7 2.1-1.2zM15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0",
    restore: "M3 4v6h6M3 10a9 9 0 1 1 2 9"
  };
  R.icon = (name) => `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="${R.paths[name] || R.paths.file}"/></svg>`;
  R.seed = () => ({ version: 2, projects: ["Tabs", "Personal site", "Side experiments"], folders: [{ id: "f-interface", project: "Tabs", name: "Interface" }, { id: "f-bugs", project: "Tabs", name: "Bug investigations" }, { id: "f-notes", project: "Tabs", name: "Product thinking" }, { id: "f-site", project: "Personal site", name: "Redesign" }, { id: "f-lab", project: "Side experiments", name: "Little experiments" }], cards: [
    { id: "tabs-1", project: "Tabs", folder: "f-interface", type: "Feature", status: "in-progress", title: "A place to pick up where you left off", tried: "Sketched the project home. A single latest handoff gives the page a clear purpose. Tried a grid of equally weighted cards, but it buried the next step.", next: "Build the empty state for a project’s first handoff. Start with one sentence and a clear invitation to write.", blocked: "", branch: "feature/project-handoffs", files: ["src/views/ProjectHome.tsx:48", "src/components/HandoffCard.tsx"], links: "", saved: true, created: Date.now() - 720000, updated: Date.now() - 720000, history: [] },
    { id: "tabs-3", project: "Tabs", folder: "f-bugs", type: "Bug", status: "blocked", title: "Sidebar width resets after reopening", tried: "The saved width is correct in storage. The initial render writes the default before the saved value loads. Adding a timeout only hides the race.", next: "Read the persisted width before applying the default. Trace the first render with a slow storage response.", blocked: "Need a reliable reproduction with a delayed storage read.", branch: "fix/sidebar-persistence", files: ["src/layout/Sidebar.tsx:71"], links: "", saved: false, created: Date.now() - 3700000, updated: Date.now() - 3700000, history: [] },
    { id: "site-1", project: "Personal site", folder: "f-site", type: "Bug", status: "ready", title: "Mobile menu stays open on anchor links", tried: "Closing the menu on route change works between pages. Same-page anchor links never trigger that handler.", next: "Close on anchor selection and return keyboard focus to the menu toggle.", blocked: "", branch: "fix/mobile-navigation", files: ["src/components/Nav.tsx:86"], links: "", saved: false, created: Date.now() - 7400000, updated: Date.now() - 7400000, history: [] },
    { id: "tabs-2", project: "Tabs", folder: "f-interface", type: "Feature", status: "ready", title: "Make the command palette feel quieter", tried: "Grouped commands by intent rather than alphabetically. Recent actions should stay at the top until a search is entered.", next: "Add the recent-actions group, then use real commands to check the hierarchy.", blocked: "", branch: "feature/command-palette", files: ["src/components/CommandPalette.tsx:32"], links: "", saved: true, created: Date.now() - 90000000, updated: Date.now() - 90000000, history: [] },
    { id: "lab-1", project: "Side experiments", folder: "f-lab", type: "Exploration", status: "ready", title: "Bookmarks, but more like a little shelf", tried: "A loose grid feels more personal than a table. Long titles need room; screenshots should be optional.", next: "Try three card sizes with real, messy bookmark titles before settling on a layout.", blocked: "", branch: "explore/bookmark-shelf", files: ["sketches/shelf.html"], links: "", saved: false, created: Date.now() - 1e8, updated: Date.now() - 1e8, history: [] },
    { id: "tabs-4", project: "Tabs", folder: "f-notes", type: "Exploration", status: "ready", title: "When is a reminder actually helpful?", tried: "A prompt on every close feels intrusive. An explicit end-session command may be easier to trust. Leaving this as an open product question.", next: "Compare a manual “leave a handoff” command with an optional reminder before a project switch.", blocked: "", branch: "explore/save-reminders", files: ["notes/reminders.md"], links: "", saved: false, created: Date.now() - 180000000, updated: Date.now() - 180000000, history: [] },
    { id: "site-2", project: "Personal site", folder: "f-site", type: "Feature", status: "done", title: "Give the small side projects a home", tried: "Added a compact “on the side” section underneath selected work. A sentence and a screenshot are enough.", next: "Revisit when the next small project is ready to share.", blocked: "", branch: "feature/side-projects", files: ["src/pages/index.astro"], links: "", saved: false, created: Date.now() - 230000000, updated: Date.now() - 230000000, history: [] }
  ] });
  R.valid = (value) => value && Array.isArray(value.projects) && value.projects.length > 0 && value.projects.every((p) => typeof p === "string" && p.trim()) && Array.isArray(value.cards) && value.cards.every((c) => c && typeof c.id === "string" && typeof c.title === "string" && typeof c.project === "string" && value.projects.includes(c.project) && typeof c.next === "string" && Array.isArray(c.files) && c.files.every((f) => typeof f === "string") && Number.isFinite(c.created)) && (!value.folders || Array.isArray(value.folders) && value.folders.every((f) => f && typeof f.id === "string" && typeof f.name === "string" && value.projects.includes(f.project)));
  R.normalize = (data) => {
    data.version = 2;
    data.folders ||= [];
    data.cards.forEach((c) => {
      c.updated ||= c.created;
      c.type = ["Bug", "Feature", "Exploration"].includes(c.type) ? c.type : "Feature";
      c.status = ["ready", "in-progress", "blocked", "done"].includes(c.status) ? c.status : c.blocked ? "blocked" : "ready";
      c.history = Array.isArray(c.history) ? c.history.filter((h) => h && Number.isFinite(h.at) && typeof h.next === "string" && typeof h.tried === "string") : [];
      c.links = typeof c.links === "string" ? c.links : "";
      c.tried = typeof c.tried === "string" ? c.tried : "";
      c.blocked = typeof c.blocked === "string" ? c.blocked : "";
      c.branch = typeof c.branch === "string" ? c.branch : "";
      c.folder = data.folders.some((f) => f.id === c.folder && f.project === c.project) ? c.folder : "";
    });
    return data;
  };
  R.read = (key, fallback = null) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const retained = R.read("relay-prototype-v2") || R.read("relay-prototype-v1");
  R.data = R.normalize(R.valid(retained) ? retained : R.seed());
  R.mode = Math.min(5, Math.max(1, Number(new URLSearchParams(location.search).get("v") || R.read("relay-selected-prototype", 1)) || 1));
  if (!Number.isInteger(R.mode))
    R.mode = 1;
  R.ui = { scope: "all", project: "", folder: "", query: "", type: "all", selected: "", focusStarted: false };
  R.statuses = { ready: "Ready to resume", "in-progress": "In progress", blocked: "Blocked", done: "Done" };
  R.modes = [{ name: "Desk", description: "A calm home for unfinished work." }, { name: "Index", description: "Folders. Fast retrieval. Full context." }, { name: "Board", description: "See what’s moving, and what’s stuck." }, { name: "Journal", description: "Follow the reasoning, day by day." }, { name: "Focus", description: "One thread. One clear next step." }];
  R.storage = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      R.toast?.("Storage is unavailable. Changes are kept for this session only.");
      return false;
    }
  };
  R.save = () => R.storage("relay-prototype-v2", R.data);
  R.age = (t) => {
    const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
    return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
  };
  R.date = (t, options = { day: "numeric", month: "long" }) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", ...options }).format(t);
  R.all = () => [...R.data.cards].sort((a, b) => b.updated - a.updated);
  R.cards = () => R.all().filter((c) => (R.ui.scope === "archive" ? c.archived : !c.archived) && (R.ui.scope !== "saved" || c.saved) && (!R.ui.project || c.project === R.ui.project) && (!R.ui.folder || c.folder === R.ui.folder) && (R.ui.type === "all" || c.type === R.ui.type) && (!R.ui.query || [c.title, c.tried, c.next, c.blocked, c.branch, c.project, c.links, ...c.files, R.data.folders.find((f) => f.id === c.folder)?.name || ""].join(" ").toLowerCase().includes(R.ui.query.toLowerCase())));
  R.current = () => R.cards().find((c) => c.id === R.ui.selected) || R.cards()[0];
  R.card = (id) => R.data.cards.find((c) => c.id === id);
  R.scopeTitle = () => R.data.folders.find((f) => f.id === R.ui.folder)?.name || R.ui.project || { all: "All threads", saved: "Bookmarked", archive: "Archive" }[R.ui.scope];
  R.snapshot = (c, reason = "Updated handoff") => {
    c.history.unshift({ at: c.updated, title: c.title, tried: c.tried, next: c.next, blocked: c.blocked, status: c.status, reason });
  };
  R.mutate = (id, values, reason) => {
    const c = R.card(id);
    if (!c)
      return;
    R.snapshot(c, reason);
    Object.assign(c, values, { updated: Date.now() });
    R.save();
    R.render();
  };
  R.download = (text, name, type = "text/plain") => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  R.markdown = (c) => `# ${c.title}

Project: ${c.project}
Branch: ${c.branch || "—"}
Status: ${R.statuses[c.status]}

## Last thing tried
${c.tried || "—"}

## Next step
${c.next}

## Blocked by
${c.blocked || "Nothing recorded"}

## Files
${c.files.map((f) => "- " + f).join(`
`) || "—"}

## Links
${c.links || "—"}

## Earlier checkpoints
${c.history.map((h) => `### ${R.date(h.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
${h.tried}

Next: ${h.next}`).join(`

`) || "No earlier checkpoints."}
`;
  R.modes = [];
  const studioSeed = () => ({ version: 3, projects: ["Tabs", "Personal site", "Small experiments"], projectDetails: { Tabs: { description: "The little things that make a workspace feel right.", color: "#bdd6a6" }, "Personal site": { description: "An evolving corner of the internet.", color: "#deb597" }, "Small experiments": { description: "No big plans. Just following a few interesting thoughts.", color: "#bcb1d5" } }, folders: [{ id: "f-interface", project: "Tabs", name: "The little details", description: "Interactions worth getting right.", parent: "", view: "list", template: "return" }, { id: "f-keyboard", project: "Tabs", name: "Keyboard moments", description: "A little less reaching for the mouse.", parent: "f-interface", view: "list", template: "return" }, { id: "f-notes", project: "Tabs", name: "From the notebook", description: "Half-formed thoughts are welcome here.", parent: "", view: "gallery", template: "blank" }, { id: "f-later", project: "Tabs", name: "Worth coming back to", description: "Not now doesn’t mean never.", parent: "", view: "board", template: "return" }, { id: "f-site", project: "Personal site", name: "The next chapter", description: "Making room for the next version.", parent: "", view: "gallery", template: "blank" }, { id: "f-small", project: "Small experiments", name: "Small beginnings", description: "Something to play with.", parent: "", view: "gallery", template: "blank" }], cards: [
    { id: "s1", project: "Tabs", folder: "f-interface", title: "A softer landing when you come back", body: `I keep coming back to this: opening a project should feel like picking up a conversation.

Not a dashboard of everything I haven’t finished. Just enough to remember what I was thinking.

A single note, close to the code, might be all it takes.`, tried: "Tried giving every note the same weight. It was harder to see where to start.", next: "Make the latest note feel like an invitation. Put the very next step within reach.", blocked: "", branch: "explore/a-place-to-return", files: ["src/views/ProjectHome.tsx:48"], links: "", saved: true, status: "in-progress", template: "return", values: {}, tags: ["a small detail"], attachments: [], created: Date.now() - 840000, updated: Date.now() - 840000, history: [] },
    { id: "s2", project: "Tabs", folder: "f-notes", title: "Less setup. More getting somewhere.", body: `What if the first thing you see is a blank page, not a choice of templates?

The structure can arrive later. I want someone to be able to write a messy thought, close the laptop, and feel like that was enough.`, tried: "", next: "", blocked: "", branch: "", files: [], links: "", saved: true, status: "ready", template: "blank", values: {}, tags: ["an open question"], attachments: [], created: Date.now() - 4900000, updated: Date.now() - 4900000, history: [] },
    { id: "s3", project: "Tabs", folder: "f-keyboard", title: "That little pause in the command menu", body: `The recent actions are useful, but there’s a beat of hesitation before I find the one I need.

I think it’s the spacing. The groups look like separate lists instead of one conversation.`, tried: "Grouped by intent rather than alphabetically. Better, but the section labels are still doing too much.", next: "Try dropping one label and giving recent actions a little more breathing room.", blocked: "", branch: "explore/a-quieter-menu", files: ["src/components/CommandPalette.tsx:32"], links: "", saved: false, status: "in-progress", template: "return", values: {}, tags: ["feel & flow"], attachments: [], created: Date.now() - 12000000, updated: Date.now() - 12000000, history: [] },
    { id: "s4", project: "Tabs", folder: "f-later", title: "A reminder that knows when to be quiet", body: `I don’t want a notification every time I switch away. Sometimes I’m only gone for a second.

Maybe the useful question is: did I leave myself a place to start? If the answer is yes, there’s nothing else to say.`, tried: "A prompt on every close felt like being asked to fill in a timesheet.", next: "Come back to this after the basic note flow feels natural.", blocked: "Waiting to see how people use the simple version.", branch: "", files: [], links: "", saved: false, status: "blocked", template: "return", values: {}, tags: [], attachments: [], created: Date.now() - 90000000, updated: Date.now() - 90000000, history: [] },
    { id: "s5", project: "Tabs", folder: "f-interface", title: "The sidebar should feel like a bookshelf", body: `A few well-named places. Nothing shouting for attention.

Folders should be something you grow into, not something you have to design before writing your first note.`, tried: "", next: "", blocked: "", branch: "", files: [], links: "", saved: false, status: "ready", template: "blank", values: {}, tags: ["a feeling"], attachments: [], created: Date.now() - 170000000, updated: Date.now() - 170000000, history: [] },
    { id: "s6", project: "Personal site", folder: "f-site", title: "Make room for the things I make on weekends", body: "Not everything needs a case study. Some things just need a little picture, a sentence, and somewhere to live.", tried: "", next: "Collect three small projects. Let the work decide the layout.", blocked: "", branch: "weekend-corner", files: ["src/pages/index.astro"], links: "", saved: false, status: "ready", template: "return", values: {}, tags: [], attachments: [], created: Date.now() - 190000000, updated: Date.now() - 190000000, history: [] },
    { id: "s7", project: "Small experiments", folder: "f-small", title: "A shelf for all those saved links", body: `Something between a pile of bookmarks and a little personal library.

I want to remember why I saved something, not just that I saved it.`, tried: "", next: "Start with ten actual links. See what they have in common.", blocked: "", branch: "", files: [], links: "", saved: false, status: "ready", template: "return", values: {}, tags: ["a someday thing"], attachments: [], created: Date.now() - 230000000, updated: Date.now() - 230000000, history: [] }
  ] });
  const latestStudio = R.read("relay-studio-v3");
  const earlier = R.read("relay-prototype-v2") || R.read("relay-prototype-v1");
  const originalExampleIds = new Set(["tabs-1", "tabs-2", "tabs-3", "tabs-4", "site-1", "site-2", "labs-1", "lab-1"]);
  R.data = latestStudio && R.valid(latestStudio) ? latestStudio : studioSeed();
  if (!latestStudio && earlier && R.valid(earlier)) {
    const written = earlier.cards.filter((c) => !originalExampleIds.has(c.id));
    if (written.length) {
      earlier.projects.forEach((p) => {
        if (!R.data.projects.includes(p))
          R.data.projects.push(p);
      });
      R.data.folders.push(...(earlier.folders || []).filter((f) => !R.data.folders.some((x) => x.id === f.id)));
      R.data.cards.push(...written.map((c) => ({ ...c, template: "return" })));
    }
  }
  R.data.columns ||= [{ id: "ready", name: "To come back to", color: "#bcb4d6" }, { id: "in-progress", name: "Taking shape", color: "#bbd49b" }, { id: "blocked", name: "A little pause", color: "#d6b294" }, { id: "done", name: "Tucked away", color: "#9ab9b2" }];
  R.data.templates ||= [{ id: "blank", name: "Just a thought", description: "A blank page. Nothing to fill in.", fields: [] }, { id: "return", name: "Pick up later", description: "A few gentle breadcrumbs for your next visit.", fields: [{ id: "tried", label: "Where I got to", type: "long" }, { id: "next", label: "A place to start next time", type: "long" }, { id: "blocked", label: "Something still on my mind", type: "short" }] }, { id: "question", name: "Working something out", description: "A little room to explore.", fields: [{ id: "wonder", label: "What I’m wondering", type: "long" }, { id: "noticed", label: "What I’ve noticed", type: "long" }, { id: "try", label: "Something to try", type: "long" }] }];
  R.data.prefs ||= { template: "blank", previews: true, density: "comfortable", accent: "", includeNested: true };
  R.data.projectDetails ||= {};
  R.data.cards.forEach((c) => {
    c.body ||= "";
    c.template ||= "blank";
    c.values ||= {};
    c.tags ||= [];
    c.attachments ||= [];
    c.history ||= [];
    c.updated ||= c.created;
    c.files ||= [];
    c.links ||= "";
  });
  R.data.folders.forEach((f) => {
    f.parent ||= "";
    f.description ||= "";
    f.view ||= "";
    f.template ||= "";
  });
  R.data.projects.forEach((p) => {
    R.data.projectDetails[p] ||= { description: "A place for whatever you’re making.", color: ["#bcd3a7", "#d2b194", "#bdb0d1"][R.data.projects.indexOf(p) % 3] };
  });
  R.ui = { scope: "all", project: R.data.projects[0], folder: "", query: "", type: "all", selected: "", focusStarted: false, view: "", includeNested: R.data.prefs.includeNested !== false, collapsed: new Set, sideOpen: false };
  R.mode = 1;
  R.refreshStatuses = () => {
    R.statuses = Object.fromEntries(R.data.columns.map((c) => [c.id, c.name]));
  };
  R.refreshStatuses();
  R.save = () => {
    R.data.version = 3;
    return R.storage("relay-studio-v3", R.data);
  };
  R.folder = (id) => R.data.folders.find((f) => f.id === id);
  R.descendants = (id) => {
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      R.data.folders.forEach((f) => {
        if (f.parent && ids.has(f.parent) && !ids.has(f.id)) {
          ids.add(f.id);
          changed = true;
        }
      });
    }
    return ids;
  };
  R.trail = (id) => {
    const result = [], seen = new Set;
    let f = R.folder(id);
    while (f && !seen.has(f.id)) {
      result.unshift(f);
      seen.add(f.id);
      f = R.folder(f.parent);
    }
    return result;
  };
  R.folderLabel = (id) => R.trail(id).map((f) => f.name).join(" / ");
  R.value = (c, key) => Object.prototype.hasOwnProperty.call(c.values || {}, key) ? c.values[key] : ["tried", "next", "blocked"].includes(key) ? c[key] || "" : "";
  R.template = (id) => R.data.templates.find((t) => t.id === id) || R.data.templates[0];
  R.next = (c) => c.next || c.values?.try || c.values?.next || "";
  R.cards = () => {
    const ids = R.ui.folder && R.ui.includeNested ? R.descendants(R.ui.folder) : null;
    return R.all().filter((c) => (R.ui.scope === "archive" ? c.archived : !c.archived) && (R.ui.scope !== "saved" || c.saved) && (!R.ui.project || c.project === R.ui.project) && (!R.ui.folder || (ids ? ids.has(c.folder) : c.folder === R.ui.folder)) && (!R.ui.query || [c.title, c.body, c.tried, c.next, c.blocked, c.branch, c.project, c.links, ...c.files, ...c.tags || [], ...Object.values(c.values || {}), R.folderLabel(c.folder)].join(" ").toLowerCase().includes(R.ui.query.toLowerCase())));
  };
  R.childFolders = () => R.data.folders.filter((f) => f.project === R.ui.project && f.parent === (R.ui.folder || ""));
  R.scopeTitle = () => R.ui.scope === "saved" ? "Pinned" : R.ui.scope === "archive" ? "Archive" : R.folder(R.ui.folder)?.name || R.ui.project;
  R.current = () => R.cards().find((c) => c.id === R.ui.selected) || R.cards()[0];
  R.view = () => R.ui.view || R.folder(R.ui.folder)?.view || "list";
  R.snapshot = (c, reason = "A new checkpoint") => {
    c.history.unshift({ at: c.updated, title: c.title, body: c.body || "", tried: c.tried || "", next: c.next || "", blocked: c.blocked || "", status: c.status, values: structuredClone(c.values || {}), reason });
  };
  R.markdown = (c) => `# ${c.title}

${c.body || ""}

Project: ${c.project}
Folder: ${R.folderLabel(c.folder) || "Unfiled"}
Stage: ${R.statuses[c.status] || "—"}

${R.template(c.template).fields.map((f) => `## ${f.label}
${R.value(c, f.id) || "—"}`).join(`

`)}

## Code context
Branch: ${c.branch || "—"}
${c.files.map((f) => "- " + f).join(`
`)}
${c.links || ""}

## Earlier thoughts
${c.history.map((h) => `### ${R.date(h.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
${h.body || h.tried || ""}

${h.next || ""}`).join(`

`) || "—"}
`;
  R.fileDatabase = null;
  R.openFiles = () => new Promise((resolve) => {
    try {
      const request = indexedDB.open("relay-studio-attachments", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files", { keyPath: "id" });
      request.onsuccess = () => {
        R.fileDatabase = request.result;
        resolve();
      };
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  R.putFile = (file) => new Promise((resolve, reject) => {
    if (!R.fileDatabase) {
      reject(Error("Storage unavailable"));
      return;
    }
    const tx = R.fileDatabase.transaction("files", "readwrite");
    tx.objectStore("files").put(file);
    tx.oncomplete = () => resolve(file);
    tx.onerror = () => reject(tx.error);
  });
  R.getFile = (id) => new Promise((resolve) => {
    if (!R.fileDatabase) {
      resolve(null);
      return;
    }
    const tx = R.fileDatabase.transaction("files", "readonly"), req = tx.objectStore("files").get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  R.filesReady = R.openFiles();
  R.extraAnswers = (c) => {
    const active = new Set(R.template(c.template).fields.map((f) => f.id)), values = {};
    ["tried", "next", "blocked"].forEach((k) => {
      if (c[k])
        values[k] = c[k];
    });
    Object.assign(values, c.values || {});
    return Object.entries(values).filter(([k, v]) => !active.has(k) && v !== "" && v !== false && v !== null).map(([key, value]) => ({ key, value, label: R.data.templates.flatMap((t) => t.fields).find((f) => f.id === key)?.label || R.data.retiredFields?.[key]?.label || { tried: "Where I got to", next: "A place to start next time", blocked: "Something still on my mind" }[key] || "An earlier answer" }));
  };
  R.markdown = (c) => `# ${c.title}

${c.body || ""}

Project: ${c.project}
Folder: ${R.folderLabel(c.folder) || "Unfiled"}
Stage: ${R.statuses[c.status] || "—"}

${R.template(c.template).fields.map((f) => `## ${f.label}
${R.value(c, f.id) || "—"}`).join(`

`)}

${R.extraAnswers(c).map((a) => `## ${a.label} (kept from an earlier layout)
${a.value === true ? "Yes" : a.value}`).join(`

`)}

## Code context
Branch: ${c.branch || "—"}
${c.files.map((f) => "- " + f).join(`
`)}
${c.links || ""}

## Earlier thoughts
${c.history.map((h) => `### ${R.date(h.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
${h.body || h.tried || ""}

${h.next || ""}
${Object.values(h.values || {}).filter((v) => v !== "" && v !== false).join(`
`)}`).join(`

`) || "—"}
`;
  R.prose = (text) => {
    const inline = (raw) => {
      const tokens = [];
      let value = R.e(raw).replace(/\x60([^\x60]+)\x60/g, (_, code) => "RELAY_CODE_" + (tokens.push("<code>" + code + "</code>") - 1) + "_END");
      value = value.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
      return value.replace(/RELAY_CODE_(\d+)_END/g, (match, index) => tokens[Number(index)] || match);
    };
    const output = [], paragraph = [];
    let code = null, inList = false;
    const flush = () => {
      if (paragraph.length) {
        output.push("<p>" + paragraph.map(inline).join("<br>") + "</p>");
        paragraph.length = 0;
      }
      if (inList) {
        output.push("</ul>");
        inList = false;
      }
    };
    for (const line of String(text || "").split(`
`)) {
      if (line.trim().startsWith(String.fromCharCode(96).repeat(3))) {
        if (code) {
          output.push("<pre><code>" + R.e(code.join(`
`)) + "</code></pre>");
          code = null;
        } else {
          flush();
          code = [];
        }
        continue;
      }
      if (code) {
        code.push(line);
        continue;
      }
      if (!line.trim()) {
        flush();
        continue;
      }
      const heading = line.match(/^#{1,3}\s+(.+)/);
      if (heading) {
        flush();
        output.push("<h3>" + inline(heading[1]) + "</h3>");
        continue;
      }
      const bullet = line.match(/^\s*[-*]\s+(.+)/);
      if (bullet) {
        if (paragraph.length)
          flush();
        if (!inList) {
          output.push("<ul>");
          inList = true;
        }
        output.push("<li>" + inline(bullet[1]) + "</li>");
        continue;
      }
      if (inList) {
        output.push("</ul>");
        inList = false;
      }
      paragraph.push(line);
    }
    flush();
    if (code)
      output.push("<pre><code>" + R.e(code.join(`
`)) + "</code></pre>");
    return output.join("");
  };
  R.modes = [
    { name: "Tabs Blue", description: "Bricolage Grotesque + DM Sans. Bold, bright, and at home with Tabs." },
    { name: "Graphite", description: "Unbounded + IBM Plex Sans. Geometric, electric, and confident." },
    { name: "Apricot", description: "Fraunces + Figtree. An expressive serif with an easygoing rhythm." },
    { name: "Lilac", description: "Syne + Manrope. Wide, expressive type with a softer side." },
    { name: "After Hours", description: "Archivo Black + IBM Plex Sans. Solid type for a space after dark." }
  ];
  R.appearanceColors = [["#3259ed", "#e6a173", "#a087d4", "#6e92ce"], ["#a89aff", "#b4a7c9", "#8eaddb", "#c491af"], ["#e77954", "#d9a47f", "#c78b9f", "#bb8bc5"], ["#8b66d6", "#bd8ed3", "#8b9edb", "#c98db8"], ["#69c8e9", "#829cda", "#a897da", "#6daac9"]];
  R.tint = (color) => {
    if (["#bcd59f", "#c7dfa9", "#c5dfab", "#b5c99e"].includes(color))
      return R.appearanceColors[R.mode - 1][0];
    const defaults = ["#bdd6a6", "#deb597", "#bcb1d5", "#bcd3a7", "#d2b194", "#bdb0d1", "#bcb4d6", "#bbd49b", "#d6b294", "#9ab9b2"];
    const index = defaults.indexOf(color);
    return index >= 0 ? R.appearanceColors[R.mode - 1][index % 4] : color;
  };
  R.illustration = (mode) => {
    const drawings = {
      1: '<path class="art-wash" d="M18 98c-4-38 25-63 68-62 52 1 91 15 91 47 0 29-48 37-90 33-36-3-65 1-69-18Z"/><g transform="rotate(-8 83 73)"><rect class="art-paper" x="28" y="34" width="100" height="70" rx="8"/><path class="art-stroke" d="M28 51h100"/><circle class="art-solid" cx="38" cy="42" r="2"/><circle class="art-pale" cx="46" cy="42" r="2"/><path class="art-light" d="M42 65h42m-42 9h60m-60 9h32"/></g><g transform="rotate(9 129 76)"><rect class="art-colored" x="105" y="57" width="57" height="63" rx="7"/><path class="art-white" d="M119 75h25m-25 9h21m-21 9h12"/></g><path class="art-stroke" d="m158 24 2-9 3 9 9 3-9 3-3 9-2-9-9-3Z"/><path class="art-doodle" d="M42 124c15 11 31 10 42 1m-4-4 6 4-2 6"/>',
      2: '<circle class="art-wash" cx="96" cy="76" r="57"/><rect class="art-pale-fill" x="48" y="32" width="107" height="76" rx="3"/><rect class="art-paper" x="29" y="46" width="107" height="76" rx="3"/><path class="art-stroke" d="M29 63h107m-90-8h5m6 0h5m6 0h5"/><path class="art-colored-line" d="m57 80-10 8 10 8m32-16 10 8-10 8m-17-18-6 22"/><path class="art-light" d="M111 88h10m-74 23h43"/><path class="art-doodle" d="M153 67c23 0 24-25 9-27m-2-5 1 7 7-1"/><circle class="art-solid" cx="160" cy="114" r="4"/>',
      3: '<path class="art-wash" d="M32 94C6 61 39 33 80 35c32-30 91 2 89 42 10 33-45 52-77 36-30 11-47-1-60-19Z"/><g transform="rotate(-10 79 76)"><rect class="art-paper" x="34" y="35" width="80" height="88" rx="8"/><path class="art-light" d="M48 58h44m-44 12h37m-37 12h43m-43 12h24"/></g><g transform="rotate(14 133 70)"><path class="art-colored" d="m125 35 14-1-3 66-8 12-6-13Z"/><path class="art-white" d="m125 46 12-1m-13 51 11-1"/></g><path class="art-doodle" d="M52 126c35 19 74 11 82-3m-6-1 8-1-1 8M155 26l3-9m5 18 9-3m-20 3-7-5"/>',
      4: '<circle class="art-wash" cx="98" cy="77" r="58"/><path class="art-paper" d="M35 41h91a9 9 0 0 1 9 9v47a9 9 0 0 1-9 9H75l-19 14 3-14H35a9 9 0 0 1-9-9V50a9 9 0 0 1 9-9Z"/><path class="art-light" d="M45 62h66M45 73h51M45 84h36"/><g transform="rotate(11 139 93)"><rect class="art-colored" x="113" y="69" width="50" height="55" rx="10"/><path class="art-white" d="m127 96 7 7 16-20"/></g><circle class="art-pale-fill" cx="148" cy="33" r="7"/><circle class="art-solid" cx="166" cy="19" r="3"/><path class="art-doodle" d="m35 27-7-6m-4 18-9-1"/>',
      5: '<ellipse class="art-wash" cx="97" cy="91" rx="73" ry="35"/><path class="art-colored" d="M51 36h78a8 8 0 0 1 8 8v76H43V44a8 8 0 0 1 8-8Z"/><path class="art-paper" d="M66 25h63a7 7 0 0 1 7 7v80H59V32a7 7 0 0 1 7-7Z"/><path class="art-light" d="M74 47h46M74 60h34M74 73h42M74 86h24"/><path class="art-pale-fill" d="M108 25h15v26l-7-5-8 5Z"/><path class="art-stroke" d="M34 120h122m-108 9h88"/><path class="art-solid" d="M158 26c-9 1-13 13-7 20-12-1-17-18-7-25 4-3 10-3 14-1-2 1-3 4 0 6Z"/><path class="art-doodle" d="m25 53 2-7 2 7 7 2-7 2-2 7-2-7-7-2Z"/>'
    };
    return '<svg class="workspace-illustration" viewBox="0 0 195 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + drawings[mode] + "</svg>";
  };
  const { e: E, icon: I } = R;
  Object.assign(R.paths, { board: "M3 4h18v16H3zm6 0v16m6-16v16", gallery: "M3 3h18v18H3zm0 12 5-5 5 5 3-3 5 5M8 7h.01", up: "m6 15 6-6 6 6", trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7", spark: "m12 3 2 6 7 3-7 2-2 7-2-7-7-2 7-3z", menu: "M4 6h16M4 12h16M4 18h16" });
  R.btn = (text, action, cls = "button", extra = "") => `<button class="${cls}" data-action="${action}" ${extra}>${text}</button>`;
  R.newButton = (text = "New note", extra = "") => R.btn(`${I("plus")}${text}`, "new", "button primary", extra);
  R.logo = () => `<button class="logo" data-action="home" aria-label="Relay home"><svg class="relay-symbol" aria-hidden="true" viewBox="0 0 32 32"><path d="M5 20V10a6 6 0 0 1 6-6h12v6H11v14z"/><path class="relay-symbol-return" d="M27 12v10a6 6 0 0 1-6 6H9v-6h12V8z"/></svg><span class="relay-wordmark">relay</span></button>`;
  R.projectMark = (p) => {
    const raw = R.data.projectDetails[p]?.color, color = R.tint(/^#[a-f\d]{6}$/i.test(raw) ? raw : R.appearanceColors[R.mode - 1][0]);
    return `<span class="project-initial" style="--project-color:${color}">${E(p.slice(0, 1))}</span>`;
  };
  R.projectOptions = (selected) => R.data.projects.map((p) => `<option ${p === selected ? "selected" : ""} value="${E(p)}">${E(p)}</option>`).join("");
  R.projectSelect = () => `<label class="project-picker">${R.projectMark(R.ui.project)}<select data-project-select aria-label="Your project">${R.projectOptions(R.ui.project)}<option value="__new_project__">+ Make another project</option></select>${I("down")}</label>`;
  R.folderCount = (id) => R.data.cards.filter((c) => !c.archived && R.descendants(id).has(c.folder)).length;
  R.folderTree = (parent = "", depth = 0) => R.data.folders.filter((f) => f.project === R.ui.project && f.parent === parent).map((f) => {
    const children = R.data.folders.some((x) => x.parent === f.id), closed = R.ui.collapsed.has(f.id);
    return `<div class="tree-branch"><div class="tree-row ${R.ui.folder === f.id ? "active" : ""}" style="--depth:${depth};--folder-accent:${/^#[a-f\d]{6}$/i.test(f.color || "") ? R.tint(f.color) : "var(--dim)"}">${children ? `<button class="tree-toggle ${closed ? "closed" : ""}" data-collapse="${E(f.id)}" aria-expanded="${!closed}" aria-label="${closed ? "Expand" : "Collapse"} ${E(f.name)}">${I("down")}</button>` : '<span class="tree-spacer"></span>'}<button data-folder="${E(f.id)}">${I(R.paths[f.icon] ? f.icon : "folder")}<span>${E(f.name)}</span><small>${R.folderCount(f.id)}</small></button></div>${!closed ? R.folderTree(f.id, depth + 1) : ""}</div>`;
  }).join("");
  R.sidebar = () => `<aside class="workspace-sidebar ${R.ui.sideOpen ? "open" : ""}" ${innerWidth <= 760 && !R.ui.sideOpen ? 'inert aria-hidden="true"' : ""}><div class="side-brand">${R.logo()}${R.btn(I("close"), "close-sidebar", "icon-button mobile-only", 'aria-label="Close navigation"')}</div>${R.projectSelect()}<div class="side-links">${[["all", "grid", "Everything"], ["saved", "pin", "Pinned"], ["archive", "archive", "Archive"]].map(([key, ico, label]) => `<button data-scope="${key}" class="${R.ui.scope === key && !R.ui.folder ? "active" : ""}">${I(ico)}<span>${label}</span>${key === "saved" ? `<small>${R.data.cards.filter((c) => c.project === R.ui.project && c.saved && !c.archived).length}</small>` : ""}</button>`).join("")}</div><div class="side-section">YOUR FOLDERS${R.btn(I("plus"), "new-folder", "icon-button", 'aria-label="Add a folder"')}</div><nav class="folder-tree" aria-label="Your folders">${R.folderTree() || '<p class="tree-empty">A few places for your thoughts.<br>Add a folder when you need one.</p>'}</nav><button class="side-add" data-action="new-folder">${I("plus")}New folder</button><div class="sidebar-bottom">${R.newButton()}<button data-action="search">${I("search")}Find a thought<kbd>⌘ K</kbd></button><button data-action="customize">${I("settings")}Make it yours</button><div class="sidebar-foot"><span class="local-indicator"></span><span>Yours, in this browser.</span>${R.btn(I("info"), "research", "icon-button", 'aria-label="The thinking behind Relay"')}</div></div></aside>`;
  R.search = (placeholder = "Find a thought…") => `<label class="search-field">${I("search")}<input data-search aria-label="Search your notes" value="${E(R.ui.query)}" placeholder="${placeholder}"><kbd>/</kbd></label>`;
  R.header = () => `<header class="workspace-header"><div class="header-path">${R.btn(I("menu"), "toggle-sidebar", "icon-button mobile-only", 'aria-label="Open navigation"')}<button data-action="root">${E(R.ui.project)}</button>${R.trail(R.ui.folder).map((f) => `<span>/</span><button data-folder="${E(f.id)}">${E(f.name)}</button>`).join("")}</div><div class="header-tools">${R.search()}${R.btn(I("settings"), "customize", "icon-button", 'aria-label="Make this workspace yours"')}</div></header>`;
  R.bookmark = (c) => `<button class="icon-button keep-button ${c.saved ? "kept" : ""}" data-bookmark="${E(c.id)}" aria-label="${c.saved ? "Unpin" : "Pin"} ${E(c.title)}" aria-pressed="${!!c.saved}">${I("pin")}</button>`;
  R.stage = (c) => {
    const col = R.data.columns.find((x) => x.id === c.status) || R.data.columns[0];
    return `<span class="stage" style="--stage-color:${/^#[a-f\d]{6}$/i.test(col.color) ? R.tint(col.color) : R.appearanceColors[R.mode - 1][0]}"><i></i>${E(col.name)}</span>`;
  };
  R.noteExcerpt = (c) => (c.body || R.next(c) || c.tried || "A thought waiting to unfold.").replace(/\n+/g, " ");
  R.noteTags = (c) => (c.tags || []).slice(0, 2).map((t) => `<span class="note-tag">${E(t)}</span>`).join("");
  R.empty = (title = "A little room to begin.", description = "A sentence, a question, a messy thought. Start anywhere.") => `<div class="empty"><span class="empty-illustration">${R.illustration(R.mode)}</span><h3>${title}</h3><p>${description}</p>${R.newButton("Leave the first note")}</div>`;
  R.folderCards = () => `<section class="folder-section"><div class="section-line"><div><h2>Your folders</h2><p>Organize things your way. Nothing here is fixed.</p></div>${R.btn(`${I("plus")}New folder`, "new-folder", "quiet-button")}</div><div class="folder-cards">${R.childFolders().map((f, i) => {
    const color = /^#[a-f\d]{6}$/i.test(f.color || "") ? R.tint(f.color) : R.appearanceColors[R.mode - 1][f.color === undefined ? i % 4 : 0], icon = R.paths[f.icon] ? f.icon : "folder";
    return `<article class="folder-card folder-color-${i % 4}" style="--folder-accent:${color}"><button class="folder-open" data-folder="${E(f.id)}"><div class="folder-visual">${I(icon)}<span>${R.folderCount(f.id)} ${R.folderCount(f.id) === 1 ? "note" : "notes"}</span></div><h3>${E(f.name)}</h3><p>${E(f.description || "A space for whatever comes next.")}</p></button>${R.btn(`${I("edit")}<span>Edit folder</span>`, "folder-options", "folder-edit", `data-id="${E(f.id)}" aria-label="Edit ${E(f.name)}"`)}</article>`;
  }).join("")}<button class="new-folder-tile" data-action="new-folder"><span class="new-folder-plus">${I("plus")}</span><h3>Make it yours.</h3><p>Create a folder with any name you like.</p><span class="new-folder-call">New folder ${I("arrow")}</span></button></div></section>`;
  R.viewPicker = () => `<div class="view-picker" role="group" aria-label="How to see your notes">${[["list", "lines", "List"], ["gallery", "gallery", "Cards"], ["board", "board", "Board"]].map(([key, ico, label]) => `<button data-view="${key}" class="${R.view() === key ? "active" : ""}" aria-pressed="${R.view() === key}">${I(ico)}<span>${label}</span></button>`).join("")}</div>`;
  R.collectionHeader = (label = "Notes, just as you left them") => `<div class="collection-header"><h2>${label}<small>${R.cards().length}</small></h2><div>${R.ui.folder ? `<label class="nested-choice"><input type="checkbox" data-nested ${R.ui.includeNested ? "checked" : ""}>Include subfolders</label>` : ""}${R.viewPicker()}</div></div>`;
  R.list = (cards) => cards.length ? `<div class="note-list">${cards.map((c) => `<article class="note-row"><button class="note-row-open" data-open="${E(c.id)}"><span class="note-row-icon">${I("file")}</span><div><h3>${E(c.title)}</h3>${R.data.prefs.previews ? `<p>${E(R.noteExcerpt(c))}</p>` : ""}</div></button><div class="note-row-meta">${R.stage(c)}<time>${R.age(c.updated)}</time></div>${R.bookmark(c)}</article>`).join("")}</div>` : R.empty();
  R.gallery = (cards) => cards.length ? `<div class="note-gallery">${cards.map((c, i) => `<article class="note-tile tile-color-${i % 4}"><div class="tile-top"><span>${E(R.folder(c.folder)?.name || "A loose thought")}</span>${R.bookmark(c)}</div><button class="tile-open" data-open="${E(c.id)}">${c.attachments.find((a) => a.type?.startsWith("image/")) ? `<div class="tile-image"><img data-hydrate="${E(c.attachments.find((a) => a.type?.startsWith("image/")).id)}" alt="Attached to ${E(c.title)}"></div>` : ""}<h3>${E(c.title)}</h3>${R.data.prefs.previews ? `<p>${E(R.noteExcerpt(c))}</p>` : ""}</button><div class="tile-bottom"><span>${R.noteTags(c) || R.stage(c)}</span><time>${R.age(c.updated)}</time></div></article>`).join("")}</div>` : R.empty();
  R.board = (cards) => `<div class="note-board" aria-label="Your board">${R.data.columns.map((col, i) => {
    const notes = cards.filter((c) => c.status === col.id);
    return `<section class="note-lane" data-drop-status="${E(col.id)}" style="--column-color:${/^#[a-f\d]{6}$/i.test(col.color) ? R.tint(col.color) : R.appearanceColors[R.mode - 1][0]}"><header><span class="lane-dot"></span><h3 class="lane-title">${E(col.name)}</h3><small>${notes.length}</small>${R.btn(I("settings"), "edit-column", "icon-button", `data-id="${E(col.id)}" aria-label="Edit ${E(col.name)} column"`)}${R.btn(I("plus"), "new", "icon-button", `data-new-status="${E(col.id)}" aria-label="New note in ${E(col.name)}"`)}</header><div class="lane-stack">${notes.map((c, n) => `<article class="pin-card pin-${(i + n) % 4}" draggable="true" data-drag-id="${E(c.id)}"><div class="pin-card-top">${R.noteTags(c) || `<span>${E(R.folder(c.folder)?.name || "A loose thought")}</span>`}${R.bookmark(c)}</div><button data-open="${E(c.id)}"><h3>${E(c.title)}</h3>${R.data.prefs.previews ? `<p>${E(R.noteExcerpt(c))}</p>` : ""}${R.next(c) ? `<div class="pin-next"><span>Next time →</span><p>${E(R.next(c))}</p></div>` : ""}</button><div class="pin-card-bottom"><time>${R.age(c.updated)}</time>${c.attachments.length ? `<span>${I("link")}${c.attachments.length}</span>` : ""}<select data-status-id="${E(c.id)}" aria-label="Move ${E(c.title)}">${R.data.columns.map((x) => `<option value="${E(x.id)}" ${c.status === x.id ? "selected" : ""}>${E(x.name)}</option>`).join("")}</select></div></article>`).join("")}${R.btn(`${I("plus")}New note`, "new", "lane-new", `data-new-status="${E(col.id)}"`)}</div></section>`;
  }).join("")}<button class="add-lane" data-action="customize" data-tab="board">${I("plus")}Add column</button></div>`;
  R.collection = (cards = R.cards()) => R.view() === "board" ? R.board(cards) : R.view() === "gallery" ? R.gallery(cards) : R.list(cards);
  R.quickCapture = () => `<form class="quick-capture" id="quick-capture">${I("plus")}<input name="thought" required maxlength="180" placeholder="Catch a thought before it goes…" aria-label="Quick note"><button type="submit" aria-label="Keep this thought">${I("arrow")}</button></form>`;
  R.latest = () => R.cards().find((c) => c.status !== "done") || R.cards()[0];
  R.returnStrip = () => {
    const c = R.latest();
    return c ? `<button class="return-strip" data-open="${E(c.id)}"><span class="return-symbol">↳</span><div><small>Last time you were here</small><h3>${E(c.title)}</h3><p>${E(R.next(c) || R.noteExcerpt(c))}</p></div><span class="return-action">Pick up here ${I("arrow")}</span></button>` : "";
  };
  R.files = (c) => `<div class="reference-list">${c.files.map((f) => `<button data-reference="${E(f)}">${I("file")}<span>${E(f)}</span>${I("copy")}</button>`).join("")}${(c.links || "").split(`
`).filter(Boolean).map((u) => {
    let safe = false;
    try {
      safe = ["https:", "http:"].includes(new URL(u).protocol);
    } catch {}
    return safe ? `<a href="${E(u)}" target="_blank" rel="noopener noreferrer">${I("link")}<span>${E(u)}</span>↗</a>` : `<span>${E(u)}</span>`;
  }).join("")}</div>`;
  R.noteContents = (c, inline = false) => `<article class="reading-note"><div class="reading-overline"><span>${E(R.folder(c.folder)?.name || "A loose thought")}</span>${R.bookmark(c)}</div><h2 ${inline ? "" : 'id="modal-title"'}>${E(c.title)}</h2><div class="reading-meta">${R.stage(c)}<time>${R.date(c.updated, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></div>${inline ? `<textarea class="inline-thought" data-inline-id="${E(c.id)}" aria-label="Your thoughts" placeholder="A little more room for the thought…">${E(c.body)}</textarea><small class="inline-save" id="inline-save">Your thoughts save as you write.</small>` : `<div class="reading-body">${R.prose(c.body || "")}</div>`}<div class="reading-prompts">${R.template(c.template).fields.filter((f) => R.value(c, f.id) !== "" && R.value(c, f.id) !== false).map((f) => `<section><span>${E(f.label)}</span><p>${E(R.value(c, f.id) === true ? "Yes" : R.value(c, f.id))}</p></section>`).join("")}</div>${R.extraAnswers(c).length ? `<details class="earlier-layout"><summary>Kept from an earlier page layout</summary>${R.extraAnswers(c).map((a) => `<section><span>${E(a.label)}</span><p>${E(a.value === true ? "Yes" : a.value)}</p></section>`).join("")}</details>` : ""}${c.attachments.length ? `<div class="reading-attachments">${c.attachments.map((a) => `<button data-action="open-attachment" data-file-id="${E(a.id)}">${a.type?.startsWith("image/") ? `<img data-hydrate="${E(a.id)}" alt="${E(a.name)}">` : I("file")}<span>${E(a.name)}</span></button>`).join("")}</div>` : ""}${c.files.length || c.links || c.branch ? `<details class="reading-context"><summary>${I("branch")}Branch, files & links</summary>${c.branch ? `<code>${E(c.branch)}</code>` : ""}${R.files(c)}<small>Saved references; the prototype is not connected to an editor.</small></details>` : ""}<div class="reading-bottom">${R.btn(`${I("edit")}Edit note`, "edit", "button primary", `data-id="${E(c.id)}"`)}${R.btn(`${I("export")}Export note`, "export-card", "quiet-button", `data-id="${E(c.id)}"`)}${R.btn(`${I(c.archived ? "restore" : "archive")}${c.archived ? "Restore" : "Archive"}`, "archive-card", "quiet-button", `data-id="${E(c.id)}" aria-label="${c.archived ? "Bring back" : "Archive"} this note"`)}</div><details class="earlier-thoughts"><summary>${I("clock")}Version history<span>${c.history.length}</span></summary>${c.history.length ? c.history.map((h) => `<article><time>${R.date(h.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time><p>${E(h.body || h.tried || "A small change along the way.")}</p>${h.next ? `<p><b>Next time:</b> ${E(h.next)}</p>` : ""}${h.values ? Object.entries(h.values).filter(([k, v]) => v !== "" && v !== false).map(([k, v]) => `<p>${E(v === true ? "Yes" : v)}</p>`).join("") : ""}</article>`).join("") : '<p class="history-empty">As you leave checkpoints, the earlier thinking stays here.</p>'}</details></article>`;
  R.studio = () => `<div class="workspace studio">${R.sidebar()}<div class="workspace-body">${R.header()}<main class="studio-main" id="main"><div class="studio-heading"><div><span class="eyebrow">A PLACE TO KEEP GOING</span><h1>${E(R.scopeTitle())}<span>.</span></h1><p>${E(R.folder(R.ui.folder)?.description || R.data.projectDetails[R.ui.project]?.description || "A place for whatever you’re making.")}</p></div><div class="heading-art" aria-hidden="true">${R.illustration(R.mode)}</div><div class="heading-actions">${R.ui.folder ? R.btn(`${I("plus")}New subfolder`, "new-subfolder", "button secondary") + R.btn(`${I("edit")}Edit folder`, "folder-options", "button secondary", `data-id="${E(R.ui.folder)}" aria-label="Folder options"`) : R.btn(`${I("folder")}New folder`, "new-folder", "button secondary")}${R.newButton()}</div></div>${R.ui.scope === "all" && !R.ui.query ? R.returnStrip() : ""}${R.ui.scope === "all" && !R.ui.query ? R.folderCards() : ""}<section class="collection">${R.collectionHeader()}${R.collection()}</section><div class="workspace-end"><span>Make a little progress. Leave a little context.</span>${R.btn("Make this space yours ↗", "customize", "quiet-button")}</div></main></div></div>`;
  R.switcher = () => `<span class="switcher-label">ONE WORKSPACE. FIVE FEELINGS.</span><div class="switcher-options" role="group" aria-label="Five visual treatments of Studio">${R.modes.map((m, i) => `<button data-mode="${i + 1}" class="${R.mode === i + 1 ? "active" : ""}" aria-label="Prototype ${i + 1}: ${m.name}" aria-pressed="${R.mode === i + 1}"><span>${i + 1}</span><small>${m.name}</small></button>`).join("")}</div><span class="switcher-caption">${R.modes[R.mode - 1].description}</span>${R.btn(I("info"), "compare", "switcher-help", 'aria-label="About these five directions"')}`;
  R.hydrate = async () => {
    await R.filesReady;
    for (const img of document.querySelectorAll("[data-hydrate]")) {
      const f = await R.getFile(img.dataset.hydrate);
      if (f && /^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,/i.test(f.src))
        img.src = f.src;
    }
  };
  R.render = () => {
    const active = document.activeElement, isSearch = active?.hasAttribute("data-search"), position = isSearch ? active.selectionStart : null;
    document.body.dataset.prototype = R.mode;
    document.body.dataset.density = R.data.prefs.density;
    document.documentElement.style.setProperty("--personal-accent", /^#[a-f\d]{6}$/i.test(R.data.prefs.accent) ? R.tint(R.data.prefs.accent) : "");
    document.querySelector("#app").innerHTML = relayMarkup(R.studio());
    if (isSearch) {
      const input = document.querySelector("[data-search]");
      input?.focus();
      input?.setSelectionRange(position, position);
    }
    R.hydrate();
  };
  const app = document.querySelector("#app"), modal = document.querySelector("#modal"), modalContent = document.querySelector("#modal-content");
  const inlineSnapshotTimes = new Map;
  let modalKind = "", modalCard = "", editingId = null, editorDraft = null, returnToEditor = false, settingsTab = "templates", selectedTemplate = "blank", dragId = "", toastTimeout, inlineTimer = null, inlinePending = null;
  R.toast = (message) => {
    const el = document.querySelector("#toast");
    el.textContent = message;
    el.classList.add("visible");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.remove("visible"), 4500);
  };
  R.modalTop = (label) => `<div class="modal-top"><span class="eyebrow">${label}</span>${R.btn(I("close"), "close", "icon-button", 'aria-label="Close"')}</div>`;
  R.showModal = (html, kind = "info") => {
    modalKind = kind;
    modalContent.innerHTML = relayMarkup(html);
    modal.classList.toggle("writing-dialog", kind === "editor");
    if (!modal.open)
      modal.showModal();
    modal.scrollTop = 0;
    R.hydrate();
  };
  R.closeModal = () => {
    if (modalKind === "editor")
      R.saveDraft();
    if (returnToEditor && modalKind !== "editor") {
      returnToEditor = false;
      R.openEditor(editingId);
      return;
    }
    modal.close();
    R.render();
  };
  R.openReader = (id) => {
    returnToEditor = false;
    R.flushInline();
    const c = R.card(id);
    if (!c)
      return;
    modalCard = id;
    R.showModal(`${R.modalTop("NOTE")}${R.noteContents(c)}`, "reader");
  };
  R.folderOptions = (project, selected = "", excluded = "") => {
    const exclude = excluded ? R.descendants(excluded) : new Set;
    return `<option value="">Loose in ${E(project)}</option>${R.data.folders.filter((f) => f.project === project && !exclude.has(f.id)).map((f) => `<option value="${E(f.id)}" ${f.id === selected ? "selected" : ""}>${E(R.folderLabel(f.id))}</option>`).join("")}`;
  };
  R.customField = (f, c) => {
    const value = R.value(c, f.id), id = "prompt-" + f.id;
    return `<div class="optional-prompt"><label for="${E(id)}">${E(f.label)}<small>Only if it helps</small></label>${f.type === "long" ? `<textarea id="${E(id)}" rows="3" data-custom-field="${E(f.id)}" placeholder="Anything worth keeping…">${E(value)}</textarea>` : f.type === "check" ? `<label class="prompt-check"><input id="${E(id)}" type="checkbox" data-custom-field="${E(f.id)}" ${value === true ? "checked" : ""}>${E(f.options || "A little yes")}</label>` : f.type === "select" ? `<select id="${E(id)}" data-custom-field="${E(f.id)}"><option value="">Leave open for now</option>${(f.options || "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => `<option value="${E(x)}" ${value === x ? "selected" : ""}>${E(x)}</option>`).join("")}</select>` : `<input id="${E(id)}" type="${f.type === "date" ? "date" : f.type === "link" ? "url" : "text"}" data-custom-field="${E(f.id)}" value="${E(value)}" placeholder="${f.type === "link" ? "https://…" : "A small thing to remember…"}">`}</div>`;
  };
  R.collectDraft = () => {
    const form = document.querySelector("#note-form");
    if (!form || !editorDraft)
      return editorDraft;
    const values = Object.fromEntries(new FormData(form));
    Object.assign(editorDraft, { title: values.title || "", body: values.body || "", project: values.project, folder: values.folder || "", template: values.template, status: values.status, branch: values.branch || "", files: (values.files || "").split(`
`).map((x) => x.trim()).filter(Boolean), links: values.links || "", tags: (values.tags || "").split(",").map((x) => x.trim()).filter(Boolean) });
    form.querySelectorAll("[data-custom-field]").forEach((el) => {
      const key = el.dataset.customField, v = el.type === "checkbox" ? el.checked : el.value;
      editorDraft.values[key] = v;
      if (["tried", "next", "blocked"].includes(key))
        editorDraft[key] = typeof v === "boolean" ? v ? "Yes" : "" : v;
    });
    return editorDraft;
  };
  R.saveDraft = () => {
    const draft = R.collectDraft();
    if (!draft)
      return;
    const stored = R.storage("relay-studio-draft:" + (editingId || "new"), draft);
    const label = document.querySelector("#draft-status");
    if (label)
      label.textContent = stored ? "Draft saved" : "Browser storage is unavailable; keep this page open.";
  };
  R.openEditor = (id = null, status = null, prefill = null) => {
    returnToEditor = false;
    R.flushInline();
    const c = id ? R.card(id) : null;
    editingId = c?.id || null;
    const saved = R.read("relay-studio-draft:" + (editingId || "new"));
    const validDraft = saved && typeof saved.title === "string" && typeof saved.body === "string" && Array.isArray(saved.files) && saved.values && typeof saved.values === "object";
    const folder = R.folder(R.ui.folder), now = Date.now();
    editorDraft = structuredClone(validDraft ? saved : c || { id: crypto.randomUUID(), project: R.ui.project || R.data.projects[0], folder: R.ui.folder || "", title: prefill || "", body: "", template: folder?.template || R.data.prefs.template || "blank", status: status || R.data.columns[0].id, tried: "", next: "", blocked: "", branch: "", files: [], links: "", tags: [], values: {}, attachments: [], saved: false, archived: false, created: now, updated: now, history: [] });
    if (prefill && !c)
      editorDraft.title = prefill;
    if (!R.data.projects.includes(editorDraft.project))
      editorDraft.project = R.data.projects[0];
    if (editorDraft.folder && R.folder(editorDraft.folder)?.project !== editorDraft.project)
      editorDraft.folder = "";
    if (!R.data.columns.some((x) => x.id === editorDraft.status))
      editorDraft.status = R.data.columns[0].id;
    const d = editorDraft, t = R.template(d.template);
    d.template = t.id;
    R.showModal(`<form id="note-form" class="simple-editor"><header class="editor-header"><span>${E(d.project)}${d.folder ? " / " + E(R.folder(d.folder)?.name || "") : ""}</span><div>${R.btn(I("pin"), "editor-pin", "icon-button", `type="button" aria-label="${d.saved ? "Unpin" : "Pin"} note" aria-pressed="${!!d.saved}"`)}${R.btn(I("close"), "close", "icon-button", 'type="button" aria-label="Close note"')}</div></header><div class="editor-content"><textarea class="editor-note-title" id="modal-title" name="title" rows="1" maxlength="180" placeholder="Untitled" aria-label="Title (optional)">${E(d.title)}</textarea><textarea name="body" class="editor-body" data-attachment-drop aria-label="Note" placeholder="Start writing…">${E(d.body)}</textarea><div class="editor-writing-bar"><div class="writing-tools"><button type="button" data-format="bold" aria-label="Bold"><b>B</b></button><button type="button" data-format="list" aria-label="Add a list">${I("lines")}</button><button type="button" data-format="code" aria-label="Add a code block">&lt;/&gt;</button></div><span>Markdown supported</span></div><div class="editor-attachment-list">${d.attachments.map((a) => `<div class="editor-attachment"><button type="button" data-action="open-attachment" data-file-id="${E(a.id)}">${a.type?.startsWith("image/") ? `<img data-hydrate="${E(a.id)}" alt="${E(a.name)}">` : I("file")}<span>${E(a.name)}</span></button>${R.btn(I("close"), "remove-attachment", "icon-button", `type="button" data-file-id="${E(a.id)}" aria-label="Detach ${E(a.name)}"`)}</div>`).join("")}</div><button type="button" class="editor-attach" data-action="attach" data-attachment-drop>${I("plus")}Attach a file</button><p class="aside-help">Drop a file, or paste a screenshot. Attachments stay in this browser.</p><details class="note-extras"><summary>${I("plus")}Add details <small>Optional · branch, links, location & more</small></summary><div class="extras-content"><div class="editor-layout-choices"><label>${I("file")}<select name="template" data-editor-template aria-label="Note layout">${R.data.templates.map((x) => `<option value="${E(x.id)}" ${x.id === d.template ? "selected" : ""}>${E(x.name)}</option>`).join("")}</select></label><label><select name="status" aria-label="Board column">${R.data.columns.map((x) => `<option value="${E(x.id)}" ${d.status === x.id ? "selected" : ""}>${E(x.name)}</option>`).join("")}</select></label>${R.btn(`${I("settings")}Edit templates`, "customize", "quiet-button", 'type="button" data-tab="templates" data-from-editor="true"')}</div>${t.fields.map((f) => R.customField(f, d)).join("")}<aside class="editor-aside"><div class="note-location-field"><span>Location</span><input type="hidden" name="project" value="${E(d.project)}"><label hidden><input type="hidden" name="folder" id="editor-folder" value="${E(d.folder)}"></label>${R.btn(`${I(d.folder ? "folder" : "file")}<span>${E(d.project)}${d.folder ? " / " + E(R.folderLabel(d.folder)) : " / No folder"}</span>${I("down")}`, "note-location", "location-trigger", 'type="button" aria-label="Change note location"')}</div><details ${d.files.length || d.branch || d.links ? "open" : ""}><summary>${I("branch")}Branch, files & links</summary><label>Branch<input name="branch" value="${E(d.branch)}" placeholder="A branch to return to"></label><label>Files to reopen<textarea name="files" rows="3" placeholder="src/sidebar.tsx:42">${E(d.files.join(`
`))}</textarea></label><label>Links to remember<textarea name="links" rows="2" placeholder="https://…">${E(d.links)}</textarea></label><small class="aside-help">References for later. No live editor connection yet.</small></details><details ${d.tags.length ? "open" : ""}><summary>${I("bookmark")}Labels</summary><label>Labels (comma separated)<input name="tags" value="${E(d.tags.join(", "))}" placeholder="a someday thing, worth a try"></label><small class="aside-help">Separate with commas. They can mean whatever you like.</small></details></aside></div></details></div><footer class="editor-bottom"><span id="draft-status" role="status">${validDraft ? "Draft restored" : "Draft saved as you type"}</span><div>${R.btn("Discard draft", "discard-draft", "quiet-button", 'type="button"')}<button type="submit" class="button primary">${c ? "Save changes" : "Save note"} ${I("check")}</button></div></footer></form>`, "editor");
    setTimeout(() => document.querySelector(".editor-body")?.focus(), 0);
  };
  R.persistEditorBeforeSettings = () => {
    if (modalKind === "editor") {
      R.saveDraft();
      returnToEditor = true;
    }
  };
  R.templateSettings = () => {
    const t = R.template(selectedTemplate);
    selectedTemplate = t.id;
    return `<p class="setting-caption">A note can be a blank page. Or a few questions that help you remember. You choose.</p><div class="settings-template-grid"><nav class="template-list" aria-label="Your note layouts">${R.data.templates.map((x) => `<button data-template-select="${E(x.id)}" class="${x.id === t.id ? "active" : ""}">${E(x.name)}${R.data.prefs.template === x.id ? " · default" : ""}</button>`).join("")}${R.btn(`${I("plus")}A new layout`, "add-template", "quiet-button")}</nav><div><div class="settings-template-head"><input class="settings-input" data-template-name="${E(t.id)}" value="${E(t.name)}" aria-label="Layout name">${R.btn(I("check"), "default-template", "icon-button", `data-id="${E(t.id)}" aria-label="Use this as the default layout"`)}${R.data.templates.length > 1 ? R.btn(I("trash"), "remove-template", "icon-button", `data-id="${E(t.id)}" aria-label="Remove this layout and keep its notes"`) : ""}</div><div class="section-line"><h2>The questions on this page</h2>${R.btn(`${I("plus")}Add one`, "add-field", "quiet-button", `data-id="${E(t.id)}"`)}</div>${t.fields.length ? t.fields.map((f, i) => `<div class="field-builder"><div><input data-field-label="${E(f.id)}" value="${E(f.label)}" aria-label="Question wording">${R.btn(I("up"), "field-up", "icon-button", `data-id="${E(f.id)}" aria-label="Move question up"`)}${R.btn(I("down"), "field-down", "icon-button", `data-id="${E(f.id)}" aria-label="Move question down"`)}${R.btn(I("close"), "remove-field", "icon-button", `data-id="${E(f.id)}" aria-label="Remove question"`)}</div><select data-field-type="${E(f.id)}" aria-label="Answer format">${[["short", "A short thought"], ["long", "A little more room"], ["check", "A check to make"], ["select", "A few choices"], ["date", "A day to remember"], ["link", "A link to keep"]].map(([k, label]) => `<option value="${k}" ${k === f.type ? "selected" : ""}>${label}</option>`).join("")}</select>${f.type === "select" || f.type === "check" ? `<input class="settings-input" data-field-options="${E(f.id)}" value="${E(f.options || "")}" placeholder="${f.type === "select" ? "Choices, separated by commas" : "Words beside the checkbox"}" aria-label="${f.type === "select" ? "Dropdown choices" : "Checkbox text"}">` : ""}</div>`).join("") : '<div class="settings-empty"><strong>A page with no questions.</strong>Just a title and room to write.<br>That can be all you need.</div>'}<p class="settings-help">Every page keeps its free-writing space. These are optional extras. Removing a question hides it from the layout; existing answers remain saved.</p></div></div>`;
  };
  R.boardSettings = () => `<p class="setting-caption">Give your board the spaces that make sense to you. No required workflow, no prescribed names.</p><div class="settings-columns">${R.data.columns.map((c, i) => `<div class="column-editor"><input type="color" value="${E(R.tint(c.color))}" data-column-color="${E(c.id)}" aria-label="Color for ${E(c.name)}"><input class="settings-input" data-column-name="${E(c.id)}" value="${E(c.name)}" aria-label="Board space name">${R.btn(I("up"), "column-up", "icon-button", `data-id="${E(c.id)}" ${i === 0 ? "disabled" : ""} aria-label="Move this space left"`)}${R.btn(I("down"), "column-down", "icon-button", `data-id="${E(c.id)}" ${i === R.data.columns.length - 1 ? "disabled" : ""} aria-label="Move this space right"`)}${R.btn(I("close"), "remove-column", "icon-button", `data-id="${E(c.id)}" ${R.data.columns.length === 1 ? "disabled" : ""} aria-label="Remove this space and keep its notes"`)}</div>`).join("")}</div>${R.btn(`${I("plus")}Add column`, "add-column", "quiet-button", 'style="margin-top:20px"')}<p class="settings-help">Notes stay in their folders when you move them on a board. If you remove a space, its notes move safely to the first remaining one.</p>`;
  R.feelSettings = () => `<p class="setting-caption">Make a few small changes until it feels like a place you’d come back to.</p><div class="preference-line"><div><strong>Default template</strong><p>The layout for a fresh note.</p></div><select data-pref="template" aria-label="Default note layout">${R.data.templates.map((t) => `<option value="${E(t.id)}" ${R.data.prefs.template === t.id ? "selected" : ""}>${E(t.name)}</option>`).join("")}</select></div><div class="preference-line"><div><strong>Spacing</strong><p>Choose how closely things sit together.</p></div><select data-pref="density" aria-label="Workspace spacing"><option value="comfortable" ${R.data.prefs.density === "comfortable" ? "selected" : ""}>Comfortable</option><option value="compact" ${R.data.prefs.density === "compact" ? "selected" : ""}>Compact</option></select></div><label class="preference-line"><div><strong>Note previews</strong><p>Show a little writing under note titles.</p></div><input type="checkbox" data-pref="previews" ${R.data.prefs.previews ? "checked" : ""} aria-label="Show note previews"></label><label class="preference-line"><div><strong>Include subfolders</strong><p>Include nested folders when browsing.</p></div><input type="checkbox" data-pref="includeNested" ${R.data.prefs.includeNested ? "checked" : ""} aria-label="Include nested folders by default"></label><div class="preference-line"><div><strong>Accent color</strong><p>Choose a highlight color for buttons and links.</p></div><div class="accent-options">${["", "#3259ed", "#9788f5", "#eb7852", "#9a75d5", "#55b9d9"].map((c, i) => `<button class="accent-option ${R.data.prefs.accent === c ? "active" : ""}" style="--swatch:${c || "linear-gradient(135deg,#3259ed 50%,#fca47e 50%)"}" data-accent="${c || "default"}" aria-label="${["Original palette", "Tabs blue", "Electric iris", "Apricot", "Lilac", "Clear sky"][i]}"></button>`).join("")}</div></div><div class="preference-line"><div><strong>${E(R.ui.project)}</strong><p>${E(R.data.projectDetails[R.ui.project]?.description || "Your own place to keep going.")}</p></div>${R.btn("Project settings", "project-options", "quiet-button")}</div>${R.btn(`${I("plus")}New project`, "new-project", "quiet-button", 'style="margin-top:22px"')}`;
  R.dataSettings = () => `<p class="setting-caption">Your writing stays in this browser. Take a copy whenever you like.</p><div class="backup-row">${R.btn(`${I("export")}Export backup`, "export-json", "button primary")}${R.btn(`${I("file")}Export Markdown`, "export-all-md", "button secondary")}${R.btn(`${I("restore")}Restore backup`, "import-json", "button secondary")}</div><p class="backup-message">The backup includes projects, nested folders, layouts, board spaces, notes, earlier thoughts, and available attachments. Markdown keeps the writing, custom answers, file references, and earlier thoughts.</p><p class="settings-help">Clearing browser data removes local notes and attachments. Backups are downloaded to your computer; there is no account or cloud sync in Relay.</p>`;
  R.customize = (tab = "templates", fromEditor = false) => {
    if (fromEditor || modalKind === "editor")
      R.persistEditorBeforeSettings();
    settingsTab = ["templates", "board", "feel", "data"].includes(tab) ? tab : "templates";
    R.showModal(`${R.modalTop("SMALL CHANGES. A SPACE THAT FEELS LIKE YOURS.")}<section class="settings-dialog"><div class="settings-heading"><h2 id="modal-title">Make it yours.</h2></div><div class="choice-tabs" role="group" aria-label="Workspace customization">${[["templates", "Your pages"], ["board", "Your board"], ["feel", "Your feel"], ["data", "Your notes"]].map(([key, label]) => `<button data-settings-tab="${key}" class="${settingsTab === key ? "active" : ""}">${label}</button>`).join("")}</div>${{ templates: R.templateSettings, board: R.boardSettings, feel: R.feelSettings, data: R.dataSettings }[settingsTab]()}</section>`, "settings");
  };
  R.backup = () => R.customize("data");
  R.folderForm = (id = null) => {
    const f = id ? R.folder(id) : null, project = f?.project || R.ui.project, icon = R.paths[f?.icon] ? f.icon : "folder", color = /^#[a-f\d]{6}$/i.test(f?.color || "") ? f.color : "", displayColor = color || R.appearanceColors[R.mode - 1][0];
    R.showModal(`${R.modalTop(f ? "A SMALL CHANGE, ALL YOURS" : "A NEW SPACE FOR YOUR THOUGHTS")}<h2 id="modal-title">${f ? "Make it feel like you." : "What would you call it?"}</h2><p class="modal-intro">${f ? "Rename it, give it a different look, or change how it opens." : "Start with a name. Everything else can wait."}</p><form id="folder-form" class="simple-form folder-form" ${f ? `data-id="${E(f.id)}"` : ""}><input type="hidden" name="icon" value="${E(icon)}"><input type="hidden" name="color" value="${E(color)}"><div class="folder-name-preview" style="--folder-accent:${displayColor}"><span id="folder-live-icon">${I(icon)}</span><span id="folder-live-title">${E(f?.name || "Your new folder")}</span></div><label class="folder-name-label" for="folder-name">Folder name<input id="folder-name" name="name" required autofocus maxlength="70" placeholder="Weekend builds, big ideas, anything…" value="${E(f?.name || "")}"></label><div class="folder-personality"><div><span>A little character</span><div class="folder-icon-picker" role="group" aria-label="Folder icon">${[["folder", "Folder"], ["file", "Page"], ["spark", "Spark"], ["branch", "Branch"], ["bookmark", "Bookmark"], ["link", "Link"]].map(([key, label]) => `<button type="button" data-folder-icon="${key}" class="${icon === key ? "selected" : ""}" aria-label="${label} icon" aria-pressed="${icon === key}">${I(key)}</button>`).join("")}</div></div><div><span>A touch of color</span><div class="folder-color-picker" role="group" aria-label="Folder color">${["", ...new Set(R.appearanceColors[R.mode - 1].slice(1)), "#df8d9e", "#9aa5d7"].map((c, i) => `<button type="button" data-folder-color="${c || "default"}" class="${color === c ? "selected" : ""}" style="--swatch:${c || R.appearanceColors[R.mode - 1][0]}" aria-label="${i === 0 ? "Theme color" : "Folder color " + i}" aria-pressed="${color === c}">${color === c ? I("check") : ""}</button>`).join("")}</div></div></div><details class="folder-extras"><summary>More ways to make it yours ${I("down")}</summary><label>A little about it <small>optional</small><textarea name="description" rows="2" placeholder="What belongs here?">${E(f?.description || "")}</textarea></label><label>Where it lives<select name="parent">${R.folderOptions(project, f ? f.parent : R.ui.folder || "", id || "")}</select></label><div class="form-pair"><label>Open this folder as<select name="view"><option value="">My usual view</option>${[["list", "List"], ["gallery", "Cards"], ["board", "Board"]].map(([k, v]) => `<option value="${k}" ${f?.view === k ? "selected" : ""}>${v}</option>`).join("")}</select></label><label>Start new notes with<select name="template"><option value="">My usual page</option>${R.data.templates.map((t) => `<option value="${E(t.id)}" ${f?.template === t.id ? "selected" : ""}>${E(t.name)}</option>`).join("")}</select></label></div></details><div class="folder-form-footer"><span>${f ? "Your notes stay right here." : "A name is all you need."}</span><button type="submit" class="button primary">${f ? "Save changes" : "Create folder"} ${I("arrow")}</button></div></form>`, "folder");
    const nameInput = document.querySelector("#folder-name");
    nameInput?.focus();
    if (f)
      nameInput?.select();
  };
  R.projectForm = (create = false) => {
    const p = R.ui.project, details = R.data.projectDetails[p] || {};
    R.showModal(`${R.modalTop(create ? "ROOM FOR SOMETHING ELSE" : "YOUR PROJECT, YOUR WORDS")}<h2 id="modal-title">${create ? "A new place to begin." : "A space that sounds like you."}</h2><form id="project-form" class="simple-form" data-create="${create}"><label>What would you call it?<input name="name" required maxlength="60" placeholder="e.g. Things I’m making" value="${E(create ? "" : p)}"></label><label>A little about it<textarea name="description" rows="3" placeholder="What’s growing here?">${E(create ? "" : details.description || "")}</textarea></label><label>A color<input type="color" name="color" value="${create ? "#3259ed" : E(details.color || "#3259ed")}" aria-label="Project color" style="height:43px;padding:5px"></label><div class="dialog-actions">${!create ? R.btn("Make another project", "new-project", "quiet-button", 'type="button"') : ""}<button type="submit" class="button primary">${create ? "Make room" : "Keep these changes"} ${I("check")}</button></div></form>`, "project");
  };
  R.browseFolders = () => R.showModal(`${R.modalTop("YOUR PLACES TO RETURN TO")}<h2 id="modal-title">Find the right corner.</h2><div class="folder-options-grid">${R.btn(`${I("grid")}Everything in ${E(R.ui.project)}`, "browse-root", "")}${R.data.folders.filter((f) => f.project === R.ui.project).map((f) => `<button data-browse-folder="${E(f.id)}">${I("folder")}<span>${E(R.folderLabel(f.id))}</span><small>${R.folderCount(f.id)} notes</small></button>`).join("")}${R.btn(`${I("plus")}A new folder`, "new-folder", "")}</div>`, "folders");
  R.compare = () => R.showModal(`${R.modalTop("SAME STUDIO. FIVE DIFFERENT FEELINGS.")}<h2 id="modal-title">Which feels like your space?</h2><p class="modal-intro">The same sidebar, folders, writing, and boards in every version. Only the visual language changes.</p>${R.modes.map((m, i) => `<button class="compare-option" data-mode="${i + 1}"><span>0${i + 1}</span><div><strong>${m.name}</strong><p>${m.description}</p></div>${I("arrow")}</button>`).join("")}<p class="settings-help">Version 1 draws from the active Tabs marketing site: cobalt blue, DM Sans, Instrument Serif accents, fine outlines, and small workspace illustrations. The other four explore different palettes and typefaces on the same Studio layout.</p>`, "compare");
  R.research = () => R.showModal(`${R.modalTop("THE THINKING BEHIND THE SPACE")}<h2 id="modal-title">Keep the thought. Skip the paperwork.</h2><div class="research-copy"><p>The original issue is losing the reasoning behind unfinished work. A good return point needs intent, what happened, and a way forward. It shouldn’t demand a daily report.</p><h3>What people already do</h3><p>The <a href="https://www.reddit.com/r/vscode/comments/1pp05qq/anyone_else_lose_their_entire_mental_context/" target="_blank" rel="noopener noreferrer">original discussion</a> includes project scratchpads, TODOs, and attempts to tie notes back to code. The <a href="https://news.ycombinator.com/item?id=9895713" target="_blank" rel="noopener noreferrer">HN discussion</a> includes per-project logs and a warning that too much structure can become its own burden.</p><p>A <a href="https://www.reddit.com/r/ExperiencedDevs/comments/1jzo7d3/" target="_blank" rel="noopener noreferrer">debugging discussion</a> describes note-taking to track paths and avoid repeating approaches. A <a href="https://www.reddit.com/r/webdev/comments/1e59w2a/just_me_how_do_you_remind_yourself_where_you_left/" target="_blank" rel="noopener noreferrer">webdev discussion</a> includes inline notes and comment anchors. These are qualitative examples, not proof of a universal preference.</p><h3>What changed after your reference</h3><p>The blank page comes first. There are no required categories or required “next step” fields. Extra prompts are optional and editable. Nested folders are real; each can choose a page layout and a view. Board space names are yours, and they mean something separate from folders.</p><h3>Why keep earlier thoughts?</h3><p><a href="https://www.microsoft.com/en-us/research/publication/evaluating-cues-for-resuming-interrupted-programming-tasks/" target="_blank" rel="noopener noreferrer">Parnin and DeLine’s research</a> motivates pairing notes with contextual cues and chronological information. Relay keeps saved checkpoints so changing direction doesn’t erase earlier reasoning.</p><h3>What this prototype can do</h3><p>Write, customize templates, organize nested folders, move notes on custom boards, pin, search, attach local files, save drafts, keep checkpoints, and export or restore a workspace. Pocket also supports writing directly on the page.</p><h3>What is still a design question?</h3><p>Which layout is inviting enough to use repeatedly? When does a helpful question become a chore? Do folder defaults save thought or create extra setup? These five treatments keep the same Studio workflow so you can compare the visual language before building the extension.</p><p>The sample notes are fictional. There is no live editor integration, automatic file inspection, Git detection, account, cloud sync, or AI summarization. Files and notes stay in this browser unless you export them.</p></div>`, "research");
  R.flushInline = () => {
    if (!inlinePending)
      return;
    clearTimeout(inlineTimer);
    const pending = inlinePending;
    inlinePending = null;
    const c = R.card(pending.id);
    if (!c || c.body === pending.body)
      return;
    if (Date.now() - (inlineSnapshotTimes.get(c.id) || 0) > 300000) {
      R.snapshot(c, "A little more written");
      inlineSnapshotTimes.set(c.id, Date.now());
    }
    c.body = pending.body;
    c.updated = Date.now();
    const saved = R.save();
    const label = document.querySelector("#inline-save");
    if (label)
      label.textContent = saved ? "Kept, just as you wrote it." : "Storage unavailable. Keep this page open.";
  };
  R.switchMode = (number) => {
    R.flushInline();
    if (modal.open && modalKind === "editor")
      R.saveDraft();
    modal.close();
    returnToEditor = false;
    number = Number(number);
    if (!Number.isInteger(number) || number < 1 || number > 5)
      return;
    R.mode = number;
    R.ui.sideOpen = false;
    R.storage("relay-studio-mode", number);
    const url = new URL(location.href);
    url.searchParams.set("v", number);
    history.replaceState(null, "", url);
    R.render();
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  R.setProject = (p) => {
    R.flushInline();
    if (!R.data.projects.includes(p))
      return;
    R.ui.project = p;
    R.ui.folder = "";
    R.ui.scope = "all";
    R.ui.query = "";
    R.ui.view = "";
    R.ui.selected = "";
    R.ui.sideOpen = false;
    R.render();
  };
  R.setFolder = (id) => {
    R.flushInline();
    const f = R.folder(id);
    if (!f)
      return;
    R.ui.folder = id;
    R.ui.project = f.project;
    R.ui.scope = "all";
    R.ui.selected = "";
    R.ui.view = "";
    R.ui.sideOpen = false;
    R.render();
  };
  R.reorder = (list, id, offset) => {
    const index = list.findIndex((x) => x.id === id), next = index + offset;
    if (index < 0 || next < 0 || next >= list.length)
      return;
    [list[index], list[next]] = [list[next], list[index]];
  };
  R.attachFiles = async (files) => {
    R.saveDraft();
    if (!editorDraft)
      return;
    await R.filesReady;
    if (!R.fileDatabase) {
      R.toast("File storage isn’t available in this browser. You can still keep text and file paths.");
      return;
    }
    let added = 0;
    for (const file of [...files]) {
      if (editorDraft.attachments.length >= 12) {
        R.toast("This note already has 12 attachments.");
        break;
      }
      if (file.size > 5 * 1024 * 1024) {
        R.toast(`${file.name} is larger than the 5 MB attachment limit.`);
        continue;
      }
      try {
        const src = await new Promise((resolve, reject) => {
          const r = new FileReader;
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        const f = { id: crypto.randomUUID(), name: file.name, type: file.type || "application/octet-stream", size: file.size, src };
        await R.putFile(f);
        editorDraft.attachments.push({ id: f.id, name: f.name, type: f.type, size: f.size });
        added++;
      } catch {
        R.toast(`Could not keep ${file.name}.`);
      }
    }
    R.storage("relay-studio-draft:" + (editingId || "new"), editorDraft);
    if (modalKind === "editor")
      R.openEditor(editingId);
    if (added)
      R.toast(`${added === 1 ? "A file" : added + " files"} kept with your draft.`);
  };
  R.exportBackup = async () => {
    R.flushInline();
    await R.filesReady;
    const ids = new Set(R.data.cards.flatMap((c) => c.attachments.map((a) => a.id))), files = {};
    for (const id of ids) {
      const f = await R.getFile(id);
      if (f)
        files[id] = f;
    }
    R.download(JSON.stringify({ format: "relay-studio-v3", version: 3, state: R.data, files }, null, 2), "relay-my-workspace.json", "application/json");
  };
  const actions = {
    home: () => {
      R.flushInline();
      R.ui.scope = "all";
      R.ui.folder = "";
      R.ui.query = "";
      R.ui.view = "";
      R.ui.selected = "";
      R.ui.sideOpen = false;
      R.render();
    },
    root: () => actions.home(),
    "browse-root": () => {
      modal.close();
      actions.home();
    },
    saved: () => {
      R.flushInline();
      R.ui.scope = "saved";
      R.ui.folder = "";
      R.ui.selected = "";
      R.render();
    },
    "archive-scope": () => {
      R.flushInline();
      R.ui.scope = "archive";
      R.ui.folder = "";
      R.ui.selected = "";
      R.render();
    },
    new: (b) => R.openEditor(null, b.dataset.newStatus || null),
    open: (b) => R.openReader(b.dataset.id),
    edit: (b) => R.openEditor(b.dataset.id),
    close: R.closeModal,
    "toggle-sidebar": () => {
      R.ui.sideOpen = !R.ui.sideOpen;
      R.render();
    },
    "close-sidebar": () => {
      R.ui.sideOpen = false;
      R.render();
    },
    "new-folder": () => R.folderForm(),
    "folder-options": (b) => R.folderForm(b.dataset.id),
    "browse-folders": R.browseFolders,
    "new-project": () => R.projectForm(true),
    "project-options": () => R.projectForm(false),
    customize: (b) => R.customize(b.dataset.tab || "templates", !!b.dataset.fromEditor),
    backup: R.backup,
    research: R.research,
    compare: R.compare,
    search: () => R.openSearch(),
    "editor-pin": () => {
      R.saveDraft();
      editorDraft.saved = !editorDraft.saved;
      R.storage("relay-studio-draft:" + (editingId || "new"), editorDraft);
      R.openEditor(editingId);
    },
    "discard-draft": () => {
      try {
        localStorage.removeItem("relay-studio-draft:" + (editingId || "new"));
      } catch {}
      editorDraft = null;
      modal.close();
      R.toast("Draft let go. Your saved notes are still here.");
    },
    "archive-card": (b) => {
      R.flushInline();
      const c = R.card(b.dataset.id);
      const archived = !c.archived;
      R.mutate(c.id, { archived }, archived ? "Archive for a while" : "Brought back");
      modal.close();
      R.toast(archived ? "Archive. You can bring it back from “Archive”." : "Back among your thoughts.");
    },
    "export-card": (b) => {
      const c = R.card(b.dataset.id);
      R.download(R.markdown(c), "relay-" + c.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 65) + ".md", "text/markdown");
    },
    "export-json": R.exportBackup,
    "export-all-md": () => {
      R.flushInline();
      R.download(`# My Relay notebook

` + R.all().map((c) => R.markdown(c)).join(`

---

`), "relay-my-notebook.md", "text/markdown");
    },
    "import-json": () => {
      const el = document.querySelector("#backup-input");
      el.value = "";
      el.click();
    },
    "confirm-import": async () => {
      if (!R.pendingImport)
        return;
      const pending = R.pendingImport;
      R.pendingImport = null;
      await R.filesReady;
      if (Object.keys(pending.files || {}).length && !R.fileDatabase) {
        R.toast("File storage is unavailable. Restore in a browser with local file storage enabled.");
        return;
      }
      try {
        for (const f of Object.values(pending.files || {}))
          await R.putFile(f);
      } catch {
        R.toast("There wasn’t enough space for the attachments. The current workspace is unchanged.");
        return;
      }
      R.data = pending.state;
      R.refreshStatuses();
      R.ui.project = R.data.projects[0];
      R.ui.folder = "";
      R.ui.query = "";
      R.ui.scope = "all";
      R.ui.selected = "";
      R.ui.view = "";
      R.ui.collapsed = new Set;
      const saved = R.save();
      modal.close();
      R.render();
      if (saved)
        R.toast("Your workspace is back.");
    },
    "copy-reference": async () => {
      const input = document.querySelector("#reference-copy");
      try {
        await navigator.clipboard.writeText(input.value);
        R.toast("Reference copied.");
      } catch {
        input.select();
        R.toast("Selected. Use your copy shortcut to keep the reference.");
      }
    },
    attach: () => document.querySelector("#attachment-input").click(),
    "remove-attachment": (b) => {
      R.saveDraft();
      editorDraft.attachments = editorDraft.attachments.filter((a) => a.id !== b.dataset.fileId);
      R.storage("relay-studio-draft:" + (editingId || "new"), editorDraft);
      R.openEditor(editingId);
    },
    "open-attachment": async (b) => {
      const wasEditor = modalKind === "editor";
      if (wasEditor)
        R.saveDraft();
      await R.filesReady;
      const f = await R.getFile(b.dataset.fileId);
      if (!f) {
        R.toast("That attachment isn’t available in this browser.");
        return;
      }
      if (/^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,/i.test(f.src)) {
        returnToEditor = wasEditor;
        R.showModal(`${R.modalTop("KEPT WITH YOUR THOUGHT")}<h2 id="modal-title">${E(f.name)}</h2><img class="full-image" alt="${E(f.name)}" src="${E(f.src)}">`, "attachment");
      } else {
        const a = document.createElement("a");
        a.href = f.src;
        a.download = f.name;
        a.click();
      }
    },
    "add-template": () => {
      const t = { id: crypto.randomUUID(), name: "My kind of page", fields: [] };
      R.data.templates.push(t);
      selectedTemplate = t.id;
      R.save();
      R.customize("templates");
    },
    "remove-template": (b) => {
      if (R.data.templates.length < 2)
        return;
      const id = b.dataset.id;
      R.data.retiredFields ||= {};
      R.template(id).fields.forEach((f) => R.data.retiredFields[f.id] = { label: f.label, type: f.type });
      R.data.templates = R.data.templates.filter((t) => t.id !== id);
      const fallback = R.data.templates[0].id;
      R.data.cards.forEach((c) => {
        if (c.template === id)
          c.template = fallback;
      });
      R.data.folders.forEach((f) => {
        if (f.template === id)
          f.template = "";
      });
      if (R.data.prefs.template === id)
        R.data.prefs.template = fallback;
      selectedTemplate = fallback;
      R.save();
      R.customize("templates");
      R.toast("Layout removed. The notes and their answers are kept.");
    },
    "default-template": (b) => {
      R.data.prefs.template = b.dataset.id;
      R.save();
      R.customize("templates");
      R.toast("Fresh notes will start with this page. Folder choices still take priority.");
    },
    "add-field": () => {
      R.template(selectedTemplate).fields.push({ id: crypto.randomUUID(), label: "Something worth remembering", type: "long", options: "" });
      R.save();
      R.customize("templates");
    },
    "remove-field": (b) => {
      const t = R.template(selectedTemplate), removed = t.fields.find((f) => f.id === b.dataset.id);
      R.data.retiredFields ||= {};
      if (removed)
        R.data.retiredFields[removed.id] = { label: removed.label, type: removed.type };
      t.fields = t.fields.filter((f) => f.id !== b.dataset.id);
      R.save();
      R.customize("templates");
    },
    "field-up": (b) => {
      R.reorder(R.template(selectedTemplate).fields, b.dataset.id, -1);
      R.save();
      R.customize("templates");
    },
    "field-down": (b) => {
      R.reorder(R.template(selectedTemplate).fields, b.dataset.id, 1);
      R.save();
      R.customize("templates");
    },
    "add-column": () => {
      R.data.columns.push({ id: crypto.randomUUID(), name: "Another little space", color: "#b8bdd5" });
      R.refreshStatuses();
      R.save();
      R.customize("board");
    },
    "column-up": (b) => {
      R.reorder(R.data.columns, b.dataset.id, -1);
      R.refreshStatuses();
      R.save();
      R.customize("board");
    },
    "column-down": (b) => {
      R.reorder(R.data.columns, b.dataset.id, 1);
      R.refreshStatuses();
      R.save();
      R.customize("board");
    },
    "remove-column": (b) => {
      if (R.data.columns.length < 2)
        return;
      const id = b.dataset.id;
      R.data.columns = R.data.columns.filter((c) => c.id !== id);
      R.data.cards.filter((c) => c.status === id).forEach((c) => {
        c.status = R.data.columns[0].id;
      });
      R.refreshStatuses();
      R.save();
      R.customize("board");
      R.toast("Space removed. Its notes moved safely to the first space.");
    }
  };
  document.addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (!b)
      return;
    if (b.dataset.globalOpen) {
      const c = R.card(b.dataset.globalOpen);
      R.ui.project = c.project;
      R.ui.folder = c.folder;
      R.ui.scope = c.archived ? "archive" : "all";
      R.ui.selected = c.id;
      R.ui.query = "";
      modal.close();
      R.render();
      R.openReader(c.id);
      return;
    }
    if (b.dataset.folderIcon) {
      const form = document.querySelector("#folder-form");
      form.elements.icon.value = b.dataset.folderIcon;
      document.querySelector("#folder-live-icon").innerHTML = I(b.dataset.folderIcon);
      form.querySelectorAll("[data-folder-icon]").forEach((x) => {
        const selected = x === b;
        x.classList.toggle("selected", selected);
        x.setAttribute("aria-pressed", String(selected));
      });
      return;
    }
    if (b.hasAttribute("data-folder-color")) {
      const form = document.querySelector("#folder-form"), color = b.dataset.folderColor === "default" ? "" : b.dataset.folderColor;
      form.elements.color.value = color;
      document.querySelector(".folder-name-preview").style.setProperty("--folder-accent", color || R.appearanceColors[R.mode - 1][0]);
      form.querySelectorAll("[data-folder-color]").forEach((x) => {
        const selected = x === b;
        x.classList.toggle("selected", selected);
        x.setAttribute("aria-pressed", String(selected));
        x.innerHTML = selected ? I("check") : "";
      });
      return;
    }
    if (b.dataset.mode) {
      R.switchMode(b.dataset.mode);
      return;
    }
    if (b.dataset.action) {
      event.preventDefault();
      actions[b.dataset.action]?.(b);
      return;
    }
    if (b.dataset.scope) {
      R.flushInline();
      R.ui.scope = b.dataset.scope;
      R.ui.folder = "";
      R.ui.selected = "";
      R.ui.sideOpen = false;
      R.render();
      return;
    }
    if (b.dataset.folder) {
      R.setFolder(b.dataset.folder);
      return;
    }
    if (b.dataset.browseFolder) {
      modal.close();
      R.setFolder(b.dataset.browseFolder);
      return;
    }
    if (b.dataset.collapse) {
      const id = b.dataset.collapse;
      R.ui.collapsed.has(id) ? R.ui.collapsed.delete(id) : R.ui.collapsed.add(id);
      R.render();
      return;
    }
    if (b.dataset.view) {
      R.ui.view = b.dataset.view;
      if (R.ui.folder)
        R.folder(R.ui.folder).view = b.dataset.view;
      R.save();
      R.render();
      return;
    }
    if (b.dataset.open) {
      R.openReader(b.dataset.open);
      return;
    }
    if (b.dataset.select) {
      R.flushInline();
      R.ui.selected = b.dataset.select;
      R.render();
      if (innerWidth <= 520)
        document.querySelector(".pocket-reader").scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (b.dataset.bookmark) {
      R.flushInline();
      const c = R.card(b.dataset.bookmark);
      c.saved = !c.saved;
      R.save();
      R.render();
      if (modal.open && modalKind === "reader")
        R.openReader(modalCard);
      return;
    }
    if (b.dataset.settingsTab) {
      R.customize(b.dataset.settingsTab);
      return;
    }
    if (b.dataset.templateSelect) {
      selectedTemplate = b.dataset.templateSelect;
      R.customize("templates");
      return;
    }
    if (b.dataset.accent) {
      R.data.prefs.accent = b.dataset.accent === "default" ? "" : b.dataset.accent;
      R.save();
      R.render();
      R.customize("feel");
      return;
    }
    if (b.dataset.format) {
      const area = document.querySelector(".editor-body");
      if (!area)
        return;
      const { selectionStart: start, selectionEnd: end } = area, selected = area.value.slice(start, end);
      const replacement = b.dataset.format === "bold" ? `**${selected || "a detail to keep"}**` : b.dataset.format === "code" ? `
\`\`\`
${selected || "// a bit of code"}
\`\`\`
` : (selected || "a small thought").split(`
`).map((x) => "- " + x).join(`
`);
      area.setRangeText(replacement, start, end, "end");
      area.focus();
      R.saveDraft();
      return;
    }
    if (b.dataset.reference) {
      const path = b.dataset.reference;
      R.showModal(`${R.modalTop("A WAY BACK TO THE CODE")}<h2 id="modal-title">A little breadcrumb.</h2><p class="modal-intro">A saved reference for later. Opening it in your editor comes with the extension.</p><div class="reference-path">${E(path)}</div><input class="settings-input" readonly value="${E(path)}" id="reference-copy" aria-label="Saved file reference"><div class="dialog-actions">${R.btn(`${I("copy")}Copy the path`, "copy-reference", "button primary")}</div>`, "reference");
    }
  });
  document.addEventListener("input", (event) => {
    const el = event.target;
    if (el.id === "folder-name") {
      document.querySelector("#folder-live-title").textContent = el.value.trim() || "Your new folder";
    }
    if (el.hasAttribute("data-global-search"))
      R.searchResults(el.value);
    if (el.hasAttribute("data-search")) {
      R.flushInline();
      R.ui.query = el.value;
      R.ui.selected = "";
      R.render();
    }
    if (el.hasAttribute("data-inline-id")) {
      inlinePending = { id: el.dataset.inlineId, body: el.value };
      clearTimeout(inlineTimer);
      inlineTimer = setTimeout(R.flushInline, 1200);
      const label = document.querySelector("#inline-save");
      if (label)
        label.textContent = "Keeping your thought…";
    }
    if (el.closest("#note-form"))
      R.saveDraft();
    if (el.dataset.templateName) {
      R.template(el.dataset.templateName).name = el.value;
      R.save();
    }
    if (el.dataset.fieldLabel) {
      const f = R.template(selectedTemplate).fields.find((f) => f.id === el.dataset.fieldLabel);
      if (f) {
        f.label = el.value;
        R.save();
      }
    }
    if (el.dataset.fieldOptions) {
      const f = R.template(selectedTemplate).fields.find((f) => f.id === el.dataset.fieldOptions);
      if (f) {
        f.options = el.value;
        R.save();
      }
    }
    if (el.dataset.columnName) {
      const c = R.data.columns.find((c) => c.id === el.dataset.columnName);
      if (c) {
        c.name = el.value;
        R.refreshStatuses();
        R.save();
      }
    }
  });
  document.addEventListener("change", (event) => {
    const el = event.target;
    if (el.hasAttribute("data-project-select")) {
      if (el.value === "__new_project__")
        R.projectForm(true);
      else
        R.setProject(el.value);
    }
    if (el.hasAttribute("data-nested")) {
      R.ui.includeNested = el.checked;
      R.render();
    }
    if (el.hasAttribute("data-status-id")) {
      R.mutate(el.dataset.statusId, { status: el.value }, "Moved on the board");
    }
    if (el.hasAttribute("data-editor-project")) {
      document.querySelector("#editor-folder").innerHTML = R.folderOptions(el.value);
      R.saveDraft();
    }
    if (el.hasAttribute("data-editor-template")) {
      R.saveDraft();
      R.openEditor(editingId);
      const details = document.querySelector(".note-extras");
      if (details)
        details.open = true;
    }
    if (el.hasAttribute("data-field-type")) {
      const f = R.template(selectedTemplate).fields.find((f) => f.id === el.dataset.fieldType);
      if (f) {
        f.type = el.value;
        R.save();
        R.customize("templates");
      }
    }
    if (el.hasAttribute("data-column-color")) {
      const c = R.data.columns.find((c) => c.id === el.dataset.columnColor);
      if (c) {
        c.color = el.value;
        R.save();
        R.customize("board");
      }
    }
    if (el.hasAttribute("data-pref")) {
      R.data.prefs[el.dataset.pref] = el.type === "checkbox" ? el.checked : el.value;
      if (el.dataset.pref === "includeNested")
        R.ui.includeNested = el.checked;
      R.save();
      R.render();
    }
  });
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (form.id === "note-form") {
      event.preventDefault();
      const draft = R.collectDraft();
      draft.title = draft.title.trim() || draft.body.trim().split(`
`)[0].slice(0, 110) || "Untitled note";
      const links = draft.links.split(`
`).map((x) => x.trim()).filter(Boolean);
      if (links.some((u) => {
        try {
          return !["https:", "http:"].includes(new URL(u).protocol);
        } catch {
          return true;
        }
      })) {
        R.toast("Use a full http:// or https:// address for each link.");
        for (const details of form.elements.links.closest("form").querySelectorAll("details"))
          details.open = true;
        form.elements.links.focus();
        return;
      }
      draft.links = links.join(`
`);
      const existing = editingId ? R.card(editingId) : null, beforeSave = existing ? structuredClone(existing) : null;
      if (existing) {
        R.snapshot(existing, "A new checkpoint");
        const history = existing.history;
        Object.assign(existing, structuredClone(draft), { history, updated: Date.now() });
      } else {
        draft.updated = Date.now();
        R.data.cards.unshift(structuredClone(draft));
      }
      const saved = R.save();
      if (!saved) {
        if (existing)
          R.data.cards[R.data.cards.indexOf(existing)] = beforeSave;
        else
          R.data.cards = R.data.cards.filter((c) => c.id !== draft.id);
        R.saveDraft();
        R.toast("Could not save. Your draft is still open.");
        return;
      }
      try {
        localStorage.removeItem("relay-studio-draft:" + (editingId || "new"));
      } catch {}
      R.ui.project = draft.project;
      R.ui.selected = draft.id;
      R.ui.query = "";
      R.ui.scope = "all";
      if (R.ui.folder && R.ui.folder !== draft.folder)
        R.ui.folder = draft.folder;
      modal.close();
      returnToEditor = false;
      R.render();
      if (saved)
        R.toast(existing ? "Changes saved" : "Note saved");
      editorDraft = null;
    }
    if (form.id === "quick-capture") {
      event.preventDefault();
      R.flushInline();
      const title = form.elements.thought.value.trim();
      if (!title)
        return;
      const now = Date.now(), c = { id: crypto.randomUUID(), project: R.ui.project, folder: R.ui.folder, title, body: "", tried: "", next: "", blocked: "", status: R.data.columns[0].id, template: "blank", values: {}, files: [], branch: "", links: "", tags: [], attachments: [], created: now, updated: now, history: [], saved: false, archived: false };
      R.data.cards.unshift(c);
      const saved = R.save();
      R.ui.selected = c.id;
      R.ui.query = "";
      R.render();
      if (saved)
        R.toast("Thought caught. You can add to it later.");
    }
    if (form.id === "folder-form") {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form)), name = values.name.trim(), id = form.dataset.id, existing = id ? R.folder(id) : null, project = existing?.project || R.ui.project;
      if (!name)
        return;
      if (values.parent && (!R.folder(values.parent) || R.folder(values.parent).project !== project || id && R.descendants(id).has(values.parent))) {
        R.toast("Choose a home outside this folder and its smaller corners.");
        return;
      }
      if (R.data.folders.some((f) => f.id !== id && f.project === project && f.parent === values.parent && f.name.toLowerCase() === name.toLowerCase())) {
        R.toast("There’s already a folder with that name in this corner.");
        return;
      }
      const f = { id: id || crypto.randomUUID(), project, name, description: values.description.trim(), parent: values.parent || "", view: values.view || "", template: values.template || "", icon: R.paths[values.icon] ? values.icon : "folder", color: /^#[a-f\d]{6}$/i.test(values.color || "") ? values.color : "" };
      if (existing)
        Object.assign(existing, f);
      else
        R.data.folders.push(f);
      R.data.prefs.organization ||= {};
      R.data.prefs.organization[project] = "folders";
      R.save();
      R.ui.folder = f.id;
      R.ui.scope = "all";
      R.ui.view = "";
      R.ui.query = "";
      R.ui.sideOpen = false;
      modal.close();
      R.render();
      R.toast(existing ? "Folder updated." : "Folder created. Add a note whenever you like.");
    }
    if (form.id === "project-form") {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form)), name = values.name.trim(), old = R.ui.project, create = form.dataset.create === "true";
      if (!name)
        return;
      if (R.data.projects.some((p) => p.toLowerCase() === name.toLowerCase() && (create || p !== old))) {
        R.toast("There’s already a project with that name.");
        return;
      }
      if (create)
        R.data.projects.push(name);
      else if (name !== old) {
        R.data.projects[R.data.projects.indexOf(old)] = name;
        R.data.cards.filter((c) => c.project === old).forEach((c) => c.project = name);
        R.data.folders.filter((f) => f.project === old).forEach((f) => f.project = name);
        delete R.data.projectDetails[old];
      }
      R.data.projectDetails[name] = { description: values.description.trim(), color: values.color, logo: values.logo || "" };
      R.save();
      modal.close();
      R.setProject(name);
      R.toast(create ? "A new place to make something." : "This space sounds a little more like you.");
    }
  });
  modal.addEventListener("cancel", (event) => {
    if (returnToEditor && modalKind !== "editor") {
      event.preventDefault();
      R.closeModal();
      return;
    }
    if (modalKind === "editor")
      R.saveDraft();
    R.render();
  });
  document.addEventListener("keydown", (event) => {
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName) || event.target.isContentEditable;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (!modal.open)
        R.openSearch();
      return;
    }
    if (typing || event.ctrlKey || event.metaKey || event.altKey || modal.open)
      return;
    if (event.key === "/") {
      event.preventDefault();
      document.querySelector("[data-search]")?.focus();
    }
    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      R.openEditor();
    }
  });
  document.addEventListener("focusout", (event) => {
    if (event.target.hasAttribute("data-inline-id"))
      R.flushInline();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      R.flushInline();
      if (modalKind === "editor" && modal.open)
        R.saveDraft();
    }
  });
  window.addEventListener("beforeunload", () => {
    R.flushInline();
    if (modalKind === "editor" && modal.open)
      R.saveDraft();
  });
  document.addEventListener("dragstart", (event) => {
    const c = event.target.closest("[data-drag-id]");
    if (!c)
      return;
    dragId = c.dataset.dragId;
    event.dataTransfer.setData("text/plain", dragId);
    event.dataTransfer.effectAllowed = "move";
    c.classList.add("dragging");
  });
  document.addEventListener("dragover", (event) => {
    const lane = event.target.closest("[data-drop-status]"), attachment = event.target.closest("[data-attachment-drop]");
    if (attachment && modalKind === "editor") {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      return;
    }
    if (!lane || !dragId)
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    document.querySelectorAll(".drag-over").forEach((x) => x.classList.remove("drag-over"));
    lane.classList.add("drag-over");
  });
  document.addEventListener("drop", (event) => {
    const attachment = event.target.closest("[data-attachment-drop]");
    if (attachment && modalKind === "editor" && event.dataTransfer.files.length) {
      event.preventDefault();
      R.attachFiles(event.dataTransfer.files);
      return;
    }
    const lane = event.target.closest("[data-drop-status]");
    if (!lane || !dragId)
      return;
    event.preventDefault();
    const c = R.card(dragId);
    if (c && c.status !== lane.dataset.dropStatus)
      R.mutate(c.id, { status: lane.dataset.dropStatus }, "Moved on the board");
    dragId = "";
    document.querySelectorAll(".drag-over,.dragging").forEach((x) => x.classList.remove("drag-over", "dragging"));
  });
  document.addEventListener("dragend", () => {
    dragId = "";
    document.querySelectorAll(".drag-over,.dragging").forEach((x) => x.classList.remove("drag-over", "dragging"));
  });
  document.addEventListener("paste", (event) => {
    if (modalKind !== "editor" || !modal.open)
      return;
    const files = [...event.clipboardData?.files || []].filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      event.preventDefault();
      R.attachFiles(files);
    }
  });
  document.querySelector("#attachment-input").addEventListener("change", (event) => {
    const files = event.target.files;
    if (files.length)
      R.attachFiles(files);
    event.target.value = "";
  });
  R.validStudio = (s) => {
    if (!R.valid(s) || !Array.isArray(s.folders) || s.version !== 3 || !Array.isArray(s.columns) || !s.columns.length || !Array.isArray(s.templates) || !s.templates.length || !s.prefs || !s.projectDetails)
      return false;
    if (!s.columns.every((c) => c && typeof c.id === "string" && typeof c.name === "string" && /^#[a-f\d]{6}$/i.test(c.color)))
      return false;
    if (!s.templates.every((t) => t && typeof t.id === "string" && typeof t.name === "string" && Array.isArray(t.fields) && t.fields.every((f) => f && typeof f.id === "string" && typeof f.label === "string" && (f.options === undefined || typeof f.options === "string") && ["short", "long", "check", "select", "date", "link", "checklist", "choice", "rating", "number", "email", "time", "code"].includes(f.type))))
      return false;
    if (new Set(s.cards.map((c) => c.id)).size !== s.cards.length || new Set(s.folders.map((f) => f.id)).size !== s.folders.length)
      return false;
    if (!s.cards.every((c) => c.values && typeof c.values === "object" && !Array.isArray(c.values) && Number.isFinite(c.updated) && typeof c.body === "string" && typeof c.links === "string" && typeof c.branch === "string" && Array.isArray(c.tags) && c.tags.every((t) => typeof t === "string") && Array.isArray(c.attachments) && c.attachments.every((a) => a && typeof a.id === "string" && typeof a.name === "string" && typeof a.type === "string") && Array.isArray(c.history) && c.history.every((h) => h && Number.isFinite(h.at)) && s.columns.some((col) => col.id === c.status) && s.templates.some((t) => t.id === c.template)))
      return false;
    const byId = new Map(s.folders.map((f) => [f.id, f]));
    for (const f of s.folders) {
      if (typeof f.parent !== "string")
        return false;
      const seen = new Set([f.id]);
      let parent = f.parent;
      while (parent) {
        if (seen.has(parent))
          return false;
        seen.add(parent);
        const p = byId.get(parent);
        if (!p || p.project !== f.project)
          return false;
        parent = p.parent;
      }
    }
    return true;
  };
  document.querySelector("#backup-input").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file)
      return;
    if (file.size > 100 * 1024 * 1024) {
      R.toast("Choose a Relay backup smaller than 100 MB.");
      return;
    }
    try {
      const backup = JSON.parse(await file.text());
      if (backup.format !== "relay-studio-v3" || !R.validStudio(backup.state) || !backup.files || typeof backup.files !== "object" || !Object.values(backup.files).every((f) => f && typeof f.id === "string" && typeof f.name === "string" && typeof f.src === "string" && /^data:[^,]*;base64,/i.test(f.src)))
        throw Error("invalid");
      R.pendingImport = backup;
      R.showModal(`${R.modalTop("A QUICK LOOK BEFORE BRINGING IT BACK")}<h2 id="modal-title">Bring this workspace back?</h2><p class="modal-intro">${E(file.name)}</p><p class="setting-caption">${backup.state.projects.length} projects, ${backup.state.folders.length} folders, and ${backup.state.cards.length} notes. This replaces the current workspace in this browser.</p><p class="settings-help">Take a backup of what’s here first if you want to keep both.</p><div class="dialog-actions">${R.btn("Keep a copy of this workspace", "export-json", "button secondary")}${R.btn("Bring it back", "confirm-import", "button primary")}</div>`, "import");
    } catch {
      R.toast("That doesn’t look like a Relay Studio backup. Your notes are unchanged.");
    }
  });
  R.searchResults = (query) => {
    const q = query.trim().toLowerCase(), notes = R.all().filter((c) => [c.title, c.body, c.tried, c.next, c.branch, c.project, c.links, ...c.files, ...c.tags, ...Object.values(c.values || {}), R.folderLabel(c.folder)].join(" ").toLowerCase().includes(q)).slice(0, 50);
    document.querySelector("#global-search-results").innerHTML = notes.length ? notes.map((c) => `<button data-global-open="${E(c.id)}">${I("file")}<div><strong>${E(c.title)}</strong><small>${E(c.project)} / ${E(R.folderLabel(c.folder) || "A loose thought")}${c.archived ? " · Archive" : ""}</small><p>${E(R.noteExcerpt(c))}</p></div>${I("arrow")}</button>`).join("") : '<p class="settings-empty">Nothing quite like that. Try another word.</p>';
  };
  R.openSearch = () => {
    R.flushInline();
    R.showModal(`${R.modalTop("ACROSS ALL YOUR PROJECTS")}<h2 id="modal-title">Find that thought.</h2><label class="global-search-field">${I("search")}<input data-global-search placeholder="A word, a path, something you remember…" aria-label="Search all projects" autofocus></label><div id="global-search-results"></div>`, "search");
    R.searchResults("");
    document.querySelector("[data-global-search]").focus();
  };
  R.render();
  let previousBreakpoint = innerWidth <= 520 ? 0 : innerWidth <= 760 ? 1 : 2;
  window.addEventListener("resize", () => {
    const breakpoint = innerWidth <= 520 ? 0 : innerWidth <= 760 ? 1 : 2;
    if (breakpoint !== previousBreakpoint) {
      R.flushInline();
      previousBreakpoint = breakpoint;
      R.render();
    }
  });
  R.data.prefs.organization ||= {};
  R.paths.eye = "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0";
  R.usesFolders = () => R.data.prefs.organization[R.ui.project] ? R.data.prefs.organization[R.ui.project] === "folders" : R.data.folders.some((f) => f.project === R.ui.project);
  const { sidebar: oldSidebar, folderCards: oldFolders, studio: oldStudio, collectionHeader: oldCollectionHeader, folderForm: oldFolderForm, noteContents: oldNoteContents } = R;
  R.sidebar = () => {
    let html = oldSidebar().replace("Everything", "All notes");
    const start = html.indexOf('<div class="side-section">'), end = html.indexOf('<div class="sidebar-bottom">');
    if (!R.usesFolders())
      html = html.slice(0, start) + `<div class="notes-only-hint">A notebook without the filing.<button data-action="organize">Add folders whenever you like ${I("arrow")}</button></div>` + html.slice(end);
    else
      html = html.slice(0, end) + R.btn(`${I("settings")}Organize folders`, "organize", "side-add") + html.slice(end);
    return html.replace("Make it yours</button>", "Templates & settings</button>");
  };
  R.folderCards = () => {
    if (!R.usesFolders() || !R.childFolders().length)
      return "";
    let html = oldFolders().replace("Organize things your way. Nothing here is fixed.", "Notes and subfolders can live together.");
    const tile = html.indexOf('<button class="new-folder-tile"');
    if (tile >= 0)
      html = html.slice(0, tile) + "</div></section>";
    return html;
  };
  R.studio = () => oldStudio().replace('<div class="studio-heading">', `${R.ui.project === "Tabs" && R.data.cards.some((c) => /^s[1-7]$/.test(c.id) && c.project === "Tabs") ? '<div class="demo-label"><span>Example workspace · These notes and folders are here to explore.</span><button data-action="new-project">Start your own project →</button></div>' : ""}<div class="studio-heading">`).replace(R.btn(`${I("folder")}New folder`, "new-folder", "button secondary"), R.btn(`${I("settings")}Organize`, "organize", "button secondary"));
  R.collectionHeader = () => oldCollectionHeader("Your notes") + `<div class="collection-context"><span>${R.view() === "board" ? `${I("board")} Same notes, arranged by stage.` : `${I("file")} ${R.ui.folder ? "Notes in " + E(R.folderLabel(R.ui.folder)) + (R.ui.includeNested ? " and its subfolders." : ".") : "All notes in " + E(R.ui.project) + (R.usesFolders() ? ", including folders." : ".")}`}</span>${R.view() === "board" ? R.btn("Edit board columns", "customize", "quiet-button", 'data-tab="board"') : R.btn(R.usesFolders() ? "Change organization" : "Notes only · change", "organize", "quiet-button")}</div>${R.view() === "board" ? `<p class="board-source">Showing ${R.cards().length} notes from ${E(R.ui.folder ? R.folderLabel(R.ui.folder) : R.ui.project)}${R.ui.folder ? R.ui.includeNested ? " and its subfolders" : " only" : " across this project"}. Drag a note to change its stage. Columns are shared across projects.</p>` : ""}`;
  R.noteContents = (c) => oldNoteContents(c) + `<div class="note-location">${I("folder")} ${E(R.folderLabel(c.folder) || "Loose in " + c.project)} ${R.btn("Move note", "move-note", "quiet-button", `data-id="${E(c.id)}"`)}</div>`;
  R.folderForm = (id) => {
    oldFolderForm(id);
    if (id) {
      modalContent.querySelector(".folder-form-footer").insertAdjacentHTML("beforebegin", `<div class="folder-management">${R.btn(`${I("trash")}Delete folder…`, "delete-folder", "danger-link", `data-id="${E(id)}"`)}${R.btn("Organize all folders", "organize", "quiet-button")}</div>`);
      const detail = modalContent.querySelector(".folder-extras");
      detail.open = true;
      detail.querySelector("summary").textContent = "Location & preferences";
    }
  };
  R.organize = () => {
    const folders = R.data.folders.filter((f) => f.project === R.ui.project), enabled = R.usesFolders();
    const rows = (parent) => folders.filter((f) => f.parent === parent).map((f, i, a) => `<div class="organize-row" style="--depth:${R.trail(f.id).length - 1}"><span class="organize-folder">${I("folder")}<span><strong>${E(f.name)}</strong><small>${R.folderCount(f.id)} ${R.folderCount(f.id) === 1 ? "note" : "notes"} · ${E(R.folder(f.parent)?.name || "Project root")}</small></span></span><div>${R.btn(I("up"), "folder-up", "icon-button", `data-id="${E(f.id)}" aria-label="Move ${E(f.name)} up" ${i === 0 ? "disabled" : ""}`)}${R.btn(I("down"), "folder-down", "icon-button", `data-id="${E(f.id)}" aria-label="Move ${E(f.name)} down" ${i === a.length - 1 ? "disabled" : ""}`)}${R.btn("Edit / move", "folder-options", "quiet-button", `data-id="${E(f.id)}"`)}${R.btn(I("trash"), "delete-folder", "icon-button", `data-id="${E(f.id)}" aria-label="Delete ${E(f.name)}"`)}</div></div>${rows(f.id)}`).join("");
    R.showModal(`${R.modalTop("ORGANIZATION")}<h2 id="modal-title">Folder organization</h2><p class="modal-intro">Choose for ${E(R.ui.project)}. You can change your mind anytime.</p><div class="organization-choices">${[["notes", "file", "Just notes", "One place for everything. No folders to manage."], ["folders", "folder", "Notes + folders", "Keep notes anywhere. Nest folders when it helps."]].map(([id, icon, title, desc]) => `<button data-action="organization-mode" data-value="${id}" class="${enabled === (id === "folders") ? "selected" : ""}" aria-pressed="${enabled === (id === "folders")}">${I(icon)}<strong>${title}</strong><span>${desc}</span></button>`).join("")}</div>${!enabled && folders.length ? '<p class="organization-notice">Your existing folders are tucked away, and all their notes are visible together. Choose “Notes + folders” to bring the structure back.</p>' : ""}${enabled ? `<div class="section-line"><h3>Your folders</h3>${R.btn(`${I("plus")}New folder`, "new-folder", "button secondary")}</div><p class="settings-help">Use the arrows to reorder. “Edit / move” lets you choose a parent folder or the project root.</p><div class="organize-tree">${rows("") || '<p class="settings-empty">No folders yet. A note can stay at the project root, too.</p>'}</div>` : ""}${R.data.folderUndo ? `<div class="undo-folder">Last removed: ${E(R.data.folderUndo.folder.name)} ${R.btn("Undo folder deletion", "undo-folder", "quiet-button")}</div>` : ""}<div class="organization-footer">${R.btn("Done", "close", "button primary")}</div>`, "organization");
  };
  R.deleteFolder = (id) => {
    const f = R.folder(id);
    if (!f)
      return;
    const notes = R.data.cards.filter((c) => c.folder === id).length, children = R.data.folders.filter((x) => x.parent === id).length;
    R.showModal(`${R.modalTop("YOUR NOTES STAY WITH YOU")}<h2 id="modal-title">Remove “${E(f.name)}”?</h2><p class="modal-intro">Its ${notes} direct ${notes === 1 ? "note" : "notes"} and ${children} ${children === 1 ? "subfolder" : "subfolders"} will move to <strong>${E(R.folder(f.parent)?.name || f.project + " · project root")}</strong>. Everything inside those subfolders stays together.</p><p class="settings-help">Only this folder is removed. You can undo the most recent folder deletion from Organize.</p><div class="dialog-actions">${R.btn("Keep folder", "organize", "button secondary")}${R.btn("Remove folder, keep contents", "confirm-delete-folder", "button primary", `data-id="${E(id)}"`)}</div>`, "folder-delete");
  };
  actions.organize = R.organize;
  actions["organization-mode"] = (b) => {
    R.data.prefs.organization[R.ui.project] = b.dataset.value;
    R.ui.folder = "";
    R.save();
    R.render();
    R.organize();
  };
  actions["delete-folder"] = (b) => R.deleteFolder(b.dataset.id);
  actions["confirm-delete-folder"] = (b) => {
    const f = R.folder(b.dataset.id);
    if (!f)
      return;
    const direct = R.data.cards.filter((c) => c.folder === f.id), children = R.data.folders.filter((x) => x.parent === f.id);
    R.data.folderUndo = { folder: structuredClone(f), notes: direct.map((c) => c.id), children: children.map((x) => x.id) };
    direct.forEach((c) => c.folder = f.parent);
    children.forEach((x) => x.parent = f.parent);
    R.data.folders = R.data.folders.filter((x) => x.id !== f.id);
    if (R.ui.folder === f.id)
      R.ui.folder = f.parent;
    R.save();
    R.render();
    R.organize();
    R.toast("Folder removed. All its contents are kept. Undo is available here.");
  };
  actions["undo-folder"] = () => {
    const u = R.data.folderUndo;
    if (!u)
      return;
    const f = u.folder;
    if (!R.data.projects.includes(f.project)) {
      R.toast("The original project is no longer available.");
      return;
    }
    if (f.parent && (!R.folder(f.parent) || u.children.some((id) => R.descendants(id).has(f.parent))))
      f.parent = "";
    if (R.data.folders.some((x) => x.project === f.project && x.parent === f.parent && x.name === f.name))
      f.name += " (restored)";
    R.data.folders.push(f);
    u.notes.forEach((id) => {
      const c = R.card(id);
      if (c && c.project === f.project && c.folder === f.parent)
        c.folder = f.id;
    });
    u.children.forEach((id) => {
      const child = R.folder(id);
      if (child && child.project === f.project && child.parent === f.parent)
        child.parent = f.id;
    });
    delete R.data.folderUndo;
    R.save();
    R.render();
    R.organize();
    R.toast("Folder restored.");
  };
  for (const [action, offset] of [["folder-up", -1], ["folder-down", 1]])
    actions[action] = (b) => {
      const f = R.folder(b.dataset.id);
      if (!f)
        return;
      const peers = R.data.folders.filter((x) => x.project === f.project && x.parent === f.parent), index = peers.indexOf(f), other = peers[index + offset];
      if (!other)
        return;
      const a = R.data.folders.indexOf(f), z = R.data.folders.indexOf(other);
      [R.data.folders[a], R.data.folders[z]] = [R.data.folders[z], R.data.folders[a]];
      R.save();
      R.render();
      R.organize();
    };
  actions["move-note"] = (b) => {
    const c = R.card(b.dataset.id);
    if (!c)
      return;
    R.showModal(`${R.modalTop("FIND A HOME FOR THIS THOUGHT")}<h2 id="modal-title">Move your note.</h2><p class="modal-intro">${E(c.title)}</p><form id="move-note-form" data-id="${E(c.id)}" class="simple-form"><label>Where it lives<select name="folder">${R.folderOptions(c.project, c.folder)}</select></label><p class="settings-help">Choose “Loose in ${E(c.project)}” to keep it without a folder.</p><button class="button primary" type="submit">Move note ${I("arrow")}</button></form>`, "move-note");
  };
  document.addEventListener("submit", (event) => {
    if (event.target.id !== "move-note-form")
      return;
    event.preventDefault();
    const form = event.target, c = R.card(form.dataset.id), folder = form.elements.folder.value;
    if (!c)
      return;
    if (folder && R.folder(folder)?.project !== c.project)
      return;
    R.mutate(c.id, { folder }, "Moved to another folder");
    R.openReader(c.id);
    R.toast("Note moved.");
  });
  let templatePreview = false;
  R.templateSettings = () => {
    const t = R.template(selectedTemplate);
    selectedTemplate = t.id;
    const types = [["short", "Short answer"], ["long", "Paragraph"], ["check", "Checkbox"], ["select", "Dropdown"], ["date", "Date"], ["link", "Link"]];
    return `<div class="page-builder"><div class="builder-heading"><div><p class="setting-caption">Start with a blank page. Add only the prompts you’d like to see again.</p><span class="autosaved">${I("check")} Changes save as you go</span></div>${R.btn(templatePreview ? `${I("edit")}Back to editing` : `${I("eye")}Preview page`, "preview-template", "button secondary")}</div><div class="settings-template-grid"><nav class="template-list" aria-label="Note templates">${R.data.templates.map((x) => `<button data-template-select="${E(x.id)}" class="${x.id === t.id ? "active" : ""}">${E(x.name)}${R.data.prefs.template === x.id ? " · default" : ""}</button>`).join("")}${R.btn(`${I("plus")}New template`, "add-template", "quiet-button")}</nav><div class="question-canvas">${templatePreview ? `<div class="template-preview"><span class="eyebrow">PREVIEW · NOTHING HERE BECOMES A NOTE</span><h3>${E(t.name)}</h3><label>Note title<input placeholder="Give this a name…"></label><label>Your thoughts<textarea rows="4" placeholder="Room to write, always."></textarea></label>${t.fields.map((f) => R.customField(f, { values: {} })).join("")}<p class="settings-help">Every prompt is optional. Close this preview to keep editing.</p></div>` : `<div class="template-title-card"><label>Template name<input data-template-name="${E(t.id)}" value="${E(t.name)}" aria-label="Template name"></label><div>${R.btn(R.data.prefs.template === t.id ? "Default template" : "Use by default", "default-template", "quiet-button", `data-id="${E(t.id)}"`)}${R.btn("Duplicate", "duplicate-template", "quiet-button")}${R.data.templates.length > 1 ? R.btn(I("trash"), "remove-template", "icon-button", `data-id="${E(t.id)}" aria-label="Delete template and keep existing answers"`) : ""}</div><p>Your note always starts with a title and room to write.</p></div>${t.fields.map((f, i) => `<article class="question-card"><div class="question-card-heading"><span>Prompt ${i + 1}</span><select data-field-type="${E(f.id)}" aria-label="Answer format for prompt ${i + 1}">${types.map(([key, name]) => `<option value="${key}" ${key === f.type ? "selected" : ""}>${name}</option>`).join("")}</select></div><input class="question-wording" data-field-label="${E(f.id)}" value="${E(f.label)}" aria-label="Wording for prompt ${i + 1}" placeholder="What would you like to remember?">${f.type === "select" ? `<div class="choice-editor">${(f.options ? f.options.split(",") : [""]).map((option, n) => `<div><span>${n + 1}.</span><input data-choice-field="${E(f.id)}" data-choice-index="${n}" value="${E(option.trim())}" placeholder="Option ${n + 1}" aria-label="Choice ${n + 1} for prompt ${i + 1}">${R.btn(I("close"), "remove-choice", "icon-button", `data-id="${E(f.id)}" data-index="${n}" aria-label="Remove choice ${n + 1}"`)}</div>`).join("")}${R.btn(`${I("plus")}Add option`, "add-choice", "quiet-button", `data-id="${E(f.id)}"`)}</div>` : f.type === "check" ? `<div class="checkbox-wording"><input type="checkbox" disabled aria-label="Checkbox preview"><input data-field-options="${E(f.id)}" value="${E(f.options || "")}" placeholder="Words beside the checkbox" aria-label="Checkbox wording"></div>` : `<div class="answer-placeholder">${{ short: "Short answer goes here", long: "A little room to think out loud…", date: "Day / Month / Year", link: "https://…" }[f.type] || "Your answer"}</div>`}<footer><span>Optional</span><div>${R.btn(I("up"), "field-up", "icon-button", `data-id="${E(f.id)}" aria-label="Move prompt ${i + 1} up" ${i === 0 ? "disabled" : ""}`)}${R.btn(I("down"), "field-down", "icon-button", `data-id="${E(f.id)}" aria-label="Move prompt ${i + 1} down" ${i === t.fields.length - 1 ? "disabled" : ""}`)}${R.btn("Duplicate", "duplicate-field", "quiet-button", `data-id="${E(f.id)}"`)}${R.btn(I("trash"), "remove-field", "icon-button", `data-id="${E(f.id)}" aria-label="Delete prompt ${i + 1} and keep existing answers"`)}</div></footer></article>`).join("")}${!t.fields.length ? '<div class="blank-page-message">A fresh page, just as it is.<p>No prompts to fill out. Add one only if it helps.</p></div>' : ""}${R.btn(`${I("plus")}Add a prompt`, "add-field", "add-question")}<p class="settings-help">Editing a template updates the layout of notes using it. Answers to removed prompts stay with those notes.</p>`}</div></div></div>`;
  };
  actions["preview-template"] = () => {
    templatePreview = !templatePreview;
    R.customize("templates");
  };
  actions["duplicate-template"] = () => {
    const t = structuredClone(R.template(selectedTemplate));
    t.id = crypto.randomUUID();
    t.name += " · copy";
    t.fields.forEach((f) => f.id = crypto.randomUUID());
    R.data.templates.push(t);
    selectedTemplate = t.id;
    R.save();
    R.customize("templates");
  };
  actions["duplicate-field"] = (b) => {
    const t = R.template(selectedTemplate), i = t.fields.findIndex((f) => f.id === b.dataset.id);
    if (i < 0)
      return;
    const f = structuredClone(t.fields[i]);
    f.id = crypto.randomUUID();
    t.fields.splice(i + 1, 0, f);
    R.save();
    R.customize("templates");
  };
  actions["add-choice"] = (b) => {
    const f = R.template(selectedTemplate).fields.find((f) => f.id === b.dataset.id);
    if (!f)
      return;
    const choices = f.options ? f.options.split(",") : [""];
    choices.push("Option " + (choices.length + 1));
    f.options = choices.join(",");
    R.save();
    R.customize("templates");
  };
  actions["remove-choice"] = (b) => {
    const f = R.template(selectedTemplate).fields.find((f) => f.id === b.dataset.id);
    if (!f)
      return;
    const choices = (f.options || "").split(",");
    choices.splice(Number(b.dataset.index), 1);
    f.options = choices.join(",");
    R.save();
    R.customize("templates");
  };
  document.addEventListener("input", (event) => {
    const el = event.target;
    if (!el.hasAttribute("data-choice-field"))
      return;
    const f = R.template(selectedTemplate).fields.find((f) => f.id === el.dataset.choiceField);
    if (!f)
      return;
    const choices = (f.options || "").split(",");
    choices[Number(el.dataset.choiceIndex)] = el.value.replaceAll(",", "");
    f.options = choices.join(",");
    R.save();
  });
  const originalBoardSettings = R.boardSettings;
  R.boardSettings = () => `<div class="board-explainer">${I("board")}<div><strong>Your board columns</strong><p>Rename or reorder columns below. These columns are shared across projects.</p></div></div>` + originalBoardSettings();
  const originalCustomize = R.customize;
  R.customize = (...args) => {
    originalCustomize(...args);
    modalContent.querySelector(".choice-tabs")?.setAttribute("aria-label", "Workspace settings");
    for (const button of modalContent.querySelectorAll("[data-settings-tab]"))
      button.textContent = { templates: "Templates", board: "Board columns", feel: "Appearance", data: "Backup" }[button.dataset.settingsTab];
  };
  actions.customize = (b) => R.customize(b.dataset.tab || "templates", !!b.dataset.fromEditor);
  R.switchMode = () => {};
  const cleanURL = new URL(location.href);
  cleanURL.searchParams.delete("v");
  history.replaceState(null, "", cleanURL);
  R.render();
  const originalOpenEditor = R.openEditor;
  R.syncEditorOrganization = () => {
    const form = document.querySelector("#note-form");
    if (!form)
      return;
    const project = form.elements.project.value, mode = R.data.prefs.organization[project], hasFolders = mode ? mode === "folders" : R.data.folders.some((f) => f.project === project);
    form.elements.folder.closest("label").hidden = !hasFolders;
  };
  R.openEditor = (...args) => {
    originalOpenEditor(...args);
    R.syncEditorOrganization();
  };
  actions.edit = (b) => R.openEditor(b.dataset.id);
  document.addEventListener("change", (event) => {
    if (event.target.hasAttribute("data-editor-project"))
      R.syncEditorOrganization();
  });
  R.commitChange = (operation) => {
    const before = structuredClone(R.data);
    try {
      const result = operation();
      if (!R.save()) {
        R.data = before;
        R.refreshStatuses();
        R.render();
        R.toast("Nothing was deleted. Storage could not save this change.");
        return null;
      }
      return { result };
    } catch (error) {
      R.data = before;
      R.refreshStatuses();
      R.render();
      R.toast(error.message || "Could not save this change.");
      return null;
    }
  };
  R.deleteFolder = (id) => {
    const folder = R.folder(id);
    if (!folder)
      return;
    const ids = subtreeIds(R.data, id), notes = R.data.cards.filter((note) => note.project === folder.project && ids.has(note.folder)).length;
    const directNotes = R.data.cards.filter((note) => note.folder === id).length, directFolders = R.data.folders.filter((item) => item.parent === id).length;
    R.showModal(`${R.modalTop("CHOOSE WHAT GOES WITH IT")}<h2 id="modal-title">Delete “${E(folder.name)}”?</h2><p class="modal-intro">Keep what’s inside, or clear out the whole folder in one go.</p><div class="delete-options"><section><span class="delete-option-icon">${I("folder")}</span><div><h3>Only the folder</h3><p>Move its ${directNotes} direct ${directNotes === 1 ? "note" : "notes"} and ${directFolders} ${directFolders === 1 ? "subfolder" : "subfolders"} to ${E(R.folder(folder.parent)?.name || "the project root")}. Keep all their contents.</p>${R.btn("Remove folder, keep contents", "confirm-delete-folder", "button secondary", `data-id="${E(id)}"`)}</div></section><section class="delete-option-all"><span class="delete-option-icon">${I("trash")}</span><div><h3>Folder + everything inside</h3><p>Move this folder, ${ids.size - 1} nested ${ids.size - 1 === 1 ? "folder" : "folders"}, and ${notes} ${notes === 1 ? "note" : "notes"} to Trash together. Includes notes you’ve archived.</p><small>You can restore the whole structure from Trash.</small>${R.btn(`Move all ${notes} ${notes === 1 ? "note" : "notes"} & folder to Trash`, "trash-folder-tree", "button danger", `data-id="${E(id)}"`)}</div></section></div><div class="dialog-actions">${R.btn("Cancel", "organize", "quiet-button")}</div>`, "folder-delete");
  };
  actions["delete-folder"] = (button) => R.deleteFolder(button.dataset.id);
  const keepFolderContents = actions["confirm-delete-folder"];
  actions["confirm-delete-folder"] = (button) => {
    const before = structuredClone(R.data), oldSave = R.save;
    let saved = false;
    R.save = () => {
      saved = oldSave();
      return saved;
    };
    try {
      keepFolderContents(button);
    } finally {
      R.save = oldSave;
    }
    if (!saved) {
      R.data = before;
      R.render();
      R.organize();
      R.toast("Nothing was removed. Storage could not save this change.");
    }
  };
  actions["trash-folder-tree"] = (button) => {
    R.flushInline();
    const root = R.folder(button.dataset.id);
    if (!root)
      return;
    const parent = root.parent;
    const change = R.commitChange(() => trashFolder(R.data, root.id));
    if (!change)
      return;
    const entry = change.result;
    for (const note of entry.cards) {
      try {
        localStorage.removeItem("relay-studio-draft:" + note.id);
      } catch {}
    }
    if (entry.folders.some((folder) => folder.id === R.ui.folder))
      R.ui.folder = parent;
    R.ui.selected = "";
    R.render();
    R.openTrash();
    R.toast("Folder and contents moved to Trash together.");
  };
  R.openTrash = () => {
    const entries = (R.data.trash || []).filter((entry) => entry.project === R.ui.project || !R.data.projects.includes(entry.project));
    R.showModal(`${R.modalTop("A LITTLE ROOM TO CHANGE YOUR MIND")}<h2 id="modal-title">Trash.</h2><p class="modal-intro">Deleted folders stay here with their notes and nested structure until you delete them permanently.</p><div class="trash-list">${entries.length ? entries.map((entry) => `<article><div class="trash-title">${I("folder")}<div><h3>${E(entry.folders.find((folder) => folder.id === entry.rootId)?.name || "Deleted folder")}</h3><p>${entry.cards.length} ${entry.cards.length === 1 ? "note" : "notes"} · ${entry.folders.length} ${entry.folders.length === 1 ? "folder" : "folders"} · ${R.age(entry.deletedAt)}</p></div></div><div class="trash-actions">${R.btn(`${I("restore")}Restore all`, "restore-folder-tree", "button secondary", `data-id="${E(entry.id)}"`)}${R.btn("Delete permanently…", "delete-trash-entry", "danger-link", `data-id="${E(entry.id)}"`)}</div></article>`).join("") : '<div class="settings-empty">Nothing in Trash. A little breathing room.</div>'}</div><p class="settings-help">Trash stays on this device and is included in full backups.</p>`, "trash");
  };
  actions.trash = R.openTrash;
  actions["restore-folder-tree"] = (button) => {
    const change = R.commitChange(() => restoreFolder(R.data, button.dataset.id));
    if (!change)
      return;
    R.ui.project = change.result.project;
    R.ui.folder = change.result.folder;
    R.ui.scope = "all";
    R.ui.query = "";
    R.ui.view = "";
    R.ui.selected = "";
    R.data.prefs.organization[R.ui.project] = "folders";
    R.save();
    modal.close();
    R.render();
    R.toast("The folder, its notes, and all subfolders are back.");
  };
  actions["delete-trash-entry"] = (button) => {
    const entry = R.data.trash?.find((item) => item.id === button.dataset.id);
    if (!entry)
      return;
    R.showModal(`${R.modalTop("THIS CANNOT BE UNDONE")}<h2 id="modal-title">Delete permanently?</h2><p class="modal-intro">Remove ${entry.folders.length} ${entry.folders.length === 1 ? "folder" : "folders"} and ${entry.cards.length} ${entry.cards.length === 1 ? "note" : "notes"} from Trash. You’ll need a previously saved backup to bring them back.</p><div class="dialog-actions">${R.btn("Keep in Trash", "trash", "button secondary")}${R.btn("Delete permanently", "confirm-delete-trash", "button danger", `data-id="${E(entry.id)}"`)}</div>`, "permanent-delete");
  };
  actions["confirm-delete-trash"] = async (button) => {
    const entry = R.data.trash?.find((item) => item.id === button.dataset.id);
    if (!entry)
      return;
    const change = R.commitChange(() => {
      R.data.trash = R.data.trash.filter((item) => item.id !== entry.id);
      return entry;
    });
    if (!change)
      return;
    const drafts = [];
    try {
      for (let i = 0;i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("relay-studio-draft:")) {
          const draft = R.read(key);
          if (draft?.attachments)
            drafts.push(draft);
        }
      }
    } catch {}
    const retained = new Set([...R.data.cards, ...(R.data.trash || []).flatMap((item) => item.cards), ...drafts].flatMap((note) => (note.attachments || []).map((file) => file.id)));
    await R.filesReady;
    if (R.fileDatabase) {
      try {
        const tx = R.fileDatabase.transaction("files", "readwrite");
        for (const note of entry.cards)
          for (const file of note.attachments || [])
            if (!retained.has(file.id))
              tx.objectStore("files").delete(file.id);
      } catch {}
    }
    R.render();
    R.openTrash();
    R.toast("Deleted permanently from this workspace.");
  };
  const sidebarWithOrganization = R.sidebar;
  R.sidebar = () => sidebarWithOrganization().replace('<div class="sidebar-bottom">', `<button class="side-add trash-nav" data-action="trash">${I("trash")}Trash <small>${(R.data.trash || []).filter((entry) => entry.project === R.ui.project || !R.data.projects.includes(entry.project)).length || ""}</small></button><div class="sidebar-bottom">`);
  const monogram = R.projectMark;
  R.projectMark = (project) => {
    const logo = R.data.projectDetails[project]?.logo;
    return validProjectLogo(logo) ? `<span class="project-initial project-logo"><img src="${E(logo)}" alt="" loading="lazy"></span>` : monogram(project);
  };
  R.projectSelect = () => `<div class="project-picker"><button data-action="project-switcher" class="project-switcher-button" aria-label="Switch project: ${E(R.ui.project)}">${R.projectMark(R.ui.project)}<span>${E(R.ui.project)}</span>${I("down")}</button></div>`;
  R.openProjects = () => R.showModal(`${R.modalTop("YOUR PLACES TO KEEP GOING")}<h2 id="modal-title">Pick a project.</h2><div class="project-menu">${R.data.projects.map((project) => `<div><button data-action="choose-project" data-project="${E(project)}" aria-current="${project === R.ui.project ? "true" : "false"}">${R.projectMark(project)}<span><strong>${E(project)}</strong><small>${R.data.cards.filter((note) => note.project === project && !note.archived).length} notes</small></span>${project === R.ui.project ? I("check") : I("arrow")}</button>${R.btn(I("edit"), "edit-project-logo", "icon-button", `data-project="${E(project)}" aria-label="Edit ${E(project)} name and logo"`)}</div>`).join("")}</div>${R.btn(`${I("plus")}New project`, "new-project", "button secondary")}`, "project-switcher");
  const projectHeader = R.header;
  R.header = () => projectHeader().replace(`<button data-action="root">${E(R.ui.project)}</button>`, `<button class="header-project" data-action="project-switcher" aria-label="Switch project: ${E(R.ui.project)}">${R.projectMark(R.ui.project)}<span>${E(R.ui.project)}</span>${I("down")}</button>`);
  actions["project-switcher"] = R.openProjects;
  actions["choose-project"] = (button) => {
    modal.close();
    R.setProject(button.dataset.project);
  };
  actions["edit-project-logo"] = (button) => {
    R.setProject(button.dataset.project);
    R.projectForm(false);
  };
  const projectFormWithoutLogo = R.projectForm;
  R.projectForm = (create) => {
    projectFormWithoutLogo(create);
    const form = document.querySelector("#project-form"), logo = !create && validProjectLogo(R.data.projectDetails[R.ui.project]?.logo) ? R.data.projectDetails[R.ui.project].logo : "";
    const actionsRow = form.querySelector(".dialog-actions");
    actionsRow.insertAdjacentHTML("beforebegin", `<input type="hidden" name="logo" value="${E(logo)}"><input type="hidden" name="originalProject" value="${E(create ? "" : R.ui.project)}"><div class="project-logo-editor"><div id="project-logo-preview">${logo ? `<img src="${E(logo)}" alt="Current project logo">` : I("grid")}</div><div><strong>A face for this project</strong><p>PNG, JPG or WebP. Stored on this device.</p>${R.btn(`${I("plus")}Choose logo`, "choose-project-logo", "button secondary", 'type="button"')}<input type="file" id="project-logo-file" accept="image/png,image/jpeg,image/webp" hidden>${R.btn("Use initials", "remove-project-logo", "quiet-button", 'type="button"')}</div></div><p class="logo-status" id="logo-status" role="status"></p>`);
  };
  actions["choose-project-logo"] = () => document.querySelector("#project-logo-file")?.click();
  actions["remove-project-logo"] = () => {
    const form = document.querySelector("#project-form");
    if (!form)
      return;
    form.elements.logo.value = "";
    document.querySelector("#project-logo-preview").innerHTML = I("grid");
    document.querySelector("#logo-status").textContent = "Initials will be used when you save.";
  };
  document.addEventListener("change", async (event) => {
    if (event.target.id !== "project-logo-file")
      return;
    const file = event.target.files[0], form = event.target.closest("form"), status = form.querySelector("#logo-status");
    if (!file)
      return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      status.textContent = "Choose a PNG, JPG or WebP smaller than 5 MB.";
      return;
    }
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    status.textContent = "Preparing your logo…";
    try {
      const src = await new Promise((resolve, reject) => {
        const reader = new FileReader;
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const image = new Image;
      image.src = src;
      await image.decode();
      if (!image.width || !image.height)
        throw Error("Invalid image");
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 256 / image.width, 256 / image.height);
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      const logo = canvas.toDataURL("image/png");
      if (!validProjectLogo(logo))
        throw Error("Image too large");
      if (!form.isConnected)
        return;
      form.elements.logo.value = logo;
      form.querySelector("#project-logo-preview").innerHTML = `<img src="${E(logo)}" alt="Your chosen project logo">`;
      status.textContent = "Ready. Save the project to keep this logo.";
    } catch {
      if (form.isConnected)
        status.textContent = "Could not read this image. Try a different PNG or JPG.";
    } finally {
      if (form.isConnected)
        submit.disabled = false;
    }
  });
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (form.id !== "project-form")
      return;
    const old = form.elements.originalProject?.value, name = form.elements.name.value.trim();
    if (old && old !== name && R.ui.project === name && R.data.projects.includes(name)) {
      for (const entry of R.data.trash || [])
        if (entry.project === old) {
          entry.project = name;
          entry.folders.forEach((folder) => folder.project = name);
          entry.cards.forEach((note) => note.project = name);
        }
      if (R.data.prefs.organization?.[old]) {
        R.data.prefs.organization[name] = R.data.prefs.organization[old];
        delete R.data.prefs.organization[old];
      }
      if (R.data.folderUndo?.folder.project === old)
        R.data.folderUndo.folder.project = name;
      R.save();
    }
  });
  R.exportBackup = async () => {
    R.flushInline();
    await R.filesReady;
    const notes = [...R.data.cards, ...(R.data.trash || []).flatMap((entry) => entry.cards)], ids = new Set(notes.flatMap((note) => (note.attachments || []).map((file) => file.id))), files = {};
    for (const id of ids) {
      const file = await R.getFile(id);
      if (file)
        files[id] = file;
    }
    R.download(JSON.stringify({ format: "relay-studio-v3", version: 3, state: R.data, files }, null, 2), "relay-my-workspace.json", "application/json");
  };
  actions["export-json"] = R.exportBackup;
  const validWithoutTrash = R.validStudio;
  R.validStudio = (state) => validWithoutTrash(state) && (!state.trash || Array.isArray(state.trash) && state.trash.every((entry) => entry && typeof entry.id === "string" && typeof entry.project === "string" && Number.isFinite(entry.deletedAt) && typeof entry.rootId === "string" && Array.isArray(entry.folders) && entry.folders.length > 0 && entry.folders.some((folder) => folder.id === entry.rootId) && Array.isArray(entry.cards) && entry.cards.every((note) => note && typeof note.status === "string" && typeof note.template === "string") && validWithoutTrash({ ...state, folders: entry.folders.map((folder) => ({ ...folder, parent: entry.folders.some((item) => item.id === folder.parent) ? folder.parent : "" })), cards: entry.cards.map((note) => ({ ...note, status: state.columns.some((column) => column.id === note.status) ? note.status : state.columns[0].id, template: state.templates.some((template) => template.id === note.template) ? note.template : state.templates[0].id })), projects: [...new Set([...state.projects, entry.project])] })));
  R.render();
  actions["confirm-import"] = async () => {
    const pending = R.pendingImport;
    if (!pending)
      return;
    R.pendingImport = null;
    const original = R.data, incoming = structuredClone(pending.state), added = [];
    incoming.prefs.organization ||= {};
    incoming.trash ||= [];
    if (incoming.folderUndo && (!incoming.folderUndo.folder || !Array.isArray(incoming.folderUndo.notes) || !Array.isArray(incoming.folderUndo.children)))
      delete incoming.folderUndo;
    const notes = [...incoming.cards, ...incoming.trash.flatMap((entry) => entry.cards)], wanted = new Set(notes.flatMap((note) => note.attachments.map((file) => file.id)));
    await R.filesReady;
    if (wanted.size && !R.fileDatabase) {
      R.toast("File storage is unavailable. Your current notebook is unchanged.");
      R.pendingImport = pending;
      return;
    }
    try {
      const ids = new Map;
      for (const id of wanted) {
        const file = pending.files[id];
        if (!file)
          throw Error("The backup is missing an attachment.");
        const replacement = crypto.randomUUID();
        await R.putFile({ ...file, id: replacement });
        ids.set(id, replacement);
        added.push(replacement);
      }
      for (const note of notes)
        for (const file of note.attachments)
          file.id = ids.get(file.id) || file.id;
      R.data = incoming;
      if (!R.save())
        throw Error("Not enough local storage.");
    } catch {
      R.data = original;
      if (R.fileDatabase && added.length) {
        try {
          const tx = R.fileDatabase.transaction("files", "readwrite");
          for (const id of added)
            tx.objectStore("files").delete(id);
        } catch {}
      }
      R.toast("The backup could not be saved. Your current notebook is unchanged.");
      R.pendingImport = pending;
      return;
    }
    R.refreshStatuses();
    Object.assign(R.ui, { project: incoming.projects[0], folder: "", query: "", scope: "all", selected: "", view: "", collapsed: new Set });
    modal.close();
    R.render();
    R.toast("Your notebook is back, including Trash and attachments.");
  };
  R.render();
  R.openProjects = () => {
    R.showModal(`${R.modalTop("PROJECTS")}<h2 id="modal-title">Switch project</h2><label class="picker-search">${I("search")}<input data-picker-search="projects" aria-label="Find a project" placeholder="Find a project…" autocomplete="off"></label><div class="project-menu simple-project-menu">${R.data.projects.map((project) => `<div data-picker-row="${E(project.toLowerCase())}"><button data-action="choose-project" data-project="${E(project)}" aria-current="${project === R.ui.project ? "true" : "false"}">${R.projectMark(project)}<span><strong>${E(project)}</strong><small>${R.data.cards.filter((note) => note.project === project && !note.archived).length} notes</small></span>${project === R.ui.project ? I("check") : ""}</button>${R.btn(I("edit"), "edit-project-logo", "icon-button", `data-project="${E(project)}" aria-label="Edit ${E(project)}"`)}</div>`).join("")}</div><p class="picker-no-results" hidden>No projects found.</p><div class="picker-footer">${R.btn(`${I("plus")}New project`, "new-project", "button secondary")}</div>`, "project-switcher");
    document.querySelector("[data-picker-search]")?.focus();
  };
  actions["project-switcher"] = () => R.openProjects();
  document.addEventListener("input", (event) => {
    const input = event.target;
    if (!input.hasAttribute("data-picker-search"))
      return;
    const query = input.value.trim().toLowerCase();
    let visible = 0;
    modalContent.querySelectorAll("[data-picker-row]").forEach((row) => {
      row.hidden = !row.dataset.pickerRow.includes(query);
      if (!row.hidden)
        visible++;
    });
    const empty = modalContent.querySelector(".picker-no-results");
    if (empty)
      empty.hidden = visible > 0;
  });
  const simpleSettingSections = [["feel", "settings", "General", "Theme, spacing and note defaults"], ["templates", "file", "Templates", "Optional fields for your notes"], ["board", "board", "Board", "Column names, colors and order"], ["data", "export", "Backup & data", "Export and restore your notebook"]];
  R.customize = (tab = "feel", fromEditor = false) => {
    if (fromEditor || modalKind === "editor")
      R.persistEditorBeforeSettings();
    settingsTab = simpleSettingSections.some(([key]) => key === tab) ? tab : "feel";
    const current = simpleSettingSections.find(([key]) => key === settingsTab);
    R.showModal(`<div class="settings-shell">${R.btn(I("close"), "close", "settings-shell-close icon-button", 'aria-label="Close settings"')}<div class="settings-shell-body"><nav class="settings-nav" aria-label="Settings categories"><h2 id="modal-title">Settings</h2>${simpleSettingSections.map(([key, icon, label]) => `<button data-settings-tab="${key}" class="${key === settingsTab ? "active" : ""}" ${key === settingsTab ? 'aria-current="page"' : ""}>${I(icon)}${label}</button>`).join("")}</nav><section class="settings-panel" data-settings-page="${settingsTab}" aria-label="${current[2]}"><header><span class="settings-page-icon">${I(current[1])}</span><h3>${current[2]}</h3><p>${current[3]}</p><small>${settingsTab === "board" ? "Edit a column, then confirm your changes." : settingsTab === "data" ? "A copy for your next chapter." : "Your preferences save automatically."}</small></header>${{ feel: R.feelSettings, templates: R.templateSettings, board: R.boardSettings, data: R.dataSettings }[settingsTab]()}</section></div></div>`, "settings");
    modalContent.querySelector('[data-settings-tab="' + settingsTab + '"]')?.focus();
  };
  actions.customize = (b) => R.customize(b.dataset.tab || "feel", !!b.dataset.fromEditor);
  const simpleProjectForm = R.projectForm;
  R.projectForm = (create) => {
    simpleProjectForm(create);
    const form = document.querySelector("#project-form");
    modalContent.querySelector("#modal-title").textContent = create ? "New project" : "Project settings";
    modalContent.querySelector(".modal-top .eyebrow").textContent = "PROJECT";
    const name = form.elements.name;
    name.closest("label").firstChild.textContent = "Project name";
    name.placeholder = "e.g. Website redesign";
    const extras = document.createElement("details");
    extras.className = "project-optional";
    extras.innerHTML = "<summary>Description, color & logo <small>Optional</small></summary>";
    const actionsRow = form.querySelector(".dialog-actions");
    form.insertBefore(extras, actionsRow);
    for (const el of [form.elements.description.closest("label"), form.elements.color.closest("label"), form.querySelector(".project-logo-editor"), form.querySelector("#logo-status")])
      if (el)
        extras.append(el);
    form.elements.description.closest("label").firstChild.textContent = "Description";
    const submit = actionsRow.querySelector('[type="submit"]');
    submit.textContent = create ? "Create project" : "Save changes";
    name.focus();
  };
  const simpleFolderForm = R.folderForm;
  R.folderForm = (id) => {
    simpleFolderForm(id);
    const form = document.querySelector("#folder-form");
    modalContent.querySelector("#modal-title").textContent = id ? "Folder settings" : "New folder";
    modalContent.querySelector(".modal-top .eyebrow").textContent = "FOLDER";
    modalContent.querySelector(".modal-intro").textContent = id ? "Update the name or location." : "A name is all you need.";
    const extras = form.querySelector(".folder-extras");
    extras.open = false;
    extras.querySelector("summary").innerHTML = `More options ${I("down")}`;
    const personality = form.querySelector(".folder-personality");
    extras.append(personality);
    form.querySelector("#folder-name").placeholder = "Folder name";
  };
  R.folderCards = () => !R.usesFolders() || !R.childFolders().length ? "" : `<section class="folder-section illustrated-folders"><div class="section-line"><h2>Folders</h2>${R.btn(`${I("plus")}New folder`, "new-folder", "quiet-button")}</div><div class="folder-cards">${R.childFolders().map((f, index) => `<article class="illustrated-folder folder-variant-${index % 3}">${R.btn(I("settings"), "folder-options", "folder-card-settings icon-button", `data-id="${E(f.id)}" aria-label="Folder settings: ${E(f.name)}"`)}<button class="illustrated-folder-open" data-folder="${E(f.id)}"><svg class="folder-art" aria-hidden="true" viewBox="0 0 120 86"><path class="folder-art-back" d="M19 27V17a5 5 0 0 1 5-5h26l10 10h35a5 5 0 0 1 5 5v42H19z"/><path class="folder-art-paper" d="M34 14h40l11 11v41H34z"/><path class="folder-art-line" d="M43 29h22m-22 9h30m-30 9h17"/><path class="folder-art-front" d="M17 35h86l-8 39H24z"/><path class="folder-art-stitch" d="M39 53h35"/></svg><h3>${E(f.name)}</h3><div><span>${R.folderCount(f.id)} ${R.folderCount(f.id) === 1 ? "note" : "notes"}</span>${I("arrow")}</div></button></article>`).join("")}</div></section>`;
  const simpleSidebar = R.sidebar;
  R.sidebar = () => simpleSidebar().replace("Templates & settings", "Settings").replace("Find a thought", "Search notes").replace("A notebook without the filing.", "").replace("Add folders whenever you like", "Add folders").replace('data-action="organize">Add folders', 'data-action="new-folder">Add folders').replace(/<button class="side-add" data-action="new-folder">[\s\S]*?<\/button>/, "").replace("Organize folders", "Manage folders");
  const simpleStudio = R.studio;
  R.studio = () => simpleStudio().replace('<span class="eyebrow">A PLACE TO KEEP GOING</span>', "").replace(`<div class="heading-art" aria-hidden="true">${R.illustration(R.mode)}</div>`, "").replace(R.btn("Make this space yours ↗", "customize", "quiet-button"), "").replace(R.btn(`${I("settings")}Organize`, "organize", "button secondary"), R.btn(`${I("folder")}New folder`, "new-folder", "button secondary")).replace("Make a little progress. Leave a little context.", "");
  R.collectionHeader = () => `<div class="collection-header"><h2>Notes <small>${R.cards().length}</small></h2><div>${R.ui.folder ? `<label class="nested-choice"><input type="checkbox" data-nested ${R.ui.includeNested ? "checked" : ""}>Include subfolders</label>` : ""}${R.viewPicker()}${R.view() === "board" ? R.btn(I("settings"), "customize", "icon-button", 'data-tab="board" aria-label="Board settings"') : ""}</div></div>`;
  R.browseFolders = () => {
    R.showModal(`${R.modalTop("FOLDERS")}<h2 id="modal-title">Open a folder</h2><label class="picker-search">${I("search")}<input data-picker-search="folders" aria-label="Find a folder" placeholder="Find a folder…"></label><div class="simple-folder-picker">${R.btn(`${I("grid")}All notes`, "browse-root", "picker-root")}${R.data.folders.filter((f) => f.project === R.ui.project).map((f) => `<button data-browse-folder="${E(f.id)}" data-picker-row="${E(R.folderLabel(f.id).toLowerCase())}">${I("folder")}<span>${E(f.name)}<small>${E(R.folder(f.parent)?.name || R.ui.project)}</small></span><small>${R.folderCount(f.id)}</small></button>`).join("")}</div><p class="picker-no-results" hidden>No folders found.</p><div class="picker-footer">${R.btn(`${I("plus")}New folder`, "new-folder", "button secondary")}</div>`, "folders");
    document.querySelector("[data-picker-search]")?.focus();
  };
  R.render();
  actions["browse-folders"] = () => R.browseFolders();
  if (R.openLocation)
    actions["move-note"] = (button) => {
      const note = R.card(button.dataset.id);
      if (!note)
        return;
      relayLocationContext = { kind: "note", id: note.id };
      returnToEditor = false;
      R.openLocation(note.project, note.folder);
    };
  const quietNoteContents = R.noteContents;
  R.noteContents = (note, ...args) => {
    let html = quietNoteContents(note, ...args);
    if (!note.history.length)
      html = html.replace(/<details class="earlier-thoughts">[\s\S]*?<\/details>/, "");
    return html;
  };
  const focusedStudio = R.studio;
  R.studio = () => {
    let html = focusedStudio();
    if (R.usesFolders() && R.childFolders().length && !R.ui.folder)
      html = html.replace(R.btn(`${I("folder")}New folder`, "new-folder", "button secondary"), "");
    return html;
  };
  let pendingSettingsDeletion = null;
  for (const [action, title, description] of [["remove-field", "Delete this field?", "The field will be removed from this template. Existing answers will stay with your notes."]]) {
    const apply = actions[action];
    actions[action] = (button) => {
      pendingSettingsDeletion = () => apply({ dataset: { ...button.dataset } });
      R.showModal(`${R.modalTop("CONFIRM DELETION").replace('data-action="close"', 'data-action="cancel-settings-delete"')}<div class="confirm-symbol">${I("trash")}</div><h2 id="modal-title">${title}</h2><p class="modal-intro">${description}</p><div class="dialog-actions">${R.btn("Cancel", "cancel-settings-delete", "button secondary")}${R.btn("Delete", "confirm-settings-delete", "button danger")}</div>`, "settings-delete");
    };
  }
  actions["cancel-settings-delete"] = () => {
    pendingSettingsDeletion = null;
    R.customize("templates");
  };
  actions["confirm-settings-delete"] = () => {
    const apply = pendingSettingsDeletion;
    pendingSettingsDeletion = null;
    apply?.();
  };
  (() => {
    const controls = new Map;
    let sequence = 0;
    const button = (text, label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      if (label)
        b.setAttribute("aria-label", label);
      return b;
    };
    const labelFor = (source) => source.getAttribute("aria-label") || [...source.labels || []].map((l) => {
      const clone = l.cloneNode(true);
      clone.querySelectorAll("select,input,textarea,.relay-control").forEach((n) => n.remove());
      return clone.textContent.trim();
    }).join(" ") || source.name || "Choose an option";
    const keyFor = (s) => s.id || [s.closest("form")?.id, s.name, ...Object.entries(s.dataset).flat()].filter(Boolean).join("-") || "control-" + ++sequence;
    const hash = (text) => [...text].reduce((n, c) => Math.imul(31, n) + c.charCodeAt(0) | 0, 0).toString(36).replace("-", "n");
    function enhance(source) {
      const type = source.tagName === "SELECT" ? "select" : source.type;
      const key = keyFor(source), label = labelFor(source), lifetime = new AbortController, opts = { signal: lifetime.signal };
      const wrapper = document.createElement("div");
      wrapper.className = "relay-control relay-control-" + type;
      const trigger = button("", label);
      trigger.className = "relay-control-trigger";
      trigger.id = "relay-control-" + hash(key);
      const panel = document.createElement("div");
      panel.className = "relay-control-panel";
      panel.id = trigger.id + "-panel";
      panel.hidden = true;
      trigger.setAttribute("aria-controls", panel.id);
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-haspopup", type === "select" ? "listbox" : "dialog");
      if (type === "select") {
        trigger.setAttribute("role", "combobox");
        panel.setAttribute("role", "listbox");
      } else {
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", label);
      }
      panel.setAttribute("aria-label", label);
      const description = source.getAttribute("aria-describedby");
      if (description)
        trigger.setAttribute("aria-describedby", description);
      const previous = { hidden: source.hidden, type: source.type, tabindex: source.getAttribute("tabindex") };
      source.before(wrapper);
      wrapper.append(trigger, panel);
      source.hidden = true;
      source.tabIndex = -1;
      if (type !== "select")
        source.type = "hidden";
      let active = 0, month = new Date().getMonth(), year = new Date().getFullYear(), prefix = "", typedAt = 0;
      function close() {
        panel.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        trigger.removeAttribute("aria-activedescendant");
      }
      function sync() {
        trigger.disabled = source.matches(":disabled");
        if (type === "select") {
          const text = source.options[source.selectedIndex]?.textContent || "Choose an option";
          trigger.textContent = text;
          trigger.setAttribute("aria-label", label + ": " + text);
        } else if (type === "color") {
          trigger.textContent = "● " + source.value.toUpperCase();
          trigger.setAttribute("aria-label", label + ": " + source.value);
        } else {
          trigger.textContent = source.value ? new Date(source.value + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Choose a date";
          trigger.setAttribute("aria-label", label + ": " + trigger.textContent);
        }
        if (trigger.disabled)
          close();
      }
      function restoreFocus() {
        queueMicrotask(() => {
          const next = document.getElementById(trigger.id), dialog = document.querySelector("dialog[open]");
          if (next && (!dialog || dialog.contains(next)) && (document.activeElement === document.body || wrapper.contains(document.activeElement)))
            next.focus();
        });
      }
      function commit(value) {
        source.value = value;
        close();
        sync();
        trigger.focus();
        source.dispatchEvent(new Event("input", { bubbles: true }));
        source.dispatchEvent(new Event("change", { bubbles: true }));
        restoreFocus();
      }
      function highlight(index) {
        const items = [...panel.querySelectorAll('[role="option"]')];
        active = index;
        items.forEach((item, i) => item.dataset.active = String(i === index));
        if (items[index]) {
          trigger.setAttribute("aria-activedescendant", items[index].id);
          items[index].scrollIntoView({ block: "nearest" });
        }
      }
      const available = (i) => {
        const option = source.options[i];
        return option && !option.disabled && !(option.parentElement.tagName === "OPTGROUP" && option.parentElement.disabled);
      };
      function renderOptions() {
        panel.replaceChildren();
        [...source.options].forEach((option, index) => {
          const row = document.createElement("div");
          row.id = panel.id + "-" + index;
          row.className = "relay-option";
          row.setAttribute("role", "option");
          row.setAttribute("aria-selected", String(index === source.selectedIndex));
          row.setAttribute("aria-disabled", String(!available(index)));
          row.textContent = option.textContent;
          row.addEventListener("pointerdown", (e) => e.preventDefault(), opts);
          row.addEventListener("click", (e) => {
            e.stopPropagation();
            if (available(index))
              commit(option.value);
          }, opts);
          panel.append(row);
        });
        active = Math.max(0, source.selectedIndex);
        highlight(active);
      }
      function colorRule(b, color) {
        const cls = "relay-color-" + color.slice(1);
        const sheet = document.querySelector('link[href$="controls.css"]')?.sheet;
        if (sheet && !document.querySelector("." + cls)) {
          try {
            sheet.insertRule("." + cls + "{background:" + color + "}", sheet.cssRules.length);
          } catch {}
        }
        b.classList.add(cls);
      }
      function renderColors() {
        panel.replaceChildren();
        const title = document.createElement("strong");
        title.textContent = "Find your color.";
        panel.append(title);
        const palette = document.createElement("div");
        palette.className = "relay-palette";
        ["#3259ed", "#202b44", "#6975c8", "#a16ca5", "#c55b78", "#dc8756", "#c79e42", "#669387", "#7a96b8", "#9097a6", "#b5c99e", "#ffffff"].forEach((color) => {
          const b = button(source.value === color ? "✓" : "", "Use " + color);
          b.className = "relay-color-choice";
          b.setAttribute("aria-pressed", String(source.value === color));
          colorRule(b, color);
          b.addEventListener("click", () => commit(color), opts);
          palette.append(b);
        });
        panel.append(palette);
        const hex = document.createElement("input");
        hex.type = "text";
        hex.value = source.value;
        hex.maxLength = 7;
        hex.setAttribute("aria-label", "Hex color");
        hex.className = "relay-hex";
        const apply = button("Use this color");
        apply.className = "button secondary";
        const error = document.createElement("p");
        error.className = "relay-control-error";
        error.setAttribute("role", "status");
        apply.addEventListener("click", () => {
          if (/^#[a-f\d]{6}$/i.test(hex.value.trim()))
            commit(hex.value.trim().toLowerCase());
          else {
            error.textContent = "Use six hex digits, for example #3259ed.";
            hex.focus();
          }
        }, opts);
        panel.append(hex, apply, error);
      }
      function renderCalendar() {
        panel.replaceChildren();
        const header = document.createElement("div");
        header.className = "relay-calendar-heading";
        const prev = button("←", "Previous month"), next = button("→", "Next month"), title = document.createElement("strong");
        title.textContent = new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
        header.append(prev, title, next);
        panel.append(header);
        const shift = (delta) => {
          const d = new Date(year, month + delta, 1);
          month = d.getMonth();
          year = d.getFullYear();
          renderCalendar();
          panel.querySelectorAll(".relay-calendar-heading button")[delta < 0 ? 0 : 1].focus();
        };
        prev.addEventListener("click", () => shift(-1), opts);
        next.addEventListener("click", () => shift(1), opts);
        const grid = document.createElement("div");
        grid.className = "relay-calendar";
        ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach((day) => {
          const s = document.createElement("span");
          s.textContent = day;
          s.setAttribute("aria-hidden", "true");
          grid.append(s);
        });
        const offset = new Date(year, month, 1).getDay(), count = new Date(year, month + 1, 0).getDate();
        for (let i = 0;i < offset; i++)
          grid.append(document.createElement("span"));
        for (let day = 1;day <= count; day++) {
          const value = String(year).padStart(4, "0") + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
          const b = button(String(day), new Date(year, month, day).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }));
          b.setAttribute("aria-pressed", String(source.value === value));
          b.addEventListener("click", () => commit(value), opts);
          b.addEventListener("keydown", (e) => {
            const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
            if (!(e.key in moves))
              return;
            e.preventDefault();
            e.stopPropagation();
            const cells = [...grid.querySelectorAll("button")], index = cells.indexOf(b);
            cells[Math.max(0, Math.min(cells.length - 1, index + moves[e.key]))].focus();
          }, opts);
          grid.append(b);
        }
        panel.append(grid);
        const clear = button("Leave the date open");
        clear.className = "quiet-button";
        clear.addEventListener("click", () => commit(""), opts);
        panel.append(clear);
      }
      function open() {
        if (trigger.disabled)
          return;
        document.dispatchEvent(new CustomEvent("relay:close-controls"));
        trigger.setAttribute("aria-expanded", "true");
        panel.hidden = false;
        if (type === "select")
          renderOptions();
        else if (type === "color") {
          renderColors();
          panel.querySelector("button")?.focus();
        } else {
          const d = source.value ? new Date(source.value + "T12:00:00") : new Date;
          month = d.getMonth();
          year = d.getFullYear();
          renderCalendar();
          panel.querySelector("button")?.focus();
        }
      }
      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.hidden ? open() : close();
      }, opts);
      panel.addEventListener("click", (e) => e.stopPropagation(), opts);
      wrapper.addEventListener("keydown", (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey)
          return;
        if (e.key === "Escape" && !panel.hidden) {
          e.preventDefault();
          e.stopPropagation();
          close();
          trigger.focus();
          return;
        }
        if (type !== "select") {
          if (e.key === "Enter" && e.target.tagName === "INPUT") {
            e.preventDefault();
            panel.querySelector(".button")?.click();
          }
          return;
        }
        if (e.key === "Tab") {
          close();
          return;
        }
        if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          if (panel.hidden) {
            open();
            return;
          }
          if (e.key === "Enter" || e.key === " ") {
            if (available(active))
              commit(source.options[active].value);
            return;
          }
          let candidate = e.key === "Home" ? 0 : e.key === "End" ? source.options.length - 1 : active + (e.key === "ArrowUp" ? -1 : 1);
          const delta = e.key === "ArrowUp" || e.key === "End" ? -1 : 1;
          while (candidate >= 0 && candidate < source.options.length && !available(candidate))
            candidate += delta;
          if (candidate >= 0 && candidate < source.options.length)
            highlight(candidate);
        } else if (e.key.length === 1) {
          e.stopPropagation();
          if (panel.hidden)
            open();
          prefix = Date.now() - typedAt > 600 ? "" : prefix;
          prefix += e.key.toLowerCase();
          typedAt = Date.now();
          const index = [...source.options].findIndex((o, i) => available(i) && o.textContent.trim().toLowerCase().startsWith(prefix));
          if (index >= 0)
            highlight(index);
        }
      }, opts);
      wrapper.addEventListener("focusout", () => queueMicrotask(() => {
        if (!wrapper.contains(document.activeElement))
          close();
      }), opts);
      document.addEventListener("pointerdown", (e) => {
        if (!wrapper.contains(e.target))
          close();
      }, opts);
      document.addEventListener("relay:close-controls", close, opts);
      source.addEventListener("change", sync, opts);
      source.addEventListener("invalid", (e) => {
        e.preventDefault();
        trigger.setAttribute("aria-invalid", "true");
        trigger.focus();
        R.toast("Choose " + label.toLowerCase() + " before continuing.");
      }, opts);
      source.form?.addEventListener("reset", () => queueMicrotask(sync), opts);
      const observer = new MutationObserver(sync);
      observer.observe(source, { childList: true, subtree: true, attributes: true });
      for (const fs of source.closest("form")?.querySelectorAll("fieldset") || [])
        observer.observe(fs, { attributes: true, attributeFilter: ["disabled"] });
      sync();
      return () => {
        lifetime.abort();
        observer.disconnect();
        wrapper.remove();
        source.hidden = previous.hidden;
        if (type !== "select")
          source.type = previous.type;
        previous.tabindex === null ? source.removeAttribute("tabindex") : source.setAttribute("tabindex", previous.tabindex);
      };
    }
    function reconcile() {
      for (const [source, clean] of controls)
        if (!source.isConnected) {
          clean();
          controls.delete(source);
        }
      document.querySelectorAll('select,input[type="color"],input[type="date"]').forEach((source) => {
        if (!controls.has(source) && !(source.tagName === "SELECT" && (source.multiple || source.size > 1)))
          controls.set(source, enhance(source));
      });
    }
    const observer = new MutationObserver(reconcile);
    reconcile();
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("pagehide", () => {
      observer.disconnect();
      for (const clean of controls.values())
        clean();
      controls.clear();
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        reconcile();
        observer.observe(document.body, { childList: true, subtree: true });
      }
    });
  })();
  (() => {
    const key = "relay-welcome-v1";
    let step = 0, organization = "notes", view = "list";
    const { studio: priorStudio, closeModal: priorClose } = R;
    R.studio = () => priorStudio().replace('<div class="workspace-end">', '<div class="workspace-end">' + R.btn("A quick tour", "relay-tour", "quiet-button"));
    R.view = () => R.ui.view || R.folder?.(R.ui.folder)?.view || (["list", "gallery", "board"].includes(R.data.prefs.startView) ? R.data.prefs.startView : "list");
    if (["list", "gallery", "board"].includes(R.data.prefs.startView))
      R.ui.view = R.data.prefs.startView;
    function remember() {
      return R.storage(key, { seen: true, at: Date.now() });
    }
    function dismiss() {
      remember();
      modal.close();
      R.render();
    }
    function render() {
      const pages = [
        { label: "A LITTLE HELLO", title: "Leave yourself a place to begin.", copy: "Keep the thought behind the work. A sentence is enough; folders and structure can come later.", art: "↳", body: `<div class="welcome-choices" role="group" aria-label="How you like to organize">${[["notes", "Just notes", "A clear page. No filing needed."], ["folders", "Notes + folders", "A few places for different thoughts."]].map(([id, title, copy]) => `<button type="button" data-welcome-organization="${id}" aria-pressed="${organization === id}"><strong>${title}</strong><span>${copy}</span></button>`).join("")}</div><p class="welcome-hint">Existing notes and folders stay intact. You can change this anytime.</p>` },
        { label: "YOUR WAY OF SEEING", title: "A view that feels like you.", copy: "Start with a simple list, spread things out as cards, or move notes across a board. Same notes, different perspectives.", art: "▤", body: `<div class="welcome-views" role="group" aria-label="Your starting view">${[["list", "List", "≡"], ["gallery", "Cards", "▦"], ["board", "Board", "▥"]].map(([id, title, icon]) => `<button type="button" data-welcome-view="${id}" aria-pressed="${view === id}"><span aria-hidden="true">${icon}</span><strong>${title}</strong></button>`).join("")}</div><p class="welcome-hint">Board columns are your own spaces. Rename them in Templates & settings.</p>` },
        { label: "A LITTLE CONTEXT GOES A LONG WAY", title: "Pick up the thread, later.", copy: "Write freely, or add a page layout with your own questions. Your next step can be a sentence, a link, or a detail only you understand.", art: "✳", body: '<div class="welcome-example"><small>A NOTE TO YOUR FUTURE SELF</small><strong>Try the smaller version first.</strong><p>The last attempt was too complicated. Next time, start with one useful screen.</p></div><p class="welcome-hint">Notes and attachments stay on this device, in your browser or assigned Tabs profile. Full backups are in Templates & settings.</p>' }
      ];
      const page = pages[step];
      R.showModal(`${R.modalTop("RELAY / MAKE YOURSELF AT HOME")}<div class="welcome-progress" aria-label="Step ${step + 1} of ${pages.length}">${pages.map((_, i) => `<span class="${i <= step ? "is-filled" : ""}" aria-hidden="true"></span>`).join("")}<small>${step + 1} / ${pages.length}</small></div><div class="welcome-art" aria-hidden="true"><span>${page.art}</span><small>A LITTLE ROOM TO KEEP GOING.</small></div><span class="eyebrow">${page.label}</span><h2 id="modal-title">${page.title}</h2><p class="modal-intro">${page.copy}</p>${page.body}<div class="welcome-footer">${R.btn("Skip for now", "welcome-skip", "quiet-button")}<div>${step ? R.btn("Back", "welcome-back", "button secondary") : ""}${R.btn(step === pages.length - 1 ? "Make yourself at home ↗" : "Next →", "welcome-next", "button primary")}</div></div>`, "welcome");
      document.querySelector("#modal-title").tabIndex = -1;
      document.querySelector("#modal-title").focus();
    }
    R.openWelcome = () => {
      R.flushInline();
      step = 0;
      organization = R.usesFolders() ? "folders" : "notes";
      view = R.view();
      render();
    };
    actions["relay-tour"] = R.openWelcome;
    actions["welcome-skip"] = dismiss;
    actions["welcome-back"] = () => {
      step = Math.max(0, step - 1);
      render();
    };
    actions["welcome-next"] = () => {
      if (step < 2) {
        step++;
        render();
        return;
      }
      const previous = structuredClone(R.data.prefs);
      R.data.prefs.organization ||= {};
      R.data.prefs.organization[R.ui.project] = organization;
      R.data.prefs.startView = view;
      if (!R.save()) {
        R.data.prefs = previous;
        R.toast("We couldn’t save your choices. Try again, or skip for now.");
        return;
      }
      R.ui.view = view;
      remember();
      modal.close();
      R.render();
      R.toast("Your space is ready. Catch a thought whenever you like.");
    };
    document.addEventListener("click", (event) => {
      const choice = event.target.closest("[data-welcome-organization],[data-welcome-view]");
      if (!choice)
        return;
      if (choice.dataset.welcomeOrganization)
        organization = choice.dataset.welcomeOrganization;
      if (choice.dataset.welcomeView)
        view = choice.dataset.welcomeView;
      const group = choice.closest('[role="group"]');
      group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === choice)));
    });
    R.closeModal = () => modalKind === "welcome" ? dismiss() : priorClose();
    modal.addEventListener("cancel", (event) => {
      if (modalKind === "welcome") {
        event.preventDefault();
        dismiss();
      }
    });
    R.render();
    setTimeout(() => {
      if (!R.read(key) && !modal.open)
        R.openWelcome();
    }, 0);
  })();
  const relayBaseCustomField = R.customField;
  R.customField = (field, note) => {
    const value = R.value(note, field.id), id = "prompt-" + field.id, options = (field.options || "").split(",").map((x) => x.trim()).filter(Boolean);
    const label = `<label for="${E(id)}">${E(field.label)}<small>Optional</small></label>`;
    if (["checklist", "choice"].includes(field.type)) {
      const selected = new Set(String(value || "").split(`
`));
      return `<fieldset class="optional-prompt rich-choices" data-rich-group="${E(field.id)}" data-rich-type="${field.type}"><legend>${E(field.label)} <small>Optional · ${field.type === "checklist" ? "choose any" : "choose one"}</small></legend><input type="hidden" id="${E(id)}" data-custom-field="${E(field.id)}" value="${E(value)}">${options.map((option, index) => `<label class="rich-choice"><input type="${field.type === "checklist" ? "checkbox" : "radio"}" name="rich-${E(field.id)}" data-rich-choice value="${E(option)}" ${selected.has(option) ? "checked" : ""}><span>${E(option)}</span></label>`).join("")}${field.type === "choice" ? R.btn("Clear selection", "clear-rich-choice", "quiet-button", `type="button" data-field="${E(field.id)}"`) : ""}</fieldset>`;
    }
    if (field.type === "rating")
      return `<div class="optional-prompt rich-rating" data-rich-group="${E(field.id)}">${label}<input type="hidden" id="${E(id)}" data-custom-field="${E(field.id)}" value="${E(value)}"><div role="group" aria-label="${E(field.label)}">${[1, 2, 3, 4, 5].map((number) => `<button type="button" data-rating-value="${number}" aria-label="${number} out of 5" aria-pressed="${String(value) === String(number)}" class="${Number(value) >= number ? "active" : ""}">★</button>`).join("")}${R.btn("Clear", "clear-rich-choice", "quiet-button", `type="button" data-field="${E(field.id)}"`)}</div></div>`;
    if (field.type === "number")
      return `<div class="optional-prompt">${label}<div class="rich-number">${R.btn("−", "step-rich-number", "icon-button", `type="button" data-step="-1" aria-label="Decrease ${E(field.label)}"`)}<input type="text" id="${E(id)}" data-custom-field="${E(field.id)}" value="${E(value)}" inputmode="decimal" placeholder="0">${R.btn("+", "step-rich-number", "icon-button", `type="button" data-step="1" aria-label="Increase ${E(field.label)}"`)}</div></div>`;
    if (["email", "time", "code"].includes(field.type)) {
      const control = field.type === "code" ? `<textarea id="${E(id)}" data-custom-field="${E(field.id)}" class="rich-code" rows="4" placeholder="Paste a snippet…" spellcheck="false">${E(value)}</textarea>` : `<input id="${E(id)}" data-custom-field="${E(field.id)}" value="${E(value)}" inputmode="${field.type === "number" ? "decimal" : field.type === "email" ? "email" : "text"}" placeholder="${{ number: "e.g. 12.5", email: "you@example.com", time: "HH:MM" }[field.type]}">`;
      return `<div class="optional-prompt">${label}${control}</div>`;
    }
    return relayBaseCustomField(field, note);
  };
  R.updateRichAnswer = (group) => {
    const input = group.querySelector("[data-custom-field]");
    if (group.dataset.richType)
      input.value = [...group.querySelectorAll("[data-rich-choice]:checked")].map((choice) => choice.value).join(`
`);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  document.addEventListener("change", (event) => {
    if (event.target.hasAttribute("data-rich-choice"))
      R.updateRichAnswer(event.target.closest("[data-rich-group]"));
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-rating-value]");
    if (!button)
      return;
    const group = button.closest("[data-rich-group]"), value = button.dataset.ratingValue;
    group.querySelector("[data-custom-field]").value = value;
    group.querySelectorAll("[data-rating-value]").forEach((item) => {
      item.classList.toggle("active", Number(item.dataset.ratingValue) <= Number(value));
      item.setAttribute("aria-pressed", String(item === button));
    });
    R.updateRichAnswer(group);
  });
  actions["clear-rich-choice"] = (button) => {
    const group = button.closest("[data-rich-group]");
    group.querySelector("[data-custom-field]").value = "";
    group.querySelectorAll("[data-rich-choice]").forEach((input) => input.checked = false);
    group.querySelectorAll("[data-rating-value]").forEach((item) => {
      item.classList.remove("active");
      item.setAttribute("aria-pressed", "false");
    });
    R.updateRichAnswer(group);
  };
  actions["step-rich-number"] = (button) => {
    const input = button.closest(".rich-number").querySelector("input"), current = Number(input.value || 0);
    if (!Number.isFinite(current)) {
      input.focus();
      return;
    }
    input.value = String(Math.round((current + Number(button.dataset.step)) * 1e6) / 1e6);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  let relayActiveTemplateField = "";
  const relayTemplateTypes = [["short", "Short answer", "A line of text", "lines"], ["long", "Paragraph", "Room for more context", "file"], ["check", "Checkbox", "One item to tick off", "check"], ["checklist", "Checklist", "Choose multiple items", "check"], ["choice", "Multiple choice", "Choose one answer", "grid"], ["select", "Dropdown", "A list of choices", "down"], ["rating", "Rating", "A five-star scale", "spark"], ["number", "Number", "Counts or estimates", "plus"], ["date", "Date", "A date to remember", "clock"], ["time", "Time", "A time of day", "clock"], ["email", "Email", "An email address", "link"], ["link", "Link", "A useful web address", "link"], ["code", "Code snippet", "Keep a piece of code", "file"]];
  const relayTemplatePreviewValues = new Map;
  R.templatePreviewMarkup = (template) => {
    const values = relayTemplatePreviewValues.get(template.id) || {};
    return `<article class="builder-note-preview" aria-label="Interactive note preview"><span class="builder-preview-kicker">TRY YOUR TEMPLATE · PREVIEW ONLY</span><input class="preview-title-input" aria-label="Preview note title" placeholder="Untitled note" data-preview-base="title" value="${E(values.__title || "")}"><textarea class="preview-body-input" aria-label="Preview writing space" data-preview-base="body" rows="4" placeholder="Start writing…">${E(values.__body || "")}</textarea>${template.fields.map((field) => `<section class="builder-preview-field" data-template-drop="${E(field.id)}"><button type="button" class="template-drag-handle preview-drag-handle" draggable="false" data-template-drag="${E(field.id)}" aria-label="Drag ${E(field.label)} to reorder" title="Drag to reorder · Alt + arrow keys">⠿</button>${R.customField(field, { values })}</section>`).join("")}<div class="builder-preview-footer">${I("check")}Try the controls here. Preview answers aren’t saved as notes.</div></article>`;
  };
  R.templateEditorSettings = () => {
    const template = R.template(selectedTemplate);
    selectedTemplate = template.id;
    if (relayActiveTemplateField !== "__none__" && !template.fields.some((field) => field.id === relayActiveTemplateField))
      relayActiveTemplateField = template.fields[0]?.id || "";
    const fields = template.fields.map((field, index) => {
      const active = field.id === relayActiveTemplateField, type = relayTemplateTypes.find(([id]) => id === field.type) || relayTemplateTypes[0];
      return `<article class="template-field-block ${active ? "active" : ""}" data-template-drop="${E(field.id)}"><div class="template-field-bar"><button type="button" class="template-drag-handle" draggable="false" data-template-drag="${E(field.id)}" aria-label="Drag ${E(field.label)} to reorder" title="Drag to reorder · Alt + arrow keys">⠿</button><button data-action="template-edit-field" data-id="${E(field.id)}" aria-expanded="${active}"><span class="template-field-number">${index + 1}</span>${I(type[3])}<span>${E(field.label || type[1])}</span><small>${type[1]}</small></button><div>${R.btn(I("up"), "field-up", "icon-button", `data-id="${E(field.id)}" ${index === 0 ? "disabled" : ""} aria-label="Move ${E(field.label)} up"`)}${R.btn(I("down"), "field-down", "icon-button", `data-id="${E(field.id)}" ${index === template.fields.length - 1 ? "disabled" : ""} aria-label="Move ${E(field.label)} down"`)}</div></div>${active ? `<div class="template-field-properties"><label>Field label<input data-field-label="${E(field.id)}" value="${E(field.label)}" placeholder="e.g. What’s the next step?" aria-label="Field label"></label><label>Answer type<select data-field-type="${E(field.id)}" aria-label="Answer type">${relayTemplateTypes.map(([id, name]) => `<option value="${id}" ${field.type === id ? "selected" : ""}>${name}</option>`).join("")}</select></label>${["select", "checklist", "choice"].includes(field.type) ? `<div class="builder-options"><span>Choices</span>${(field.options ? field.options.split(",") : [""]).map((option, choice) => `<div><input data-choice-field="${E(field.id)}" data-choice-index="${choice}" value="${E(option.trim())}" aria-label="Choice ${choice + 1}" placeholder="Option ${choice + 1}">${R.btn(I("close"), "remove-choice", "icon-button", `data-id="${E(field.id)}" data-index="${choice}" aria-label="Remove choice ${choice + 1}"`)}</div>`).join("")}${R.btn(`${I("plus")}Add choice`, "add-choice", "quiet-button", `data-id="${E(field.id)}"`)}</div>` : field.type === "check" ? `<label>Checkbox text<input data-field-options="${E(field.id)}" value="${E(field.options || "")}" placeholder="e.g. Ready to continue" aria-label="Checkbox text"></label>` : ""}<footer><span>Optional · no required answers</span><div>${R.btn("Duplicate", "duplicate-field", "quiet-button", `data-id="${E(field.id)}"`)}${R.btn(`${I("trash")}Delete`, "remove-field", "quiet-button", `data-id="${E(field.id)}"`)}</div></footer></div>` : ""}</article>`;
    }).join("");
    return `<div class="template-workbench">${R.btn(`${I("back")}All templates`, "template-library", "quiet-button template-back")}<div class="template-workbench-toolbar"><label class="template-selector-label"><span class="sr-only">Template</span><select data-builder-template aria-label="Choose template">${R.data.templates.map((item) => `<option value="${E(item.id)}" ${item.id === template.id ? "selected" : ""}>${E(item.name)}${R.data.prefs.template === item.id ? " · Default" : ""}</option>`).join("")}</select></label><div class="template-toolbar-actions">${R.btn(`${I("plus")}Add field`, "template-jump-fields", "button secondary")}${R.btn("New template", "add-template", "quiet-button")}</div></div><div class="template-workbench-layout"><section class="template-build-pane" aria-label="Build your template"><div class="template-name-line"><label>Template name<input data-template-name="${E(template.id)}" value="${E(template.name)}" aria-label="Template name"></label><div>${R.btn(R.data.prefs.template === template.id ? `${I("check")}Default` : "Use by default", "default-template", "quiet-button", `data-id="${E(template.id)}"`)}${R.btn("Duplicate", "duplicate-template", "quiet-button", `data-id="${E(template.id)}"`)}${R.btn(`${I("trash")}Delete template`, "remove-template", "quiet-button template-delete", `data-id="${E(template.id)}"`)}</div></div><div class="template-base-block"><span class="template-base-symbol">${I("file")}</span><div><strong>Title & writing space</strong><p>Always included. Write as much or as little as you want.</p></div><span class="template-included">Included</span></div><div class="template-field-list">${fields}</div><section class="template-add-palette" aria-label="Add an optional field"><div><h4>${template.fields.length ? "Add another field" : "Add a field, if it helps"}</h4><p>Choose what you’d like to keep alongside your writing.</p></div><div class="template-field-types">${relayTemplateTypes.map(([id, name, description, icon]) => R.btn(`${I(icon)}<span>${name}<small>${description}</small></span>`, "template-add-field", "", `data-type="${id}" aria-label="Add ${name.toLowerCase()}"`)).join("")}</div></section><p class="template-builder-note">${I("check")}Changes save automatically. Existing answers stay with their notes when you remove a field.</p></section><details class="template-preview-pane" open><summary>Note preview <small>Updates as you edit</small></summary><div id="template-live-preview">${R.templatePreviewMarkup(template)}</div></details></div></div>`;
  };
  actions["template-add-field"] = (button) => {
    const type = button.dataset.type, definition = relayTemplateTypes.find(([id]) => id === type);
    if (!definition)
      return;
    const template = R.template(selectedTemplate), field = { id: crypto.randomUUID(), type, label: definition[1], options: ["select", "choice"].includes(type) ? "Option 1,Option 2" : type === "checklist" ? "First item,Second item,Third item" : "" };
    const result = R.commitChange(() => template.fields.push(field));
    if (!result)
      return;
    relayActiveTemplateField = field.id;
    R.customize("templates");
    document.querySelector("[data-field-label]")?.focus();
  };
  actions["template-edit-field"] = (button) => {
    relayActiveTemplateField = relayActiveTemplateField === button.dataset.id ? "__none__" : button.dataset.id;
    R.customize("templates");
    if (relayActiveTemplateField !== "__none__")
      document.querySelector("[data-field-label]")?.focus();
  };
  actions["template-jump-fields"] = () => {
    const palette = document.querySelector(".template-add-palette");
    palette?.scrollIntoView({ block: "center" });
    palette?.querySelector("button")?.focus();
  };
  document.addEventListener("change", (event) => {
    if (event.target.hasAttribute("data-builder-template")) {
      selectedTemplate = event.target.value;
      relayActiveTemplateField = "";
      R.customize("templates");
    }
  });
  document.addEventListener("input", (event) => {
    const input = event.target;
    if (!input.matches("[data-template-name],[data-field-label],[data-field-options],[data-choice-field]"))
      return;
    const preview = document.querySelector("#template-live-preview");
    if (preview)
      preview.innerHTML = R.templatePreviewMarkup(R.template(selectedTemplate));
    if (input.hasAttribute("data-field-label")) {
      const block = input.closest(".template-field-block"), label = block?.querySelector(".template-field-bar>button>span:not(.template-field-number)");
      if (label)
        label.textContent = input.value || "Untitled field";
    }
  });
  document.addEventListener("input", (event) => {
    const field = event.target.closest("#template-live-preview [data-custom-field]"), base = event.target.closest("#template-live-preview [data-preview-base]");
    if (!field && !base)
      return;
    const values = relayTemplatePreviewValues.get(selectedTemplate) || {};
    if (field)
      values[field.dataset.customField] = field.type === "checkbox" ? field.checked : field.value;
    if (base)
      values["__" + base.dataset.previewBase] = base.value;
    relayTemplatePreviewValues.set(selectedTemplate, values);
  });
  document.addEventListener("change", (event) => {
    const field = event.target.closest("#template-live-preview [data-custom-field]");
    if (field)
      field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  let relayTemplateLibraryOpen = true;
  let relayTemplatePendingDelete = "";
  R.templateSettings = () => relayTemplateLibraryOpen ? `<div class="template-library"><div class="template-library-heading"><div><h4>Your templates <span>${R.data.templates.length}</span></h4><p>Choose a layout to edit. Use it whenever you start a note.</p></div>${R.btn(`${I("plus")}New template`, "add-template", "button")}</div><div class="template-library-list">${R.data.templates.map((template) => `<article class="template-library-row"><span class="template-library-icon">${I("file")}</span><div class="template-library-info"><h4>${E(template.name)}${R.data.prefs.template === template.id ? '<span class="template-default-badge">Default</span>' : ""}</h4><p>${template.fields.length ? `${template.fields.length} optional ${template.fields.length === 1 ? "field" : "fields"}` : "Writing space only"} · Title & writing included</p></div><div class="template-library-actions">${R.btn(`${I("edit")}Edit`, "template-open", "button secondary", `data-id="${E(template.id)}" aria-label="Edit ${E(template.name)}"`)}${R.btn("Duplicate", "duplicate-template", "quiet-button", `data-id="${E(template.id)}" aria-label="Duplicate ${E(template.name)}"`)}${R.btn(`${I("trash")}Delete`, "remove-template", "quiet-button template-delete", `data-id="${E(template.id)}" aria-label="Delete ${E(template.name)}"`)}</div></article>`).join("")}</div><p class="template-library-help">${I("check")}The default is selected for new notes. You can choose a different template in any note.</p></div>` : R.templateEditorSettings();
  actions["template-library"] = () => {
    relayTemplateLibraryOpen = true;
    R.customize("templates");
  };
  actions["template-open"] = (button) => {
    selectedTemplate = button.dataset.id;
    relayTemplateLibraryOpen = false;
    relayActiveTemplateField = "";
    R.customize("templates");
    document.querySelector("[data-template-name]")?.focus();
  };
  R.openTemplateName = (sourceId) => {
    const source = R.data.templates.find((template) => template.id === sourceId);
    R.showModal(`${R.modalTop("TEMPLATES").replace('data-action="close"', 'data-action="template-cancel"')}<h2 id="modal-title">${source ? "Duplicate template" : "New template"}</h2><p class="modal-intro">${source ? "Give your copy a name. The original stays as it is." : "Start with a name. Add optional fields whenever you need them."}</p><form id="template-name-form" data-source="${E(source?.id || "")}"><label class="template-create-label">Template name<input name="templateName" aria-label="Template name" placeholder="e.g. Project handoff" value="${E(source ? source.name + " copy" : "")}" maxlength="100" aria-required="true" autocomplete="off"></label><p class="template-name-error" role="alert"></p><div class="dialog-actions">${R.btn("Cancel", "template-cancel", "button secondary")}<button type="submit" class="button">${source ? "Create copy" : "Create template"}</button></div></form>`, "template-name");
    const input = document.querySelector("#template-name-form input");
    input?.focus();
    input?.select();
  };
  actions["add-template"] = () => R.openTemplateName();
  actions["duplicate-template"] = (button) => R.openTemplateName(button?.dataset.id || selectedTemplate);
  actions["template-cancel"] = () => {
    relayTemplatePendingDelete = "";
    R.customize("templates");
  };
  document.addEventListener("submit", (event) => {
    if (event.target.id !== "template-name-form")
      return;
    event.preventDefault();
    const form = event.target, name = form.elements.templateName.value.trim();
    if (!name) {
      form.querySelector('[role="alert"]').textContent = "Give your template a name to continue.";
      form.elements.templateName.focus();
      return;
    }
    const source = R.data.templates.find((template) => template.id === form.dataset.source);
    const template = { id: crypto.randomUUID(), name, fields: source ? structuredClone(source.fields).map((field) => ({ ...field, id: crypto.randomUUID() })) : [] };
    if (!R.commitChange(() => R.data.templates.push(template)))
      return;
    selectedTemplate = template.id;
    relayActiveTemplateField = "";
    relayTemplateLibraryOpen = false;
    R.customize("templates");
    R.toast("Template created. Add fields, or leave it as a writing page.");
  });
  actions["default-template"] = (button) => {
    if (!R.commitChange(() => {
      R.data.prefs.template = button.dataset.id;
    }))
      return;
    R.customize("templates");
    R.toast("Default template updated.");
  };
  actions["remove-template"] = (button) => {
    const template = R.data.templates.find((item) => item.id === button.dataset.id);
    if (!template)
      return;
    relayTemplatePendingDelete = template.id;
    const fallback = R.data.templates.find((item) => item.id !== template.id), count = R.data.cards.filter((note) => note.template === template.id).length;
    R.showModal(`${R.modalTop("TEMPLATES").replace('data-action="close"', 'data-action="template-cancel"')}<div class="confirm-symbol">${I("trash")}</div><h2 id="modal-title">Delete “${E(template.name)}”?</h2><p class="modal-intro">Your notes and saved answers will stay. ${count ? `${count} ${count === 1 ? "note uses" : "notes use"} this template. ` : ""}${fallback ? `Notes using it will switch to “${E(fallback.name)}”.` : "A blank writing template will replace this last template."}</p><div class="dialog-actions">${R.btn("Cancel", "template-cancel", "button secondary")}${R.btn("Delete template", "template-confirm-delete", "button danger")}</div>`, "template-delete");
    document.querySelector('.dialog-actions [data-action="template-cancel"]')?.focus();
  };
  actions["template-confirm-delete"] = () => {
    const template = R.data.templates.find((item) => item.id === relayTemplatePendingDelete);
    if (!template)
      return;
    const outcome = R.commitChange(() => {
      R.data.retiredFields ||= {};
      template.fields.forEach((field) => {
        R.data.retiredFields[field.id] = { label: field.label, type: field.type };
      });
      R.data.templates = R.data.templates.filter((item) => item.id !== template.id);
      if (!R.data.templates.length)
        R.data.templates.push({ id: crypto.randomUUID(), name: "Blank note", fields: [] });
      const fallback = R.data.templates[0].id;
      R.data.cards.forEach((note) => {
        if (note.template === template.id)
          note.template = fallback;
      });
      R.data.folders.forEach((folder) => {
        if (folder.template === template.id)
          folder.template = "";
      });
      if (R.data.prefs.template === template.id)
        R.data.prefs.template = fallback;
    });
    if (!outcome)
      return;
    relayTemplatePreviewValues.delete(template.id);
    relayTemplatePendingDelete = "";
    relayTemplateLibraryOpen = true;
    R.customize("templates");
    R.toast("Template deleted. Your notes and answers are safe.");
  };
  let relayDraggedTemplateField = "", relayTemplateDrop = null;
  R.moveTemplateField = (sourceId, targetId, after = false) => {
    const template = R.template(selectedTemplate), source = template.fields.find((field) => field.id === sourceId);
    if (!source || sourceId === targetId || !template.fields.some((field) => field.id === targetId))
      return false;
    const result = R.commitChange(() => {
      const remaining = template.fields.filter((field) => field.id !== sourceId), target = remaining.findIndex((field) => field.id === targetId);
      remaining.splice(target + (after ? 1 : 0), 0, source);
      template.fields = remaining;
    });
    if (!result)
      return false;
    R.customize("templates");
    R.toast("Field order updated");
    return true;
  };
  const clearTemplateDrag = () => {
    document.querySelectorAll(".template-drop-before,.template-drop-after,.template-being-dragged").forEach((el) => el.classList.remove("template-drop-before", "template-drop-after", "template-being-dragged"));
    relayDraggedTemplateField = "";
    relayTemplateDrop = null;
  };
  const showTemplateDrop = (target, y) => {
    document.querySelectorAll(".template-drop-before,.template-drop-after").forEach((el) => el.classList.remove("template-drop-before", "template-drop-after"));
    if (!target || target.dataset.templateDrop === relayDraggedTemplateField) {
      relayTemplateDrop = null;
      return;
    }
    const box = target.getBoundingClientRect(), after = y > box.top + box.height / 2;
    target.classList.add(after ? "template-drop-after" : "template-drop-before");
    relayTemplateDrop = { id: target.dataset.templateDrop, after };
  };
  document.addEventListener("dragstart", (event) => {
    const handle = event.target.closest("[data-template-drag]");
    if (!handle)
      return;
    relayDraggedTemplateField = handle.dataset.templateDrag;
    event.dataTransfer.setData("application/x-relay-template-field", relayDraggedTemplateField);
    event.dataTransfer.effectAllowed = "move";
    handle.closest("[data-template-drop]")?.classList.add("template-being-dragged");
  });
  document.addEventListener("dragover", (event) => {
    if (!relayDraggedTemplateField)
      return;
    const target = event.target.closest("[data-template-drop]");
    if (!target)
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    showTemplateDrop(target, event.clientY);
  });
  document.addEventListener("drop", (event) => {
    if (!relayDraggedTemplateField)
      return;
    event.preventDefault();
    const source = relayDraggedTemplateField, target = relayTemplateDrop;
    clearTemplateDrag();
    if (target)
      R.moveTemplateField(source, target.id, target.after);
  });
  document.addEventListener("dragend", clearTemplateDrag);
  document.addEventListener("keydown", (event) => {
    const handle = event.target.closest("[data-template-drag]");
    if (!handle || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key))
      return;
    event.preventDefault();
    const fields = R.template(selectedTemplate).fields, index = fields.findIndex((field) => field.id === handle.dataset.templateDrag), target = fields[index + (event.key === "ArrowUp" ? -1 : 1)];
    if (target)
      R.moveTemplateField(handle.dataset.templateDrag, target.id, event.key === "ArrowDown");
  });
  let relayTouchHandle = null;
  document.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-template-drag]");
    if (!handle || event.button !== 0)
      return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    handle.closest("[data-template-drop]")?.classList.add("template-being-dragged");
    relayTouchHandle = handle;
    relayDraggedTemplateField = handle.dataset.templateDrag;
    handle.setPointerCapture(event.pointerId);
  });
  document.addEventListener("pointermove", (event) => {
    if (!relayTouchHandle)
      return;
    event.preventDefault();
    showTemplateDrop(document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-template-drop]"), event.clientY);
  });
  document.addEventListener("pointerup", () => {
    if (!relayTouchHandle)
      return;
    const source = relayDraggedTemplateField, target = relayTemplateDrop;
    relayTouchHandle = null;
    clearTemplateDrag();
    if (target)
      R.moveTemplateField(source, target.id, target.after);
  });
  document.addEventListener("pointercancel", () => {
    relayTouchHandle = null;
    clearTemplateDrag();
  });
  actions["new-subfolder"] = (button) => {
    const parent = button.dataset.id || R.ui.folder, folder = R.folder(parent);
    if (!folder || folder.project !== R.ui.project)
      return;
    R.folderForm();
    const form = document.querySelector("#folder-form");
    form.elements.parent.value = parent;
    form.elements.parent.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("#modal-title").textContent = "New subfolder";
    const intro = document.querySelector(".modal-intro");
    if (intro)
      intro.textContent = "Inside " + R.folderLabel(parent);
    form.querySelector('[name="name"]')?.focus();
  };
  const subfolderForm = R.folderForm;
  R.folderForm = (id) => {
    subfolderForm(id);
    if (!id)
      return;
    const management = document.querySelector(".folder-management");
    management?.insertAdjacentHTML("afterbegin", R.btn(`${I("plus")}New subfolder`, "new-subfolder", "quiet-button", `type="button" data-id="${E(id)}"`));
  };
  let relayBoardReturn = false;
  R.columnEditor = (id = null) => {
    const column = id ? R.data.columns.find((c) => c.id === id) : null;
    if (id && !column)
      return;
    if (modalKind !== "column-edit" && modalKind !== "column-delete")
      relayBoardReturn = modal.open && modalKind === "settings";
    R.showModal(`<div class="column-dialog">${R.modalTop("BOARD COLUMN").replace('data-action="close"', 'data-action="column-cancel"')}<h2 id="modal-title">${column ? "Edit column" : "New column"}</h2><p class="modal-intro">${column ? "Make your changes, then save when you’re ready." : "Give this part of your board a name."}</p><form id="column-form" data-id="${E(id || "")}" class="simple-form"><label>Column name<input name="name" required maxlength="80" value="${E(column?.name || "")}" placeholder="e.g. In progress" autocomplete="off"></label><label>Color<input type="color" name="color" value="${E(column?.color || "#3259ed")}" aria-label="Column color"></label><div class="column-dialog-actions">${column ? R.btn(`${I("trash")}Delete column`, "remove-column", "danger-link", `type="button" data-id="${E(id)}" ${R.data.columns.length === 1 ? "disabled" : ""}`) : ""}<div>${R.btn("Cancel", "column-cancel", "button secondary", 'type="button"')}<button type="submit" class="button primary">${column ? "Save changes" : "Create column"}</button></div></div></form></div>`, "column-edit");
    document.querySelector('#column-form input[name="name"]')?.focus();
  };
  R.finishColumnEdit = () => {
    if (relayBoardReturn)
      R.customize("board");
    else {
      modal.close();
      R.render();
    }
  };
  actions["edit-column"] = (button) => R.columnEditor(button.dataset.id);
  actions["add-column"] = () => R.columnEditor();
  actions["column-cancel"] = R.finishColumnEdit;
  actions["remove-column"] = (button) => {
    const id = button.dataset.id, column = R.data.columns.find((c) => c.id === id);
    if (!column || R.data.columns.length < 2)
      return;
    if (modalKind === "settings")
      relayBoardReturn = true;
    const target = R.data.columns.find((c) => c.id !== id), count = R.data.cards.filter((note) => note.status === id).length;
    R.showModal(`${R.modalTop("DELETE COLUMN").replace('data-action="close"', 'data-action="column-cancel"')}<div class="confirm-symbol">${I("trash")}</div><h2 id="modal-title">Delete “${E(column.name)}”?</h2><p class="modal-intro">${count ? `${count} ${count === 1 ? "note will" : "notes will"} move to <strong>${E(target.name)}</strong>.` : "This column is empty."} Your notes will be kept.</p><div class="dialog-actions">${R.btn("Cancel", "column-cancel", "button secondary")}${R.btn("Delete column", "confirm-column-delete", "button danger", `data-id="${E(id)}"`)}</div>`, "column-delete");
  };
  actions["confirm-column-delete"] = (button) => {
    const id = button.dataset.id;
    if (R.data.columns.length < 2 || !R.data.columns.some((c) => c.id === id))
      return;
    const result = R.commitChange(() => {
      R.data.columns = R.data.columns.filter((c) => c.id !== id);
      for (const note of R.data.cards)
        if (note.status === id)
          note.status = R.data.columns[0].id;
      R.refreshStatuses();
    });
    if (result) {
      R.finishColumnEdit();
      R.toast("Column deleted. Notes kept.");
    }
  };
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (form.id !== "column-form")
      return;
    event.preventDefault();
    const name = form.elements.name.value.trim(), color = form.elements.color.value, id = form.dataset.id;
    if (!name || !/^#[a-f\d]{6}$/i.test(color))
      return;
    const result = R.commitChange(() => {
      if (id) {
        const column = R.data.columns.find((c) => c.id === id);
        if (!column)
          throw Error("This column is no longer available.");
        Object.assign(column, { name, color });
      } else
        R.data.columns.push({ id: crypto.randomUUID(), name, color });
      R.refreshStatuses();
    });
    if (result) {
      R.finishColumnEdit();
      R.toast(id ? "Column updated" : "Column created");
    }
  });
  modal.addEventListener("cancel", (event) => {
    if (["column-edit", "column-delete"].includes(modalKind)) {
      event.preventDefault();
      R.finishColumnEdit();
    }
  });
  R.boardSettings = () => `<div class="settings-section-intro"><span>${I("board")}</span><div><h4>A workflow that fits you</h4><p>Columns are shared across projects. Open a column to edit its name or color.</p></div></div><div class="board-settings-list">${R.data.columns.map((column, index) => `<div class="board-setting-row"><span class="column-number">${String(index + 1).padStart(2, "0")}</span><strong>${E(column.name)}</strong><div>${R.btn(I("up"), "column-up", "icon-button", `data-id="${E(column.id)}" ${index === 0 ? "disabled" : ""} aria-label="Move ${E(column.name)} left"`)}${R.btn(I("down"), "column-down", "icon-button", `data-id="${E(column.id)}" ${index === R.data.columns.length - 1 ? "disabled" : ""} aria-label="Move ${E(column.name)} right"`)}${R.btn("Edit", "edit-column", "button secondary", `data-id="${E(column.id)}"`)}</div></div>`).join("")}</div>${R.btn(`${I("plus")}New column`, "add-column", "button secondary")}`;
  let relaySearchScope = "all", relaySearchReturnFocus = null;
  R.findSearchNotes = (query, scope = "all") => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return R.all().filter((note) => scope === "archive" ? note.archived : !note.archived && (scope !== "project" || note.project === R.ui.project)).map((note) => {
      const title = note.title.toLowerCase(), text = [note.title, note.body, note.tried, note.next, note.blocked, note.branch, note.project, note.links, ...note.files, ...note.tags, ...Object.values(note.values || {}), ...(note.attachments || []).map((file) => file.name), R.folderLabel(note.folder)].join(" ").toLowerCase();
      return { note, match: words.every((word) => text.includes(word)), rank: words.length && words.every((word) => title.includes(word)) ? 1 : 0 };
    }).filter((result) => result.match).sort((a, b) => b.rank - a.rank || b.note.updated - a.note.updated).map((result) => result.note);
  };
  R.search = () => R.btn(`${I("search")}<span>Search notes…</span><kbd>⌘ K</kbd>`, "search", "search-launcher", 'aria-label="Search Relay"');
  R.searchResults = (query) => {
    const results = document.querySelector("#global-search-results");
    if (!results)
      return;
    const notes = R.findSearchNotes(query, relaySearchScope), hasQuery = !!query.trim();
    document.querySelector("#search-result-count").textContent = hasQuery ? `${notes.length} ${notes.length === 1 ? "result" : "results"}` : relaySearchScope === "archive" ? "Archived notes" : "Recently updated";
    results.innerHTML = notes.length ? notes.slice(0, 50).map((note, index) => `<button data-search-result data-global-open="${E(note.id)}" id="relay-search-result-${index}">${I("file")}<div><strong>${E(note.title)}</strong><small>${E(note.project)}${note.folder ? " / " + E(R.folderLabel(note.folder)) : ""}${note.archived ? " · Archived" : ""}</small>${note.body ? `<p>${E(R.noteExcerpt(note).slice(0, 180))}</p>` : ""}</div><time>${R.age(note.updated)}</time>${I("arrow")}</button>`).join("") : `<div class="search-empty">${I("search")}<h3>${hasQuery ? "No matching notes" : "No notes here yet"}</h3><p>${hasQuery ? "Try a title, a word from your writing, a branch or a filename." : "Your notes will appear here as you write."}</p></div>`;
    document.querySelector("#search-truncated").textContent = notes.length > 50 ? "Showing the first 50 results. Add another word to narrow your search." : "";
  };
  R.openSearch = () => {
    R.flushInline();
    relaySearchReturnFocus = document.activeElement;
    relaySearchScope = "all";
    R.showModal(`<section class="search-screen"><header><div class="search-brand">${R.logo().replace('data-action="home"', 'data-action="close-search"').replace('aria-label="Relay home"', 'aria-label="Back to notebook"')}<span>Search</span></div>${R.btn(`${I("close")}<span>Close</span>`, "close-search", "button secondary", 'aria-label="Close search"')}</header><div class="search-content"><h2 id="modal-title">Find where you left off.</h2><label class="search-canvas-input">${I("search")}<input data-global-search aria-label="Search all notes" aria-describedby="search-keyboard-hint" placeholder="Search notes, branches, files…" autocomplete="off">${R.btn(I("close"), "clear-search", "icon-button", 'aria-label="Clear search"')}</label><div class="search-scopes" role="group" aria-label="Search scope">${[["all", "All notes"], ["project", "This project"], ["archive", "Archive"]].map(([value, label]) => R.btn(label, "search-scope", value === "all" ? "active" : "", `data-value="${value}" aria-pressed="${value === "all"}"`)).join("")}</div><div class="search-results-heading"><h3 id="search-result-count" role="status" aria-live="polite"></h3><span id="search-keyboard-hint">↓ ↑ to navigate · Enter to open · Esc to close</span></div><div id="global-search-results"></div><p id="search-truncated"></p></div><footer>Your notes stay on this device.</footer></section>`, "search");
    R.searchResults("");
    document.querySelector("[data-global-search]")?.focus();
  };
  actions["search-scope"] = (button) => {
    relaySearchScope = button.dataset.value;
    document.querySelectorAll('[data-action="search-scope"]').forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    const input = document.querySelector("[data-global-search]");
    input.setAttribute("aria-label", relaySearchScope === "project" ? "Search this project" : relaySearchScope === "archive" ? "Search archived notes" : "Search all notes");
    R.searchResults(input.value);
    input.focus();
  };
  actions["clear-search"] = () => {
    const input = document.querySelector("[data-global-search]");
    input.value = "";
    R.searchResults("");
    input.focus();
  };
  actions["close-search"] = () => {
    R.closeModal();
    const launcher = document.querySelector(".search-launcher");
    if (relaySearchReturnFocus?.isConnected)
      relaySearchReturnFocus.focus();
    else
      launcher?.focus();
  };
  document.addEventListener("keydown", (event) => {
    if (modal.open && modalKind === "search") {
      const input = document.querySelector("[data-global-search]"), buttons = [...document.querySelectorAll("[data-search-result]")], index = buttons.indexOf(document.activeElement);
      if (event.key === "ArrowDown" && (document.activeElement === input || index >= 0)) {
        event.preventDefault();
        buttons[Math.min(index + 1, buttons.length - 1)]?.focus();
      }
      if (event.key === "ArrowUp" && index >= 0) {
        event.preventDefault();
        if (index === 0)
          input.focus();
        else
          buttons[index - 1].focus();
      }
      if (event.key === "Enter" && event.target === input && buttons.length) {
        event.preventDefault();
        buttons[0].click();
      }
      return;
    }
    const typing = event.target.matches('input,textarea,select,[contenteditable="true"]');
    if (!modal.open && !typing && event.key === "/") {
      event.preventDefault();
      R.openSearch();
    }
  });
  modal.addEventListener("cancel", (event) => {
    if (modalKind === "search") {
      event.preventDefault();
      actions["close-search"]();
    }
  });
  let relayLocationContext = null;
  R.locationRows = (project, selected = "") => {
    const option = (folder, label, path) => `<button class="location-option ${selected === folder ? "selected" : ""}" data-action="location-choose" data-project="${E(project)}" data-folder="${E(folder)}" data-picker-row="${E((label + " " + path).toLowerCase())}">${I(folder ? "folder" : "file")}<span><strong>${E(label)}</strong><small>${E(path)}</small></span>${selected === folder ? I("check") : ""}</button>`;
    return option("", "No folder", "Notes in " + project) + R.data.folders.filter((f) => f.project === project).map((f) => option(f.id, f.name, R.trail(f.id).slice(0, -1).map((p) => p.name).join(" / ") || project)).join("");
  };
  R.openLocation = (project, folder = "") => {
    if (!R.data.projects.includes(project))
      return;
    R.showModal(`${R.modalTop("LOCATION").replace('data-action="close"', 'data-action="location-cancel"')}<h2 id="modal-title">Where should this note go?</h2><p class="location-help">Choose a project, then a folder if you need one.</p><div class="location-picker"><nav class="location-projects" aria-label="Projects">${R.data.projects.map((p) => R.btn(`${R.projectMark(p)}<span>${E(p)}</span>`, "location-project", p === project ? "active" : "", `data-project="${E(p)}" ${p === project ? 'aria-current="page"' : ""}`)).join("")}</nav><section class="location-folders" aria-label="Folders in ${E(project)}"><label class="picker-search">${I("search")}<input data-picker-search="location" aria-label="Find a folder" placeholder="Find a folder…" autocomplete="off"></label><div class="location-options">${R.locationRows(project, folder)}</div><p class="picker-no-results" hidden>No folders found.</p></section></div><div class="picker-footer">${R.btn("Cancel", "location-cancel", "button secondary")}</div>`, "location");
    document.querySelector("[data-picker-search]")?.focus();
  };
  actions["note-location"] = () => {
    R.saveDraft();
    if (!editorDraft)
      return;
    relayLocationContext = { kind: "draft", id: editingId };
    returnToEditor = true;
    R.openLocation(editorDraft.project, editorDraft.folder);
  };
  actions["location-project"] = (button) => R.openLocation(button.dataset.project, "");
  actions["move-note"] = (button) => {
    const note = R.card(button.dataset.id);
    if (!note)
      return;
    relayLocationContext = { kind: "note", id: note.id };
    returnToEditor = false;
    R.openLocation(note.project, note.folder);
  };
  actions["location-choose"] = (button) => {
    const context = relayLocationContext, project = button.dataset.project, folder = button.dataset.folder || "";
    if (!context || !R.data.projects.includes(project) || folder && R.folder(folder)?.project !== project)
      return;
    if (context.kind === "draft") {
      const next = { ...editorDraft, project, folder };
      if (!R.storage("relay-studio-draft:" + (context.id || "new"), next)) {
        R.toast("Could not save this location. Your draft is unchanged.");
        return;
      }
      editorDraft = next;
      returnToEditor = false;
      R.openEditor(context.id);
    } else {
      const note = R.card(context.id);
      if (!note)
        return;
      const before = structuredClone(R.data);
      R.snapshot(note, "Location changed");
      Object.assign(note, { project, folder, updated: Date.now() });
      if (!R.save()) {
        R.data = before;
        R.toast("Could not move this note. Try again.");
        return;
      }
      R.ui.project = project;
      R.ui.folder = folder;
      R.ui.scope = "all";
      modal.close();
      R.render();
      R.openReader(context.id);
      R.toast("Note moved");
    }
    relayLocationContext = null;
  };
  actions["location-cancel"] = () => {
    const context = relayLocationContext;
    relayLocationContext = null;
    returnToEditor = false;
    if (context?.kind === "draft")
      R.openEditor(context.id);
    else if (context?.kind === "note")
      R.openReader(context.id);
    else
      R.closeModal();
  };
  modal.addEventListener("cancel", (event) => {
    if (modalKind === "location") {
      event.preventDefault();
      actions["location-cancel"]();
    }
  });
  const relayDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const relayRunsInTabs = !!window.tabsExtension;
  R.applyAppearance = () => {
    const preference = relayRunsInTabs ? "system" : R.data.prefs.appearance || "system";
    document.body.dataset.appearance = preference === "system" ? relayDarkQuery.matches ? "dark" : "light" : preference;
    document.body.dataset.appearanceSource = relayRunsInTabs ? "tabs" : preference === "system" ? "device" : "preview";
  };
  relayDarkQuery.addEventListener("change", R.applyAppearance);
  const relayRenderAppearance = R.render;
  R.render = () => {
    R.applyAppearance();
    relayRenderAppearance();
  };
  const relayFeelSettings = R.feelSettings;
  R.feelSettings = () => relayRunsInTabs ? `<div class="preference-line"><div><strong>Theme</strong><p>Follows Tabs automatically. Change your theme in Tabs Settings.</p></div><span class="theme-follow-label">Following Tabs</span></div>${relayFeelSettings()}` : `<div class="preference-line"><div><strong>Preview theme</strong><p>In the installed extension, Relay follows Tabs automatically.</p></div><select data-pref="appearance" aria-label="Appearance">${[["system", "Use device setting"], ["light", "Light"], ["dark", "Dark"]].map(([value, label]) => `<option value="${value}" ${(R.data.prefs.appearance || "system") === value ? "selected" : ""}>${label}</option>`).join("")}</select></div>${relayFeelSettings()}`;
  R.header = () => `<header class="workspace-header balanced-header"><div class="header-path">${R.btn(I("menu"), "toggle-sidebar", "icon-button mobile-only", 'aria-label="Open navigation"')}<button class="header-project" data-action="project-switcher" aria-label="Switch project: ${E(R.ui.project)}">${R.projectMark(R.ui.project)}<span>${E(R.ui.project)}</span>${I("down")}</button>${R.trail(R.ui.folder).map((f) => `<span>/</span><button data-folder="${E(f.id)}">${E(f.name)}</button>`).join("")}</div><div class="header-search">${R.search()}</div><div class="header-tools">${R.btn(I("settings"), "customize", "icon-button", 'aria-label="Settings"')}${!relayRunsInTabs ? R.btn(I(document.body.dataset.appearance === "dark" ? "sun" : "moon"), "toggle-appearance", "icon-button", `aria-label="Switch to ${document.body.dataset.appearance === "dark" ? "light" : "dark"} mode"`) : ""}</div></header>`;
  R.paths ||= {};
  R.paths.sun = "M12 3V1m0 22v-2M3 12H1m22 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0";
  actions["toggle-appearance"] = () => {
    if (relayRunsInTabs)
      return;
    R.data.prefs.appearance = document.body.dataset.appearance === "dark" ? "light" : "dark";
    R.save();
    R.render();
  };
  for (const [action, delta] of [["board-left", -1], ["board-right", 1]])
    actions[action] = (b) => {
      R.reorder(R.data.columns, b.dataset.id, delta);
      R.refreshStatuses();
      R.save();
      R.render();
      document.querySelector(`.lane-name[data-column-name="${b.dataset.id}"]`)?.focus();
      R.toast("Column moved");
    };
  document.addEventListener("change", (event) => {
    const el = event.target;
    if (el.matches(".lane-name")) {
      const column = R.data.columns.find((c) => c.id === el.dataset.columnName);
      if (column) {
        column.name = el.value.trim() || "Untitled column";
        el.value = column.name;
        R.refreshStatuses();
        R.save();
      }
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.target.matches(".lane-name") && event.key === "Enter") {
      event.preventDefault();
      event.target.blur();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && modal.open && modalKind === "editor") {
      event.preventDefault();
      document.querySelector("#note-form")?.requestSubmit();
    }
  });
  R.applyAppearance();
  R.render();
  R.date = (time, options = { day: "numeric", month: "long" }) => new Intl.DateTimeFormat(undefined, options).format(time);
  const localSidebar = R.sidebar;
  R.sidebar = () => localSidebar().replace("Yours, in this browser.", "Local to your Tabs profile.");
  const localDataSettings = R.dataSettings;
  R.dataSettings = () => localDataSettings().replaceAll("in this browser", "in your Tabs profile").replace("there is no account or cloud sync in this prototype", "there is no cloud sync");
  R.download = (text, name) => {
    const html = `${R.modalTop("TAKE YOUR WORDS WITH YOU")}<h2 id="modal-title">${E(name)}</h2><p class="modal-intro">Select and copy this export into a file on your computer. For backups, keep the .json filename so Relay can restore it later.</p><textarea id="relay-export-text" class="backup-text" readonly aria-label="Export contents">${E(text)}</textarea><div class="dialog-actions">${R.btn("Copy export", "copy-relay-export", "button primary")}${R.btn("Select all", "select-relay-export", "button secondary")}</div><p class="settings-help">Tabs does not currently provide extensions with a native file-save API. Copying keeps this export available without extra permissions.</p>`;
    R.showModal(html, "export");
  };
  actions["select-relay-export"] = () => {
    const input = document.querySelector("#relay-export-text");
    input.focus();
    input.select();
    R.toast("Selected. Press your copy shortcut, then save to a file.");
  };
  actions["copy-relay-export"] = async () => {
    const input = document.querySelector("#relay-export-text");
    try {
      await navigator.clipboard.writeText(input.value);
      R.toast("Export copied. Save it to a file on your computer.");
    } catch {
      input.focus();
      input.select();
      R.toast("Press your copy shortcut to copy the selected export.");
    }
  };
  const showAttachment = actions["open-attachment"];
  actions["open-attachment"] = async (button) => {
    await R.filesReady;
    const file = await R.getFile(button.dataset.fileId);
    if (file && !/^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,/i.test(file.src)) {
      if (modalKind === "editor")
        R.saveDraft();
      R.showModal(`${R.modalTop("KEPT WITH YOUR NOTE")}<h2 id="modal-title">${E(file.name)}</h2><p class="modal-intro">This file is stored with your note and included in full backups. This version of Tabs does not provide an extension file-save API.</p>`, "attachment");
      return;
    }
    return showAttachment(button);
  };
  R.research = () => R.showModal(`${R.modalTop("RELAY · 0.1.0")}<h2 id="modal-title">A place to keep going.</h2><p class="modal-intro">Keep the thought behind your work: what you tried, what comes next, and anything you want to remember.</p><p class="settings-help">Notes, logos, attachments, and Trash stay in this extension’s browser storage in your assigned Tabs profile. A shared profile shares its notebook across Tabs projects; choose a project-isolated profile in Tabs to keep them apart. Relay has no remote service, telemetry, or editor/file access.</p>`, "about");
  actions.research = R.research;
  R.render();
})();

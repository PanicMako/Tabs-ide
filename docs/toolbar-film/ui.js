/* The Tabs interface, rebuilt as DOM so the film can light, move and time every piece of it.
   Layouts follow the real app (project tabs, tool pills, Code / Agents / Dock / Browser / Git). */
(() => {
  const L = window.LOGOS;
  const svg = (inner, cls = "stroke") => `<svg viewBox="0 0 24 24" class="${cls}">${inner}</svg>`;
  const IC = {
    code: svg('<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>'),
    agents: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9 11.5h.01M12.5 11.5h.01M16 11.5h.01"/>'),
    dock: svg('<path d="M4 6l6 6-6 6M12 18h8"/>'),
    git: svg('<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 7.5v9M18 10.5c0 4-6 3-12 6"/>'),
    browser: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
    testing: svg('<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3M7.5 15h9"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>'),
    files: svg('<path d="M8 4h8l4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM4 8v12a2 2 0 0 0 2 2"/>'),
    branch: svg('<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="9" r="2.4"/><path d="M6 8.4v7.2M18 11.4c0 3.6-6 2.6-12 5"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>'),
    server: svg('<rect x="3.5" y="4" width="17" height="6.5" rx="2"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="2"/><path d="M7 7.2h.01M7 16.8h.01"/>'),
    term: svg('<path d="M5 8l4 4-4 4M12 16h7"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>'),
    box: svg('<path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8"/>'),
    up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    back: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
    fwd: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    reload: svg('<path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5"/>'),
    cam: svg('<rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="12" cy="13.5" r="3.4"/><path d="M8.5 7l1.5-2.5h4L15.5 7"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    pin: svg('<path d="M12 17v5M7 3h10l-1.5 7 3 4H5.5l3-4z"/>'),
    doc: svg('<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 3v5h5M9 13h6M9 17h6"/>'),
    figma: L.figma, claude: L.claude, codex: L.codex,
  };
  const bars = (ws) => ws.map((w) => `<i class="bar${w < 0 ? " hi" : ""}" style="width:${Math.abs(w)}%"></i>`).join("");
  const esc = (s) => s.replace(/</g, "&lt;");

  /* ── tool pills ── */
  const BASE = [["code", "Code"], ["agents", "Agents"], ["dock", "Dock"], ["git", "Git"], ["browser", "Browser"], ["testing", "Testing"]];
  const toolbar = (extra = []) => `<div class="toolrow"><i class="hl"></i>
      ${[...BASE, ...extra].map(([id, label, ic]) => `<div class="pill" data-tool="${id}"><span class="ic">${ic || IC[id]}</span><span>${label}</span></div>`).join("")}
      <div class="settings"><span class="ic">${IC.gear}</span>Settings</div></div>`;

  /* ── Code ── */
  const code = (lines) => lines.map((l, i) => `<div class="ln" data-at="${(0.1 + i * 0.03).toFixed(2)}"><span class="n">${i + 1}</span><span>${l}</span></div>`).join("");
  const codePane = ({ project, file, tree, etabs, lines, after = [], typed, typedAt = 1.9, typedCps = 30 }) => `
    <div class="subbar"><div class="crumb">${project} <b>/</b> <em>${file}</em></div><div class="goto">${IC.search}<span>Go to file</span><kbd>⌘P</kbd></div><div class="sbi">${IC.files}${IC.term}${IC.agents}</div></div>
    <div class="cols">
      <div class="rail">${[IC.files, IC.search, IC.branch, IC.box].map((s, i) => `<i class="${i ? "" : "on"}">${s}</i>`).join("")}</div>
      <div class="card tree"><h6>Explorer</h6>${tree.map(([n, c]) => `<div class="${c || ""}">${n}</div>`).join("")}<div class="tfoot"><span>› Outline</span><span>› Timeline</span></div></div>
      <div class="card editor">
        <div class="etabs">${etabs.map((x, i) => `<span class="${i ? "" : "on"}">${x}${i ? "" : "<b>×</b>"}</span>`).join("")}</div>
        <div class="ecrumb">src <b>›</b> ${file} <b>›</b> <em>Hero</em></div>
        <div class="code">${code(lines)}<div class="ln cur" data-at="0.6"><span class="n">${lines.length + 1}</span><span data-type="${typedAt},${typedCps}">${typed}</span><i class="caret"></i></div>${code(after).replace(/class="n">(\d+)/g, (_, n) => `class="n">${+n + lines.length + 1}`)}</div>
        <div class="mini">${bars([55, 88, 70, 38, 82, 64, 30, 76, 92, 48, 62, 80, 44, 70, 58, 36])}</div>
      </div>
      <div class="card sidechat"><div class="sctabs"><span class="on">Chat</span><span>Codex</span><span>Claude Code</span></div>
        <div class="scempty"><span class="ic">${IC.agents}</span><b>Build with Agent</b><small>Ask about your code, or hand off a task.</small></div>
        <div class="sccomp"><div class="scfile">${IC.doc}<em>${file}</em></div><div class="scrow"><span>Models</span><i class="send">${IC.up}</i></div></div></div>
    </div>`;

  const PANES = {
    code: codePane({
      project: "atlas-web", file: "Hero.tsx",
      tree: [["▾ atlas-web", "b"], ["▾ src", "in"], ["Hero.tsx", "in2 on"], ["Nav.tsx", "in2"], ["theme.css", "in2"], ["routes.ts", "in2"], ["▸ components", "in"], ["▸ public", "in"], ["package.json", "in"], ["README.md", "in"]],
      etabs: ["Hero.tsx", "theme.css", "routes.ts"],
      lines: [
        `<span class="k">import</span> { Compass } <span class="k">from</span> <span class="s">"./components"</span>;`,
        `<span class="k">import</span> <span class="s">"./theme.css"</span>;`,
        ``,
        `<span class="k">export function</span> <span class="f">Hero</span>() {`,
        `  <span class="k">return</span> (`,
        `    &lt;<span class="t">section</span> className=<span class="s">"hero"</span>&gt;`,
        `      &lt;<span class="t">Compass</span> spin /&gt;`,
      ],
      after: [`      &lt;<span class="t">p</span>&gt;Field guides for people who wander.&lt;/<span class="t">p</span>&gt;`, `      &lt;<span class="t">Toggle</span> theme=<span class="s">"night"</span> /&gt;`, `    &lt;/<span class="t">section</span>&gt;`, `  );`, `}`],
      typed: `      &lt;h1&gt;Get a little lost.&lt;/h1&gt;`, typedAt: 1.95, typedCps: 26,
    }),

    agents: `
      <div class="side">
        <div class="shead"><small>AGENTS</small><b>atlas-web</b></div>
        <div class="newt">${IC.plus}<span>New Thread</span><kbd>⇧⌘O</kbd></div>
        <div class="seg"><span class="on">Active</span><span>Settled</span></div>
        <div class="th on"><b><i></i>Night theme</b><small>${IC.branch} atlas/night-theme</small></div>
        <div class="th"><b>Fix flaky routes test</b><small>Settled</small></div>
        <div class="th"><b>Upgrade to Vite 7</b><small>Settled</small></div>
      </div>
      <div class="chat">
        <div class="ctitle"><b>Night theme</b> · atlas-web</div>
        <div class="ubub" data-at="0.16">Give the landing page a night theme.</div>
        <div class="who" data-at="0.62"><span class="ic">${IC.claude}</span>claude</div>
        <div class="say" data-at="0.66"><span data-type="0.7,64">On it. I’ll add night tokens and a toggle in the header.</span></div>
        <div class="chip" data-at="1.25"><em>Read</em>src/theme.css<span class="ok">${IC.check}</span></div>
        <div class="chip" data-at="1.45"><em>Edit</em>src/theme.css<span class="add">+24</span><span class="del">−3</span><span class="ok">${IC.check}</span></div>
        <div class="chip" data-at="1.65"><em>Run</em>bun test<span class="pass">42 passed</span></div>
        <div class="composer"><div class="crow"><span class="model"><span class="ic">${IC.claude}</span>Claude · High</span><span class="opt">${IC.box}Build</span><span class="opt">${IC.lock}Full access</span></div>
          <div class="cph">Ask for follow-up changes or attach images</div><i class="send">${IC.up}</i></div>
      </div>
      <div class="rcol">
        <div class="card pj"><span class="ic">${IC.folder}</span><div><b>atlas-web</b><small>~/code/atlas-web</small></div></div>
        <div class="card br"><span class="ic">${IC.branch}</span><code>atlas/night-theme</code></div>
        <div class="card chg" data-at="1.5"><span>± Changes</span><span><b class="add">+24</b> <b class="del">−3</b></span></div>
        <div class="card cm">Commit</div>
      </div>`,

    dock: `
      <div class="dhead"><span class="ic">${IC.dock}</span><b>Dock</b><small>atlas-web · 2 running</small><span class="dbtn">Presets</span><span class="dbtn on">Arrange</span><span class="dbtn">Inspector</span></div>
      <div class="dcols">
        <div class="card presets"><h6>Presets<span>＋ New</span></h6><small>Running · 2</small>
          <div class="pre on"><span class="ic">${IC.globe}</span><div><b>Web</b><small><i></i>running</small></div></div>
          <div class="pre"><span class="ic">${IC.server}</span><div><b>API</b><small><i></i>running</small></div></div>
          <div class="pre idle"><span class="ic">${IC.term}</span><div><b>Terminal 1</b></div></div>
          <div class="edit">Edit presets</div></div>
        <div class="card terms"><div class="thead"><b>Side by side</b><small>2 terminals</small><span>＋ Terminal</span></div>
          <div class="tcols">
            <div class="term on"><header>Web<i></i></header><pre><div data-at="0.25"><span class="d">$</span> bun dev</div><div data-at="0.5">&nbsp;</div><div data-at="0.55"><span class="badge">VITE</span> <span class="g">v7.0.5</span> ready in <b>412 ms</b></div><div data-at="0.62">&nbsp;</div><div data-at="0.7"><span class="g">➜</span> Local   <span class="u">http://localhost:4173/</span></div><div data-at="0.78"><span class="g">➜</span> Network <span class="d">use --host to expose</span></div><div data-at="0.86">&nbsp;</div><div data-at="1.25"><span class="d">10:42:07</span> hmr update <span class="g">/src/theme.css</span></div><div data-at="1.5"><span class="d">10:42:07</span> hmr update <span class="g">/src/Nav.tsx</span></div><div data-at="1.5"><i class="caret blk"></i></div></pre></div>
            <div class="term"><header>API<i></i></header><pre><div data-at="0.35"><span class="d">$</span> node server.js</div><div data-at="0.6"><span class="d">[api]</span> listening on <span class="u">:8080</span></div><div data-at="0.75"><span class="d">[api]</span> sqlite pool connected</div><div data-at="0.95"><span class="d">[api]</span> GET /v1/status <span class="g">200</span> 6ms</div><div data-at="1.15"><span class="d">[api]</span> GET /v1/routes <span class="g">200</span> 11ms</div><div data-at="1.4"><span class="d">[api]</span> GET /v1/places <span class="g">200</span> 9ms</div><div data-at="1.7"><span class="d">[api]</span> GET /v1/places/7 <span class="g">200</span> 4ms</div></pre></div>
          </div></div>
      </div>`,

    browser: `
      <div class="urlrow"><span class="nav">${IC.back}${IC.fwd}${IC.reload}</span><div class="url">${IC.lock}<span>http://localhost:4173/</span></div><span class="ubtn">${IC.cam}Capture</span><span class="ubtn">Tools</span><span class="ubtn">View</span></div>
      <div class="page">
        <div class="site day"></div>
        <div class="site night"></div>
      </div>`,

    git: `
      <div class="side">
        <div class="shead"><small>SOURCE CONTROL</small><b>atlas-web</b></div>
        <label>Workspace</label>
        <div class="gi">Overview</div><div class="gi on">Changes<u>3</u></div><div class="gi">Code Review</div><div class="gi">Diff</div><div class="gi">Divergence</div>
        <label>Repository</label>
        <div class="gi">Branches</div><div class="gi">History</div><div class="gi">Pull requests</div><div class="gi">Stashes</div>
      </div>
      <div class="gmain">
        <div class="gcrumb">${IC.folder} atlas-web <b>/</b> <code>${IC.branch} atlas/night-theme</code></div>
        <h2>Changes</h2><p class="gsub">3 files changed on <code>atlas/night-theme</code></p>
        <div class="gcols">
          <div class="card files"><h6>COMMIT<span>3 staged</span></h6>
            <div class="chgf on" data-at="0.2"><u>M</u>src/theme.css<span><b class="add">+24</b> <b class="del">−3</b></span></div>
            <div class="chgf" data-at="0.27"><u>M</u>src/Nav.tsx<span><b class="add">+9</b> <b class="del">−1</b></span></div>
            <div class="chgf" data-at="0.34"><u>M</u>src/Hero.tsx<span><b class="add">+2</b> <b class="del">−1</b></span></div>
            <div class="msg" data-at="0.45"><span data-type="0.55,30">Add night theme</span><i class="caret"></i></div>
            <div class="commit"><span class="c1">${IC.branch}Commit to atlas/night-theme</span><span class="c2">${IC.check}Committed</span></div></div>
          <div class="card diff"><h6>src/theme.css</h6>
            ${[["h", "@@ -12,6 +12,27 @@ :root {"], ["", "    --paper: #f6efe2;"], ["", "    --ink: #17181c;"], ["r", "-   --sun: #ff8a66;"], ["a", "+   --sun: var(--glow);"], ["", "  }"], ["a", "+"], ["a", '+ [data-theme="night"] {'], ["a", "+   --paper: #0d1030;"], ["a", "+   --ink: #f3efe9;"], ["a", "+   --glow: #b9a6ff;"], ["a", "+ }"]]
              .map(([c, l], i) => `<div class="dl ${c}" data-at="${(0.22 + i * 0.028).toFixed(2)}">${esc(l)}</div>`).join("")}
          </div>
        </div>
      </div>`,

    /* passes-api: its own Dock */
    dock2: `
      <div class="dhead"><span class="ic">${IC.dock}</span><b>Dock</b><small>passes-api · 2 running</small><span class="dbtn">Presets</span><span class="dbtn on">Arrange</span><span class="dbtn">Inspector</span></div>
      <div class="dcols">
        <div class="card presets"><h6>Presets<span>＋ New</span></h6><small>Running · 2</small>
          <div class="pre on"><span class="ic">${IC.server}</span><div><b>API</b><small><i></i>running</small></div></div>
          <div class="pre"><span class="ic">${IC.box}</span><div><b>Worker</b><small><i></i>running</small></div></div>
          <div class="pre idle"><span class="ic">${IC.term}</span><div><b>Tests</b></div></div>
          <div class="edit">Edit presets</div></div>
        <div class="card terms"><div class="thead"><b>Side by side</b><small>2 terminals</small><span>＋ Terminal</span></div>
          <div class="tcols">
            <div class="term on"><header>API<i></i></header><pre><div><span class="d">$</span> uvicorn app.main:app --reload</div><div><span class="g">INFO</span>  Uvicorn running on <span class="u">http://127.0.0.1:8000</span></div><div><span class="g">INFO</span>  Application startup complete.</div><div><span class="g">INFO</span>  POST /tickets <span class="g">201</span></div><div><span class="g">INFO</span>  GET  /tickets/8841 <span class="g">200</span></div><div data-at="0.5"><span class="g">INFO</span>  POST /tickets <span class="g">201</span></div><div data-at="0.8"><span class="g">INFO</span>  GET  /events/12/seats <span class="g">200</span></div><div data-at="0.8"><i class="caret blk"></i></div></pre></div>
            <div class="term"><header>Worker<i></i></header><pre><div><span class="d">$</span> python -m app.worker</div><div><span class="d">[queue]</span> connected · 3 consumers</div><div><span class="d">[queue]</span> email.receipt <span class="g">ok</span> 41ms</div><div><span class="d">[queue]</span> seat.release <span class="g">ok</span> 8ms</div><div data-at="0.6"><span class="d">[queue]</span> email.receipt <span class="g">ok</span> 38ms</div><div data-at="0.95"><span class="d">[queue]</span> pass.render <span class="g">ok</span> 112ms</div></pre></div>
          </div></div>
      </div>`,

    /* studio: Figma pinned to the toolbar */
    figma: `
      <div class="urlrow"><span class="nav">${IC.back}${IC.fwd}${IC.reload}</span><div class="url">${IC.lock}<span>figma.com/design/studio-brand</span></div><span class="ubtn">${IC.cam}Capture</span><span class="ubtn">Tools</span><span class="ubtn">View</span></div>
      <div class="canvas">
        <div class="lyr"><span class="ic">${IC.figma}</span>${bars([-70, 55, 62, 48, -66, 52, 40, 58, -50, 44])}</div>
        <div class="frame sel" data-n="Poster" style="left:300px;top:70px;width:420px;height:520px"><div class="pt">Slow<br>mornings.</div><i class="blob b1"></i><i class="blob b2"></i></div>
        <div class="frame" data-n="Card" style="left:790px;top:70px;width:270px;height:240px;background:#ff8a66"><i class="blob b3"></i></div>
        <div class="frame" data-n="Palette" style="left:790px;top:372px;width:520px;height:218px"><div class="sw"><i style="background:#b9a6ff"></i><i style="background:#0e2af3"></i><i style="background:#ffd84a"></i><i style="background:#17181c"></i></div></div>
        <div class="mp" style="left:690px;top:545px">Maya</div>
      </div>`,

    /* far folders: seen soft and small, so a quiet editor is enough */
    quiet: `<div class="cols"><div class="rail">${[IC.files, IC.search, IC.branch, IC.box].map((s, i) => `<i class="${i ? "" : "on"}">${s}</i>`).join("")}</div>
      <div class="card tree"><h6>Explorer</h6>${bars([60, 48, 66, 52, 40, 58, 46, 62, 38])}</div>
      <div class="card editor q">${bars([-34, 72, 64, 80, 30, -46, 70, 58, 84, 40, 66, 52, 76, 44, 60, 36, 70])}</div></div>`,
  };

  /* the little site the agent restyles */
  const site = (night) => `
    <div class="snav"><b>Atlas</b><span>Routes</span><span>Places</span><span>Journal</span><div class="tog"><i></i></div></div>
    <div class="shero"><small>FIELD GUIDES · ${night ? "AFTER DARK" : "SPRING EDITION"}</small><h1>Get a little<br>lost.</h1><p>Hand-drawn city guides for people who would rather wander than arrive.</p><div class="cta">Start exploring</div></div>
    <div class="sart"><i class="orb"></i><i class="hill h1"></i><i class="hill h2"></i>${night ? '<i class="star" style="left:60px;top:40px"></i><i class="star" style="left:300px;top:90px"></i><i class="star" style="left:180px;top:20px"></i><i class="star" style="left:420px;top:50px"></i>' : ""}</div>`;

  const PROJECTS = [
    { name: "atlas-web", acc: "#0e2af3", on: "#ffffff", panes: ["code", "agents", "dock", "browser", "git"], extra: [], note: "web app · 6 tools" },
    { name: "passes-api", acc: "#ff8a66", on: "#17181c", panes: ["dock2"], active: "dock", extra: [["docs", "API docs", IC.doc]], note: "python · 2 terminals" },
    { name: "studio", acc: "#b9a6ff", on: "#17181c", panes: ["figma"], active: "figma", extra: [["figma", "Figma", IC.figma]], note: "design · Figma pinned" },
    { name: "field-notes", acc: "#ffd84a", on: "#17181c", panes: ["quiet"], active: "code", extra: [], note: "writing · drafts" },
    { name: "weekend-idea", acc: "#8fe0c8", on: "#17181c", panes: ["quiet"], active: "agents", extra: [], note: "prototype · 1 agent" },
  ];

  window.UI = { IC, PANES, PROJECTS, toolbar, site, bars };
})();

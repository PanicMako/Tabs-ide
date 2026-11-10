/* Tabs launch film. Every frame is a pure function of time: render(t). */
(() => {
  const DUR = 41.2, HOLD0 = 9.98, HOLD = 1.2;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, p) => a + (b - a) * p;
  const E = {
    lin: (x) => x,
    out3: (x) => 1 - (1 - x) ** 3,
    out5: (x) => 1 - (1 - x) ** 5,
    in3: (x) => x ** 3,
    io3: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
    io5: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
    back: (x) => 1 + 2.4 * (x - 1) ** 3 + 1.4 * (x - 1) ** 2,
    spring: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-6.5 * x) * Math.cos(10 * x)),
  };
  const P = (t, s, d, e = E.out5) => e(clamp((t - s) / d));
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, p, al = 1) => {
    const A = hex(a), B = hex(b);
    return `rgba(${A.map((v, i) => Math.round(lerp(v, B[i], p))).join(",")},${al})`;
  };
  const el = (html) => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild; };
  const INK = "#0a0b10", IVORY = "#f3efe9", BLUE = "#0e2af3";
  const ACC = ["#8fe0c8", "#ffb37a", "#b9a6ff"];
  const L = window.LOGOS;
  const svg = (inner, cls = "stroke") => `<svg viewBox="0 0 24 24" class="${cls}">${inner}</svg>`;
  const IC = {
    code: svg('<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>'),
    agents: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
    dock: svg('<path d="M4 6l6 6-6 6M12 18h8"/>'),
    git: svg('<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 7.5v9M18 10.5c0 4-6 3-12 6"/>'),
    browser: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>'),
    vercel: svg('<path d="M12 4l10 17H2z" fill="currentColor"/>', ""),
    dot: (c) => svg(`<rect x="3" y="3" width="18" height="18" rx="6" fill="${c}"/>`, ""),
    figma: L.figma, claude: L.claude, chatgpt: L.codex,
  };
  const MARK_BODY = "M 61 8 C 39 8 21 26 21 48 L 21 168 C 21 205 48 230 83 230 L 180 230 C 195 230 205 242 205 257 L 205 331 C 205 358 225 378 253 378 L 360 378 C 375 378 385 366 385 351 L 385 330 C 385 317 375 312 365 310 C 353 308 347 300 347 285 L 347 224 C 347 193 325 171 297 171 L 216 171 C 201 171 191 161 191 146 L 191 48 C 191 25 172 8 149 8 Z";
  const MARK_EYES = "M 76.5 108 C 70.15 108 65 113.15 65 119.5 L 65 152.5 C 65 158.85 70.15 164 76.5 164 C 82.85 164 88 158.85 88 152.5 L 88 119.5 C 88 113.15 82.85 108 76.5 108 Z M 137.5 108 C 131.15 108 126 113.15 126 119.5 L 126 152.5 C 126 158.85 131.15 164 137.5 164 C 143.85 164 149 158.85 149 152.5 L 149 119.5 C 149 113.15 143.85 108 137.5 108 Z";
  const MARK_FOOT = "M 60 251 L 185 251 L 185 318 C 185 353 165 379 132 379 L 26 379 C 12 379 2 367 2 354 L 2 306 C 2 275 26 251 60 251 Z";
  const WORD = "M 0 1 H 94 V 17 H 60 V 80 H 38 V 17 H 0 Z M 82 80 L 118.5 1 H 150 L 185 80 H 160 L 152 62 H 112 L 103 80 Z M 120 48 H 144 L 132.5 19 Z M 192 1 H 248 C 274 1 284 11 284 24 C 284 35 279 41 269 44 C 283 46 289 55 289 65 C 289 78 279 80 252 80 H 192 Z M 212 17 V 34 H 249 C 258 34 261 31 261 26 C 261 20 256 17 249 17 Z M 212 47 V 65 H 251 C 261 65 265 62 265 56 C 265 50 261 47 251 47 Z M 384 26 H 362 V 22 C 362 17 356 15 346 15 H 328 C 314 15 310 18 310 23 C 310 29 317 31 330 33 L 355 37 C 379 40 386 48 386 62 C 386 76 373 81 349 81 H 324 C 300 81 290 75 290 57 H 313 C 313 64 318 66 330 66 H 348 C 362 66 365 63 365 58 C 365 52 358 50 345 48 L 320 44 C 298 41 291 34 291 23 C 291 7 304 0 330 0 H 350 C 372 0 384 6 384 21 Z";
  const markSvg = `<svg viewBox="0 0 390 390"><path fill="currentColor" fill-rule="evenodd" d="${MARK_BODY} ${MARK_EYES}"/><path fill="currentColor" d="${MARK_FOOT}"/></svg>`;

  /* ── timeline ── */
  const T = { fold: 6.5, unify: 8.5, flood: 9.55, grow: 10.0, proj: 22.3, fan: 25.9, qa: 28.2, prov: 32.0, end: 35.2 };
  const APP = { x: 600, y: 145, w: 1240, h: 790 };
  const K = 0.64;
  const HL = [[0, "code"], [13.0, "agents"], [15.5, "dock"], [17.2, "browser"], [19.0, "git"], [20.4, "figma"], [21.2, "claude"], [23.2, "code"], [24.3, "figma2"], [25.2, "code"]];
  const PANELS = [[10.9, "code"], [13.0, "agents"], [15.5, "dock"], [17.2, "browser"], [19.0, "git"], [20.4, "figma"], [21.2, "claude"], [23.2, "code2"], [24.3, "figma"], [25.2, "code"]];
  const PJ = [[0, 0], [23.2, 1], [24.3, 2], [25.2, 0]];
  const CAPS = [
    [10.6, "Code.", "A full Code OSS editor, built in."],
    [13.0, "Agents.", "Claude, Codex, Cursor and more, in one focused chat."],
    [15.5, "Terminal.", "Run your dev servers side by side."],
    [17.2, "Browser.", "Preview localhost right where you build."],
    [19.0, "Git.", "Review the diff. Commit. Ship."],
    [20.4, "Anything.", "Pin any website or CLI to the toolbar."],
    [22.3, "Projects.", "Switch projects the way you switch browser tabs."],
    [25.8, "All live.", "Each project keeps its own tools, agents and terminals."],
    [28.2, "Scratch.", "Quick Actions opens a throwaway browser or terminal."],
    [32.0],
  ];
  const sched = (list, t) => {
    let i = 0;
    while (i + 1 < list.length && list[i + 1][0] <= t) i++;
    return { i, cur: list[i][1], prev: i ? list[i - 1][1] : list[i][1], lt: t - list[i][0], next: list[i + 1] ? list[i + 1][0] : 1e9 };
  };

  /* ── chaos windows / pills ── */
  const bars = (ws) => ws.map((w) => `<div class="b${w < 0 ? " hi" : ""}" style="width:${Math.abs(w)}%"></div>`).join("");
  const glyph = (h, c) => `<div class="glyph" style="color:${c || "inherit"}">${h}</div>`;
  const WIN = {
    code: { title: "editor — atlas-web", col: "#f3efe9", fg: INK, x: 540, y: 240, w: 820, h: 540, tIn: 0.3,
      body: `<div class="row"><div style="flex:0 0 150px">${bars([70, 90, 60, 80, 50, 75, 64])}</div><div>${bars([-46, 82, 70, 91, 38, -58, 77, 66, 88, 42, 71, 55])}</div></div>` },
    dock: { title: "zsh — bun dev", col: "#191b21", fg: IVORY, x: 1150, y: 560, w: 640, h: 400, tIn: 0.95,
      body: `<div class="mono">$ bun dev\n  VITE  ready in 412 ms\n  ➜ Local   http://localhost:4173/\n  ➜ Network use --host to expose\n\n$ ▌</div>` },
    browser: { title: "localhost:4173", col: "#ffd84a", fg: INK, x: 110, y: 110, w: 660, h: 430, tIn: 1.45,
      body: `${bars([-40])}<div class="b tall"></div><div class="row"><div class="b tall"></div><div class="b tall"></div><div class="b tall"></div></div>` },
    figma: { title: "Figma", col: "#b9a6ff", fg: INK, x: 1210, y: 60, w: 620, h: 420, tIn: 1.85,
      body: `${glyph(L.figma)}<div class="row"><div class="b tall" style="height:150px"></div><div class="b tall" style="height:150px"></div><div class="b tall" style="height:150px"></div></div>` },
    agents: { title: "Agent session", col: "#8fe0c8", fg: INK, x: 80, y: 600, w: 600, h: 400, tIn: 2.2,
      body: `<div class="bub r"></div><div class="bub l"></div><div class="bub l" style="margin-right:45%"></div><div class="bub r"></div><div class="bub l"></div>` },
    claude: { title: "claude.ai", col: "#ff8a66", fg: INK, x: 720, y: 30, w: 500, h: 350, tIn: 2.5,
      body: `${glyph(L.claude)}<div class="bub r"></div><div class="bub l"></div><div class="bub l" style="margin-right:50%"></div>` },
    git: { title: "Git — 3 changes", col: BLUE, fg: IVORY, x: 770, y: 660, w: 560, h: 380, tIn: 2.75,
      body: `${glyph(IC.git)}${bars([-60, 80, 72, 86, 55])}` },
    chatgpt: { title: "ChatGPT", col: "#f3efe9", fg: INK, x: 1400, y: 320, w: 470, h: 340, tIn: 2.95,
      body: `${glyph(L.codex)}<div class="bub r"></div><div class="bub l"></div><div class="bub l" style="margin-right:50%"></div>` },
    vercel: { title: "Vercel — deployments", col: "#ff9fd0", fg: INK, x: 330, y: 390, w: 480, h: 330, tIn: 3.12,
      body: `${glyph(IC.vercel)}${bars([-70, 88, 76, 60])}` },
  };
  const PILLS = [
    ["code", "Code"], ["agents", "Agents"], ["dock", "Dock"], ["git", "Git"], ["browser", "Browser"],
    ["figma", "Figma"], ["claude", "Claude"], ["chatgpt", "ChatGPT"], ["vercel", "Vercel"],
  ].map(([id, label], i) => ({ id, label, i, win: WIN[id], proj: i < 5 ? -1 : 0 }));
  const EXTRA = [
    { id: "linear", label: "Linear", proj: 1, ic: IC.dot("#8b8ff8") }, { id: "supabase", label: "Supabase", proj: 1, ic: IC.dot("#3ecf8e") }, { id: "render", label: "Render", proj: 1, ic: IC.dot("#e9e6e0") },
    { id: "figma2", label: "Figma", proj: 2, ic: L.figma }, { id: "notion", label: "Notion", proj: 2, ic: IC.dot("#e9e6e0") }, { id: "claude2", label: "Claude Code", proj: 2, ic: L.claude },
  ];
  const popOrder = Object.values(WIN).sort((a, b) => a.tIn - b.tIn);

  /* ── panels ── */
  const codeLines = (lines) => lines.map((l, i) => `<div class="ln" data-at="${(0.12 + i * 0.035).toFixed(3)}"><span class="n">${i + 1}</span><span>${l}</span></div>`).join("");
  const codePanel = (files, tabs, lines, typed) => `
    <div class="tree"><h6>Explorer</h6>${files.map((f) => `<div class="${f[1] || ""}">${f[0]}</div>`).join("")}</div>
    <div class="editor"><div class="etabs">${tabs.map((x, i) => `<span class="${i ? "" : "on"}">${x}</span>`).join("")}</div>
      <div class="code">${codeLines(lines)}<div class="ln" data-at="0.7"><span class="n">${lines.length + 1}</span><span data-type="0.8,34">${typed}</span><i class="caret"></i></div></div>
      <div class="mini">${bars([60, 90, 70, 40, 85, 66, 30, 78, 92, 50, 64, 80, 45, 70])}</div></div>`;
  const PANEL = {
    code: codePanel(
      [["▾ atlas-web"], ["▾ src", "in"], ["Header.tsx", "in on"], ["theme.css", "in"], ["routes.ts", "in"], ["▸ components", "in"], ["▸ public"], ["package.json"], ["README.md"]],
      ["Header.tsx", "theme.css", "routes.ts"],
      [
        `<span class="k">import</span> { useTheme } <span class="k">from</span> <span class="s">"./theme"</span>;`,
        ``,
        `<span class="k">export function</span> <span class="f">Header</span>() {`,
        `  <span class="k">const</span> { mode, toggle } = <span class="f">useTheme</span>();`,
        ``,
        `  <span class="k">return</span> (`,
        `    &lt;<span class="t">header</span> className=<span class="s">"site-header"</span>&gt;`,
        `      &lt;<span class="t">Logo</span> /&gt;`,
        `      &lt;<span class="t">Nav</span> items={routes} /&gt;`,
        `      &lt;<span class="t">Toggle</span> on={mode === <span class="s">"dark"</span>} onChange={toggle} /&gt;`,
        `    &lt;/<span class="t">header</span>&gt;`,
        `  );`,
        `}`,
        ``,
      ],
      `// one window. zero alt-tab.`,
    ),
    code2: codePanel(
      [["▾ passes-api"], ["▾ app", "in"], ["tickets.py", "in on"], ["models.py", "in"], ["auth.py", "in"], ["▸ tests", "in"], ["▸ migrations"], ["pyproject.toml"]],
      ["tickets.py", "models.py"],
      [
        `<span class="k">from</span> fastapi <span class="k">import</span> APIRouter, Depends`,
        ``,
        `router = <span class="f">APIRouter</span>(prefix=<span class="s">"/tickets"</span>)`,
        ``,
        `<span class="t">@router.post</span>(<span class="s">"/"</span>)`,
        `<span class="k">async def</span> <span class="f">issue_ticket</span>(order: Order, db=<span class="f">Depends</span>(session)):`,
        `    seat = <span class="k">await</span> db.<span class="f">hold_seat</span>(order.event_id)`,
        `    <span class="k">return</span> <span class="f">Ticket</span>(seat=seat, owner=order.user)`,
        ``,
      ],
      `# a different project, one tab away`,
    ),
    agents: `
      <div class="threads"><div class="newt">＋ New thread</div>
        <div class="th on"><b><i></i>Dark mode toggle</b><small>working · atlas-web</small></div>
        <div class="th"><b>Fix flaky auth test</b><small>settled</small></div>
        <div class="th"><b>Upgrade to Vite 7</b><small>settled</small></div></div>
      <div class="chat">
        <div class="ubub" data-at="0.2">Add a dark mode toggle to the header.</div>
        <div class="who" data-at="0.55">${L.claude}<span>claude</span></div>
        <div class="say" data-at="0.6"><span data-type="0.65,70">On it. I’ll add a toggle and wire it to your theme tokens.</span></div>
        <div class="chip" data-at="1.25"><em>Read</em> src/Header.tsx<span class="ok">✓</span></div>
        <div class="chip" data-at="1.5"><em>Edit</em> src/theme.css <span class="add">+24</span> <span class="del">−3</span><span class="ok">✓</span></div>
        <div class="chip" data-at="1.75"><em>Run</em> bun test<span class="ok">42 passed</span></div>
        <div class="composer">Ask for follow-up changes<div class="model">${L.claude} Claude · High</div><div class="send">↑</div></div>
      </div>`,
    dock: `<div class="dock">
        <div class="term on"><header><i></i>Web<small>bun dev</small></header><pre>
<div data-at="0.15"><span class="d">$</span> bun dev</div><div data-at="0.4">&nbsp;</div><div data-at="0.5"><span class="badge">VITE</span> <span class="g">v7.0.5</span> ready in <b>412 ms</b></div><div data-at="0.6">&nbsp;</div><div data-at="0.7">  <span class="g">➜</span>  Local:   <span class="y">http://localhost:4173/</span></div><div data-at="0.8">  <span class="g">➜</span>  Network: <span class="d">use --host to expose</span></div><div data-at="1.15"><span class="d">10:42:07</span> hmr update <span class="g">/src/theme.css</span></div></pre></div>
        <div class="term"><header><i></i>API<small>node server.js</small></header><pre>
<div data-at="0.3"><span class="d">[api]</span> listening on <span class="y">:8080</span></div><div data-at="0.55"><span class="d">[api]</span> sqlite pool connected</div><div data-at="0.85"><span class="d">[api]</span> GET /v1/status <span class="g">200</span> 6ms</div><div data-at="1.1"><span class="d">[api]</span> GET /v1/routes <span class="g">200</span> 11ms</div><div data-at="1.3"><span class="d">[api]</span> GET /v1/places <span class="g">200</span> 9ms</div></pre></div></div>`,
    browser: `<div class="urlbar">←&nbsp;&nbsp;→&nbsp;&nbsp;↻<div class="url">localhost:4173</div></div>
      <div class="page"><div class="pnav"><b>Atlas</b><span>Routes</span><span>Places</span><span>Journal</span><div class="tog"><i></i></div></div>
        <h1 data-at="0.15">Wander<br>farther.</h1><p data-at="0.3">Hand-drawn city guides for people who would rather get a little lost.</p><div class="cta" data-at="0.42">Start exploring</div>
        <div class="art" data-at="0.25"><i style="width:340px;height:340px;left:-70px;top:150px;background:#0e2af3"></i><i style="width:210px;height:210px;right:-30px;top:-40px;background:#ff8a66"></i><i style="width:120px;height:120px;right:90px;top:210px;background:#ffd84a"></i></div></div>`,
    git: `<div class="changes"><h6>Changes · 3</h6>
        <div class="chg on" data-at="0.12"><u>M</u>src/Header.tsx<span><b class="add">+9</b> <b class="del">−1</b></span></div>
        <div class="chg" data-at="0.18"><u>M</u>src/theme.css<span><b class="add">+24</b> <b class="del">−3</b></span></div>
        <div class="chg" data-at="0.24"><u>M</u>src/theme.ts<span><b class="add">+12</b> <b class="del">−0</b></span></div>
        <div class="commit"><div class="msg">Add dark mode toggle</div><div class="btn"><span class="c1">Commit to main</span><span class="c2">✓ Committed</span></div></div></div>
      <div class="diff"><h6>src/Header.tsx</h6>
        ${[["h", "@@ -6,7 +6,15 @@ export function Header() {"], ["", "   return ("], ["", '     <header className="site-header">'], ["", "       <Logo />"], ["r", "-      <Nav items={routes} />"], ["a", "+      <Nav items={routes} />"], ["a", '+      <Toggle on={mode === "dark"}'], ["a", "+        onChange={toggle} />"], ["", "     </header>"], ["", "   );"]]
          .map(([c, l], i) => `<div class="dl ${c}" data-at="${(0.15 + i * 0.03).toFixed(2)}">${l.replace(/</g, "&lt;")}</div>`).join("")}</div>`,
    figma: `<div class="urlbar">←&nbsp;&nbsp;→&nbsp;&nbsp;↻<div class="url">figma.com/design/atlas-brand</div></div>
      <div class="canvas"><div class="lyr">${L.figma}${bars([-70, 55, 62, 48, -66, 52, 40])}</div>
        <div class="frame sel" data-n="Home" data-at="0.12" style="left:270px;top:70px;width:400px;height:300px"><div style="font:400 44px/1 Hebdomadal">Wander<br>farther.</div><div style="position:absolute;right:18px;bottom:18px;width:120px;height:120px;border-radius:50%;background:#0e2af3"></div></div>
        <div class="frame" data-n="Card" data-at="0.2" style="left:730px;top:70px;width:220px;height:300px;background:#ff8a66"></div>
        <div class="frame" data-n="Palette" data-at="0.28" style="left:270px;top:430px;width:680px;height:130px;display:flex;gap:12px"><i style="flex:1;border-radius:10px;background:#0e2af3"></i><i style="flex:1;border-radius:10px;background:#ffd84a"></i><i style="flex:1;border-radius:10px;background:#8fe0c8"></i><i style="flex:1;border-radius:10px;background:#0a0b10"></i></div>
        <div class="mp" data-at="0.4" style="left:610px;top:330px">Maya</div></div>`,
    claude: `<div class="cc"><div class="logo" data-at="0.1">${L.claude}Claude Code<small style="color:var(--dim);font:14px var(--mono);margin-left:8px">~/atlas-web</small></div>
        <div class="d" data-at="0.2">A terminal tab, pinned to this project's toolbar.</div>
        <div class="box" data-at="0.3">&gt; <span data-type="0.35,40">fix the flaky test in auth.spec.ts</span><i class="caret"></i></div></div>`,
  };

  /* ── build DOM ── */
  const stage = $("#stage"), world = $("#world"), app = $("#app"), pillsEl = $("#pills"), hl = $("#hl");
  const ghosts = ["passes-api", "studio"].map((n, i) => {
    const g = el(`<div class="ghost" style="background:#1a1d21;border-radius:20px;box-shadow:0 0 0 1px rgba(255,255,255,.1) inset,0 20px 50px rgba(10,11,16,.25);left:${APP.x}px;top:${APP.y}px;width:${APP.w}px;height:200px;transform-origin:50% 0"><div style="display:flex;align-items:center;gap:10px;padding:13px 26px;color:#e9e6e0;font-weight:500;font-size:17px"><i style="width:10px;height:10px;border-radius:50%;background:${ACC[i + 1]}"></i>${n}</div></div>`);
    world.insertBefore(g, world.firstChild);
    return g;
  });
  app.innerHTML = `<div class="chrome">
      <div class="tabsrow"><div class="lights"><i></i><i></i><i></i></div>
        ${["atlas-web", "passes-api", "studio"].map((n, i) => `<div class="ptab"><div class="bg"></div><i class="dot" style="background:${ACC[i]}"></i><span>${n}</span><span class="x">×</span></div>`).join("")}
        <div class="plus">+</div></div>
      <div class="toolrow"><div class="settings">⚙ Settings</div></div>
      <div class="content">${Object.entries(PANEL).map(([k, h]) => `<div class="panel" data-p="${k}">${h}</div>`).join("")}
        <div id="qa"><div class="dimmer"></div>
          <div class="wheel"><div class="hub">${markSvg}</div>${[IC.code, IC.agents, IC.browser, IC.dock, IC.search, IC.git].map((s) => `<div class="sat">${s}</div>`).join("")}</div>
          <div class="qlabel"></div>
          <div class="scratch"><header>◌ Scratch browser<small>temporary · closes when you’re done</small></header><div class="search">${IC.search}<span id="q"></span><i class="caret" style="height:24px;width:2px"></i></div>
            <div class="res" data-r>${bars([-34, 92, 78])}</div><div class="res" data-r>${bars([-42, 88, 60])}</div><div class="res" data-r>${bars([-28, 80, 70])}</div></div>
        </div></div></div>`;
  const chrome = $(".chrome", app), ptabs = $$(".ptab", app), panels = {};
  $$(".panel", app).forEach((p) => {
    panels[p.dataset.p] = {
      root: p,
      at: $$("[data-at]", p).map((n) => [n, +n.dataset.at]),
      type: $$("[data-type]", p).map((n) => { const [s, c] = n.dataset.type.split(","); const full = n.textContent; return [n, +s, +c, full]; }),
    };
  });
  const allPills = [...PILLS, ...EXTRA];
  for (const p of allPills) {
    const w = p.win;
    p.el = el(`<div class="pill">${w ? `<div class="win" style="width:${w.w}px;height:${w.h}px;color:${w.fg}"><div class="bar"><i></i><i></i><i></i><span>${w.title}</span></div><div class="body">${w.body}</div></div><div class="shade"></div>` : ""}<div class="pl"><span class="ic">${p.ic || IC[p.id]}</span><span>${p.label}</span></div></div>`);
    pillsEl.append(p.el);
    p.plEl = $(".pl", p.el); p.winEl = $(".win", p.el); p.shadeEl = $(".shade", p.el);
  }
  const head = $("#headline");
  const split = (txt) => [...txt].map((c) => (c === " " ? `<span class="sp"></span>` : `<span class="ch">${c}</span>`)).join("");
  const mkHead = (txt, y, size) => { const h = el(`<div class="hd" style="top:${y}px;font-size:${size}px">${split(txt)}</div>`); head.append(h); return $$(".ch", h); };
  const H1 = mkHead("Nine windows.", 300, 190), H2 = mkHead("One job.", 520, 190), H3 = mkHead("One window.", 650, 170), H4 = mkHead("Meet Tabs.", 650, 170);
  H4.forEach((c) => (c.style.color = INK));
  const side = $("#side");
  side.innerHTML = `<div class="brand">${markSvg}Tabs<small>PUBLIC BETA</small></div>
    ${CAPS.slice(0, -1).map((c, i) => `<div class="cap"><div class="num">${String(i + 1).padStart(2, "0")} / ${String(CAPS.length - 1).padStart(2, "0")}</div><h2>${split(c[1])}</h2><p>${c[2]}</p></div>`).join("")}
    <div class="keys"><div class="key">⌘</div><div class="key">⌥</div><div class="key">K</div></div>
    <div class="ticks">${CAPS.slice(0, -1).map(() => "<i><b></b></i>").join("")}</div>`;
  const caps = $$(".cap", side).map((c) => ({ root: c, num: $(".num", c), chars: $$(".ch", c), p: $("p", c) }));
  const ticks = $$(".ticks b", side), keys = $$(".key", side), brand = $(".brand", side), ticksEl = $(".ticks", side);
  const PROV = ["claude", "codex", "cursor", "copilot", "grok", "opencode", "antigravity", "factory-droid", "kilo", "openrouter"];
  const prov = $("#providers");
  prov.innerHTML = `<div class="ph">${split("Your agents.")}</div><div class="logos">${PROV.map((k) => `<div class="lg">${L[k]}</div>`).join("")}</div>
    <div class="psub"><span>Your accounts.</span><span>No subscription.</span><span>No markup.</span></div>`;
  const provCh = $$(".ch", prov), provLg = $$(".lg", prov), provSub = $$(".psub span", prov);
  const end = $("#end");
  end.innerHTML = `<div class="lock">
      <svg id="mk" width="270" height="270" viewBox="0 0 390 390"><g id="mkBody"><path fill="${IVORY}" d="${MARK_BODY}"/><g id="eyes" fill="${BLUE}"><path d="${MARK_EYES}"/></g></g><path id="mkFoot" fill="${IVORY}" d="${MARK_FOOT}"/></svg>
      <svg id="wm" width="571" height="120" viewBox="0 0 386 81"><path fill="${IVORY}" d="${WORD}"/></svg></div>
    <div class="tag"><span>Every project.</span> <span>Every tool.</span> <span>One window.</span></div>
    <div class="meta"><div class="beta">Get Tabs<i>→</i><b>buildwithtabs.com</b></div><div class="os">Free public beta · macOS · Windows · Linux</div></div>`;
  const mk = $("#mk"), wm = $("#wm"), mkBody = $("#mkBody"), mkFoot = $("#mkFoot"), eyes = $("#eyes"), tagW = $$(".tag span", end), metaW = $$(".meta > div", end);
  const cursor = $("#cursor"), ring = $("#ring");
  cursor.style.cssText = "width:30px;height:36px;left:0;top:0;";
  ring.style.cssText = "width:60px;height:60px;left:-30px;top:-30px;border-radius:50%;border:2.5px solid #0a0b10;opacity:0;";

  /* ── layout that needs measured text ── */
  let ROW, CAPSULE;
  function measure() {
    for (const p of allPills) p.pw = Math.ceil(p.plEl.getBoundingClientRect().width / fitScale);
    const gap = 8, total = PILLS.reduce((s, p) => s + p.pw, 0) + gap * (PILLS.length - 1);
    let x = (1920 - total) / 2;
    for (const p of PILLS) { p.row = { x, y: 508 }; x += p.pw + gap; }
    CAPSULE = { x: (1920 - total) / 2 - 12, y: 496, w: total + 24, h: 88 };
    const y = APP.y + 52 + (62 - 64 * K) / 2;
    let wx = APP.x + 18;
    for (const p of PILLS) { p.slot = { x: wx, y }; wx += p.pw * K + 5; }
    const after5 = PILLS[5].slot.x;
    for (const pr of [1, 2]) { let ex = after5; for (const p of EXTRA.filter((e) => e.proj === pr)) { p.slot = { x: ex, y }; ex += p.pw * K + 5; } }
    const maxW = Math.max(...caps.map((c) => $("h2", c.root).getBoundingClientRect().width / fitScale));
    const fs = Math.min(104, Math.floor((100 * 468) / maxW));
    caps.forEach((c) => ($("h2", c.root).style.fontSize = fs + "px"));
  }
  const slotCenter = (id) => { const p = allPills.find((q) => q.id === id); return [p.slot.x + (p.pw * K) / 2, p.slot.y + 64 * K * 0.86]; };
  let CUR = [];
  function buildCursor() {
    const tab = (n) => [APP.x + 86 + 200 * n + 110, APP.y + 34];
    CUR = [
      [12.25, 1500, 900], [13.0, ...slotCenter("agents")], [15.5, ...slotCenter("dock")], [17.2, ...slotCenter("browser")],
      [18.1, APP.x + 1141, APP.y + 208], [19.0, ...slotCenter("git")], [19.8, APP.x + 165, APP.y + 746], [20.4, ...slotCenter("figma")],
      [21.2, ...slotCenter("claude")], [23.2, ...tab(1)], [24.3, ...tab(2)], [25.2, ...tab(0)], [26.4, APP.x + 520, APP.y + 520],
    ];
  }

  /* ── helpers used per frame ── */
  const chars = (list, t, t0, tOut, stag = 0.03) => list.forEach((c, i) => {
    const p = P(t, t0 + i * stag, 0.7, E.out5), q = P(t, tOut + i * 0.012, 0.28, E.in3);
    c.style.opacity = Math.min(P(t, t0 + i * stag, 0.25, E.lin), 1 - q);
    c.style.transform = `translateY(${(1 - p) * 0.55 - q * 0.3}em) rotate(${(1 - p) * 8}deg)`;
  });
  const fadeUp = (n, p, dy = 14) => { n.style.opacity = p; n.style.transform = `translateY(${(1 - p) * dy}px)`; };
  const presence = (proj, t, stag = 0) => {
    const s = sched(PJ, t);
    if (s.cur === proj) return s.i === 0 ? 1 : P(s.lt - 0.06 - stag, 0, 0.32, E.out5);
    if (s.prev === proj) return 1 - P(s.lt, 0, 0.14, E.lin);
    return 0;
  };
  const R = {};

  function render(rt) {
    /* "Meet Tabs." holds the timeline still for a beat; everything else runs on t */
    const t = rt < HOLD0 ? rt : rt < HOLD0 + HOLD ? HOLD0 : rt - HOLD;
    chars(H4, rt, 10.05, 10.98, 0.03);
    /* backgrounds */
    $("#bgIvory").style.clipPath = `circle(${P(rt, T.flood, 0.9, E.io3) * 1250}px at 960px 540px)`;
    $("#bgBlue").style.clipPath = `circle(${P(t, T.prov - 0.05, 0.85, E.io3) * 1700}px at 1220px 594px)`;

    /* camera */
    const push = 1 + 0.035 * P(t, 0, 6.5, E.lin) * (1 - P(t, 6.3, 1, E.io3));
    const zoom = 0.045 * (P(t, T.proj + 0.1, 0.9, E.io5) - P(t, T.fan - 0.25, 0.8, E.io5));
    const fan = P(t, T.fan, 0.8, E.io5) - P(t, T.qa - 0.55, 0.55, E.io5);
    world.style.transform = t < 9
      ? `translate(960px,540px) scale(${push}) translate(-960px,-540px)`
      : `translate(${APP.x}px,${APP.y + 26}px) scale(${1 + zoom}) translate(${-APP.x}px,${-(APP.y + 26)}px) translateY(${fan * 46}px)`;
    world.style.opacity = t > T.prov + 0.9 ? 0 : 1;

    /* headlines */
    chars(H1, t, 3.55, 6.05); chars(H2, t, 4.55, 6.12); chars(H3, t, 8.75, 9.4, 0.025);

    /* app frame: toolbar capsule → window */
    const g0 = P(t, T.grow, 0.95, E.io5), capIn = P(t, 8.35, 0.5, E.out5);
    const ax = lerp(CAPSULE.x, APP.x, g0), ay = lerp(CAPSULE.y, APP.y, g0), aw = lerp(CAPSULE.w, APP.w, g0), ah = lerp(CAPSULE.h, APP.h, g0);
    app.style.cssText = `left:${ax}px;top:${ay}px;width:${aw}px;height:${ah}px;border-radius:${lerp(44, 20, g0)}px;opacity:${capIn};transform:scale(${lerp(0.94, 1, capIn)});box-shadow:0 0 0 1px rgba(255,255,255,.09) inset,0 ${50 * g0}px ${110 * g0}px rgba(10,11,16,${0.3 * g0})`;
    chrome.style.opacity = P(t, T.grow + 0.5, 0.5, E.out3);
    const pj = sched(PJ, t), pjP = pj.i ? P(pj.lt, 0, 0.3, E.io3) : 1;
    const accent = mix(ACC[pj.prev], ACC[pj.cur], pjP);
    stage.style.setProperty("--accent", accent);
    ptabs.forEach((tab, i) => {
      const a = pj.cur === i ? pjP : pj.prev === i ? 1 - pjP : 0;
      tab.firstElementChild.style.opacity = a;
      tab.style.color = mix("#8a9097", "#e9e6e0", a);
    });
    ghosts.forEach((gh, i) => {
      const f = P(t, T.fan + 0.07 * i, 0.8, E.back) - P(t, T.qa - 0.6 + 0.05 * (1 - i), 0.5, E.io5);
      gh.style.opacity = clamp(f * 6);
      gh.style.transform = `translateY(${-f * 50 * (i + 1)}px) scaleX(${1 - 0.055 * (i + 1) * f})`;
    });

    /* pills */
    const hs = sched(HL, t), hp = hs.i ? P(hs.lt, 0, 0.45, E.io5) : 1;
    const headDim = P(t, 3.3, 0.6, E.out3);
    for (const p of allPills) {
      const w = p.win;
      let x, y, wd, ht, k, vis = 1, rot = 0, ps = 1, u = 1;
      if (w) {
        const i = p.i, m = P(t, T.fold + i * 0.07, 1.05, E.io5), g = P(t, T.grow + i * 0.02, 0.95, E.io5);
        const drift = 1 - m, arc = Math.sin(Math.PI * m), dir = i % 2 ? 1 : -1;
        x = lerp(lerp(w.x, p.row.x, m), p.slot.x, g) + Math.sin(t * 0.55 + i * 1.7) * 8 * drift;
        y = lerp(lerp(w.y, p.row.y, m), p.slot.y, g) + Math.cos(t * 0.47 + i * 2.3) * 8 * drift + (1 - P(t, w.tIn, 0.6, E.out5)) * 80 - arc * 60 * dir;
        wd = lerp(w.w, p.pw, m); ht = lerp(w.h, 64, m); k = lerp(1, K, g);
        rot = arc * dir * 4; ps = lerp(0.72, 1, P(t, w.tIn, 0.85, E.spring));
        vis = P(t, w.tIn, 0.12, E.lin);
        u = P(t, T.unify + i * 0.035, 0.5, E.io3);
        const later = popOrder.filter((o) => o.tIn > w.tIn && o.tIn < t).length;
        p.shadeEl.style.opacity = Math.min(0.8, later * 0.045 + headDim * 0.62) * (1 - P(t, 6.1, 0.4, E.out3));
        p.winEl.style.opacity = 1 - P(m, 0.12, 0.4, E.lin);
        p.plEl.style.opacity = P(m, 0.5, 0.4, E.lin);
        p.el.style.zIndex = popOrder.indexOf(w) + 1;
        p.el.style.borderRadius = lerp(16, 32, P(m, 0, 0.7, E.lin)) + "px";
        p.el.style.boxShadow = `0 ${30 * drift}px ${80 * drift}px rgba(0,0,0,${0.5 * drift})`;
        if (p.proj === 0) { const pr = presence(0, t, (i - 5) * 0.04); vis *= pr; y += (1 - pr) * 8; }
      } else {
        const j = EXTRA.filter((e) => e.proj === p.proj).indexOf(p), pr = presence(p.proj, t, j * 0.05);
        x = p.slot.x; y = p.slot.y + (1 - pr) * 8; wd = p.pw; ht = 64; k = K; vis = pr;
        p.el.style.borderRadius = "32px";
      }
      const act = hs.cur === p.id ? hp : hs.prev === p.id ? 1 - hp : 0;
      p.el.style.width = wd + "px"; p.el.style.height = ht + "px"; p.el.style.opacity = vis;
      p.el.style.transform = `translate(${x}px,${y}px) scale(${k}) translate(${wd / 2}px,${ht / 2}px) scale(${ps}) rotate(${rot}deg) translate(${-wd / 2}px,${-ht / 2}px)`;
      p.el.style.background = w ? mix(w.col, "#1b1e22", u, 1 - u) : "transparent";
      p.plEl.style.color = mix(w ? mix2(w.fg, "#b5b2ac", u) : "#b5b2ac", INK, act * u);
      R[p.id] = { x, y, w: wd * k, h: ht * k };
    }
    const ra = R[hs.prev], rb = R[hs.cur], stretch = Math.sin(Math.PI * hp) * 0.0;
    hl.style.cssText = `width:${lerp(ra.w, rb.w, hp)}px;height:${lerp(ra.h, rb.h, hp)}px;transform:translate(${lerp(ra.x, rb.x, hp)}px,${lerp(ra.y, rb.y, hp)}px) scaleY(${1 - stretch});opacity:${P(t, T.unify + 0.1, 0.4, E.lin)};border-radius:40px`;

    /* panels */
    const ps = sched(PANELS, t);
    for (const [key, pn] of Object.entries(panels)) {
      let o = 0, lt = 0;
      if (t >= PANELS[0][0]) {
        if (ps.cur === key) { lt = ps.lt; o = P(lt, 0.06, 0.3, E.out3); }
        else if (ps.prev === key && ps.i) { o = 1 - P(ps.lt, 0, 0.12, E.lin); lt = 99; }
      }
      pn.root.style.opacity = o;
      if (!o) continue;
      pn.root.style.transform = ps.cur === key ? `translateY(${(1 - P(lt, 0.06, 0.45, E.out5)) * 10}px)` : "";
      for (const [n, at] of pn.at) fadeUp(n, P(lt, at, 0.4, E.out5), 10);
      for (const [n, s, cps, full] of pn.type) n.textContent = full.slice(0, Math.max(0, Math.floor((lt - s) * cps)));
      if (key === "browser") {
        const dm = P(lt, 0.9, 0.45, E.io3), pg = $(".page", pn.root);
        pg.style.setProperty("--pg", mix(IVORY, "#0f1113", dm)); pg.style.setProperty("--pf", mix(INK, IVORY, dm)); pg.style.setProperty("--pc", mix("#e2dcd2", "#1f2327", dm));
        $(".tog i", pn.root).style.transform = `translateX(${dm * 26}px)`;
      }
      if (key === "git") {
        const c = P(lt, 0.8, 0.25, E.out3), b = $(".btn", pn.root), bump = Math.sin(Math.PI * P(lt, 0.76, 0.22, E.lin));
        $(".c1", b).style.opacity = 1 - c; $(".c2", b).style.opacity = c; b.style.transform = `scale(${1 - 0.05 * bump})`;
      }
    }

    /* quick actions */
    const q = t - T.qa, dimmer = $(".dimmer", app), wheel = $(".wheel", app), scratch = $(".scratch", app), ql = $(".qlabel", app);
    const wOpen = P(q, 0.8, 0.9, E.spring) * (1 - P(q, 2.0, 0.22, E.in3)), sel = P(q, 1.65, 0.25, E.out3);
    dimmer.style.opacity = P(q, 0.75, 0.35, E.out3);
    wheel.style.opacity = clamp(wOpen * 5);
    $(".hub", wheel).style.transform = `scale(${wOpen})`;
    $$(".sat", wheel).forEach((s, i) => {
      const o = P(q, 0.86 + i * 0.045, 0.9, E.spring) * (1 - P(q, 2.0, 0.22, E.in3)), a = (-90 + i * 60) * (Math.PI / 180) + (1 - o) * 0.9, on = i === 2 ? sel : 0;
      s.style.transform = `translate(${Math.cos(a) * 152 * o}px,${Math.sin(a) * 152 * o}px) scale(${o * (1 + 0.16 * on)})`;
      s.style.background = on ? mix("#23272b", ACC[0], on) : "#23272b";
      s.style.color = mix("#e9e6e0", INK, on);
    });
    ql.textContent = q < 1.65 ? "Quick Actions" : "Scratch browser";
    ql.style.opacity = P(q, 1.0, 0.3, E.lin) * (1 - P(q, 2.0, 0.15, E.lin));
    const so = P(q, 2.1, 0.8, E.spring);
    scratch.style.opacity = clamp(so * 4); scratch.style.transform = `scale(${lerp(0.8, 1, so)}) translateY(${(1 - so) * 30}px)`;
    $("#q", app).textContent = "how to exit vim".slice(0, Math.max(0, Math.floor((q - 2.5) * 22)));
    $$("[data-r]", scratch).forEach((r, i) => fadeUp(r, P(q, 3.25 + i * 0.08, 0.4, E.out5), 10));
    $("#qa").style.display = q > -0.1 ? "block" : "none";

    /* cursor */
    let ci = 0;
    while (ci + 1 < CUR.length && CUR[ci + 1][0] <= t) ci++;
    const a = CUR[ci], b = CUR[ci + 1] || a, mv = b === a ? 0 : P(t, Math.max(a[0] + 0.05, b[0] - 0.7), Math.min(0.62, b[0] - a[0] - 0.1), E.io5);
    const cx = lerp(a[1], b[1], mv), cy = lerp(a[2], b[2], mv) - Math.sin(Math.PI * mv) * 18;
    const clickT = ci > 0 ? a[0] : -9, cb = ci < CUR.length - 1 && ci > 0 ? Math.sin(Math.PI * P(t, clickT - 0.07, 0.22, E.lin)) : 0;
    cursor.style.transform = `translate(${cx}px,${cy}px) scale(${1 - 0.2 * cb})`;
    cursor.style.opacity = P(t, 12.25, 0.3, E.lin) * (1 - P(t, 26.6, 0.3, E.lin));
    const rp = ci > 0 && ci < CUR.length - 1 ? P(t, clickT - 0.02, 0.5, E.out3) : 1;
    ring.style.transform = `translate(${a[1]}px,${a[2]}px) scale(${0.2 + rp * 0.9})`;
    ring.style.opacity = rp >= 1 ? 0 : 0.55 * (1 - rp);
    ring.style.borderColor = t > 17.3 && t < 18.5 ? INK : IVORY;

    /* side column */
    const sIn = P(t, 10.55, 0.6, E.out5), sOut = 1 - P(t, T.prov - 0.25, 0.25, E.lin);
    fadeUp(brand, sIn * sOut, 16); ticksEl.style.opacity = sIn * sOut;
    const cs = sched(CAPS, t);
    caps.forEach((c, i) => {
      const on = t >= CAPS[i][0] - 0.05 && t < CAPS[i + 1][0] + 0.1;
      c.root.style.display = on ? "block" : "none";
      if (!on) return;
      const t0 = CAPS[i][0], tOut = CAPS[i + 1][0] - 0.22;
      chars(c.chars, t, t0 + 0.05, tOut, 0.028);
      const o = P(t, t0 + 0.25, 0.5, E.out5) * (1 - P(t, tOut, 0.2, E.lin));
      fadeUp(c.p, o, 12); c.num.style.opacity = P(t, t0, 0.3, E.lin) * (1 - P(t, tOut, 0.2, E.lin));
    });
    ticks.forEach((b, i) => { b.style.transform = `scaleX(${i < cs.i ? 1 : i === cs.i ? clamp((t - CAPS[i][0]) / (CAPS[i + 1][0] - CAPS[i][0])) : 0})`; });
    keys.forEach((k, i) => {
      const o = P(q, 0.15 + i * 0.07, 0.5, E.back) * (1 - P(q, 3.6, 0.2, E.lin)), down = P(q, 0.5 + i * 0.12, 0.1, E.out3) * (1 - P(q, 1.15, 0.2, E.out3));
      k.style.opacity = clamp(o * 2); k.style.transform = `translateY(${(1 - o) * 20 + down * 5}px)`;
      k.style.boxShadow = `0 ${6 - down * 5}px 0 rgba(10,11,16,.14)`; k.style.background = mix("#ffffff", "#0e2af3", down); k.style.color = mix(INK, "#ffffff", down);
    });

    /* providers */
    const v = t - T.prov, vOut = 2.85;
    prov.style.display = v > 0 && v < 3.6 ? "block" : "none";
    chars(provCh, v, 0.4, vOut, 0.03);
    provLg.forEach((n, i) => {
      const o = P(v, 0.85 + i * 0.05, 0.9, E.spring), x = P(v, vOut + i * 0.02, 0.3, E.in3);
      n.style.opacity = clamp(o * 4) * (1 - x);
      n.style.transform = `translateY(${(1 - o) * 60 + Math.sin(v * 2.2 + i * 0.8) * 7 - x * 40}px) scale(${lerp(0.5, 1, o)})`;
    });
    provSub.forEach((n, i) => fadeUp(n, P(v, 1.45 + i * 0.25, 0.5, E.out5) * (1 - P(v, vOut, 0.25, E.lin)), 18));

    /* end card */
    const e = t - T.end;
    end.style.display = e > 0 ? "block" : "none";
    const bodyIn = P(e, 0.1, 0.9, E.spring), footIn = P(e, 0.38, 0.75, E.back), shift = P(e, 1.05, 0.9, E.io5);
    const mx = lerp(825, 507, shift), my = 290;
    mk.style.transform = `translate(${mx}px,${my}px)`;
    mk.style.opacity = clamp(bodyIn * 4);
    mkBody.style.transformOrigin = "195px 195px"; mkBody.style.transform = `scale(${lerp(0.55, 1, bodyIn)})`;
    mkFoot.style.transform = `translate(${(1 - footIn) * -150}px,${(1 - footIn) * 40}px)`; mkFoot.style.opacity = clamp(footIn * 3);
    const blink = Math.max(Math.sin(Math.PI * P(e, 0.95, 0.16, E.lin)), Math.sin(Math.PI * P(e, 2.95, 0.16, E.lin)), Math.sin(Math.PI * P(e, 3.2, 0.16, E.lin)));
    const look = P(e, 1.2, 0.4, E.io3) - P(e, 3.5, 0.4, E.io3);
    eyes.style.transformOrigin = "107px 136px"; eyes.style.transform = `translateX(${look * 9}px) scaleY(${1 - 0.9 * blink})`;
    const wr = P(e, 1.2, 0.9, E.io5);
    wm.style.transform = `translate(${841 - (1 - wr) * 60}px,${my + 75}px)`;
    wm.style.clipPath = `inset(0 ${(1 - wr) * 100}% 0 0)`;
    tagW.forEach((n, i) => { n.style.display = "inline-block"; fadeUp(n, P(e, 1.95 + i * 0.22, 0.55, E.out5), 22); });
    metaW.forEach((n, i) => fadeUp(n, P(e, 2.6 + i * 0.22, 0.6, E.out5), 18));
  }
  const mix2 = (a, b, p) => { const A = hex(a), B = hex(b); return "#" + A.map((v, i) => Math.round(lerp(v, B[i], p)).toString(16).padStart(2, "0")).join(""); };

  /* ── boot, preview transport ── */
  const params = new URLSearchParams(location.search), renderMode = params.has("render");
  let fitScale = 1;
  const fit = () => {
    fitScale = renderMode ? 1 : Math.min(innerWidth / 1920, (innerHeight - 36) / 1080);
    stage.style.transform = `scale(${fitScale})`;
    stage.style.left = (innerWidth - 1920 * fitScale) / 2 + "px";
  };
  if (renderMode) document.documentElement.classList.add("render");
  (async () => {
    fit();
    await Promise.all(["400 100px Hebdomadal", "400 20px Overused", "500 20px Overused", "600 20px Overused", "700 20px Overused"].map((f) => document.fonts.load(f)));
    await document.fonts.ready;
    measure(); buildCursor();
    window.DURATION = DUR;
    window.seek = (t) => render(clamp(t, 0, DUR));
    if (renderMode) { render(0); window.READY = true; return; }
    addEventListener("resize", fit);
    let t = +(params.get("t") || 0), playing = !params.has("t"), last = performance.now();
    const scrub = $("#scrub"), clock = $("#clock"), btn = $("#play");
    scrub.max = DUR;
    scrub.oninput = () => { t = +scrub.value; playing = false; btn.textContent = "play"; };
    btn.onclick = () => { playing = !playing; btn.textContent = playing ? "pause" : "play"; };
    addEventListener("keydown", (ev) => { if (ev.code === "Space") btn.onclick(); });
    const loop = (now) => {
      if (playing) { t += (now - last) / 1000; if (t > DUR) t = 0; scrub.value = t; }
      last = now; render(t); clock.textContent = t.toFixed(2) + "s";
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  })();
})();

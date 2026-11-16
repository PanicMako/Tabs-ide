/* Tabs — "Play it". The toolbar film. Every frame is a pure function of time: render(t).
   One idea: the toolbar is an instrument. Six keys come built in, you add your own (any URL, any CLI),
   and every project keeps its own set. 120 BPM: a beat is 0.5 s (12 frames at 24 fps), a bar 2 s. */
(() => {
  const S = 8;                     // the prologue; everything after it runs on main-film time (t - S)
  const DUR = S + 43.5;
  const { IC, PANES, TOOLS, site } = window.UI;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, p) => a + (b - a) * p;
  const E = {
    lin: (x) => x, out3: (x) => 1 - (1 - x) ** 3, out5: (x) => 1 - (1 - x) ** 5, in3: (x) => x ** 3, in5: (x) => x ** 5,
    io2: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
    io3: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
    spring: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-6.2 * x) * Math.cos(11 * x)),
  };
  const P = (t, s, d, e = E.out5) => e(clamp((t - s) / d));
  const smooth = (a, b, x) => { const p = clamp((x - a) / (b - a)); return p * p * (3 - 2 * p); };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mixA = (a, b, p) => { const A = hex(a), B = hex(b); return A.map((v, i) => Math.round(lerp(v, B[i], p))); };
  const rgb = (c, al = 1) => `rgba(${c[0]},${c[1]},${c[2]},${al})`;
  const el = (html) => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild; };
  const sched = (list, t) => { let i = -1; while (i + 1 < list.length && list[i + 1][0] <= t) i++; return i < 0 ? { i, cur: null, prev: null, lt: 0, row: null } : { i, cur: list[i][1], prev: i ? list[i - 1][1] : null, lt: t - list[i][0], row: list[i] }; };

  /* ── cast ── */
  const PROJ = [
    { name: "atlas-web", acc: "#0e2af3", on: "#ffffff", tint: "#8a9bff" },
    { name: "passes-api", acc: "#ff8a66", on: "#17181c", tint: "#ff9d7e" },
    { name: "studio", acc: "#b9a6ff", on: "#17181c", tint: "#c4b4ff" },
  ];
  const SETS = [
    ["code", "agents", "dock", "git", "browser", "testing", "figma", "vercel", "claude", "codex"],
    ["code", "agents", "dock", "git", "browser", "testing", "codex", "docs", "psql", null],
    ["code", "agents", "dock", "git", "browser", "testing", "figma", "story", "claude", null],
  ];
  const NS = 10, HW = 740, GAP = 6;
  const APPEAR = [1, 1.5, 2, 2.5, 3, 3.5, 10, 12.5, 15.5, 17.5];
  const ADDS = [[8.2, 10.0, "figma"], [10.75, 12.5, "vercel"], [13.6, 15.5, "claude"], [16.05, 17.5, "codex"]];
  const FLIPS = [[32, 1], [34, 2], [36, 0]];
  const ACT = [[1, "code"], [1.5, "agents"], [2, "dock"], [2.5, "git"], [3, "browser"], [3.5, "testing"], [4.5, null], [10, "figma"], [12.5, "vercel"], [15.5, "claude"], [17.5, "codex"], [18.45, null],
    [20, "code"], [22, "claude"], [24, "figma"], [26, "dock"], [27, "browser"], [28, "vercel"], [29, "agents"], [30, "git"], [31, "code"], [32.2, "codex"], [34.2, "claude"], [36.2, "code"]];
  const PSCH = [[18, "code"], [22, "claude"], [24, "figma"], [26, "dock"], [27, "browser"], [28, "vercel"], [29, "agents"], [30, "git"], [31, "code"], [32.2, "codexP"], [34.2, "claudeS"], [36.2, "code"]];
  const SWEEP = 18.5;
  const RD = [
    [1, "01", "Code", "a full editor, built in"], [1.5, "02", "Agents", "Claude, Codex, Cursor and more"], [2, "03", "Dock", "servers and terminals"], [2.5, "04", "Git", "review, commit, ship"], [3, "05", "Browser", "a live preview"], [3.5, "06", "Testing", "run your checks"], [4.3],
    [8.35, "07", "New browser tab", "a name and a URL"], [10, "07", "Figma", "figma.com/design/atlas-brand"], [10.9, "08", "New browser tab", "a name and a URL"], [12.5, "08", "Vercel", "vercel.com/atlas/atlas-web"],
    [13.75, "09", "New terminal tab", "a name and a command"], [15.5, "09", "Claude Code", "$ claude"], [16.2, "10", "New terminal tab", "a name and a command"], [17.5, "10", "Codex", "$ codex"], [18.45],
    [22, "09", "Claude Code", "a CLI, pinned as a terminal tab"], [24, "07", "Figma", "a site, pinned as a browser tab"], [26, "03", "Dock", "start the app from a preset"], [27, "05", "Browser", "preview localhost"],
    [28, "08", "Vercel", "watch the deploy"], [29, "02", "Agents", "hand off the next task"], [30, "04", "Git", "commit"], [31.1, "Tabs", "Project tabs", "one click switches the whole workspace"],
    [32.1, "Tab 2", "passes-api", "Codex · API docs · psql"], [34.1, "Tab 3", "studio", "Figma · Storybook · Claude Code"], [36.1, "Tab 1", "atlas-web", "right where you left it"], [36.55, "QA"], [38.0],
  ];

  /* ── build ── */
  const stage = $("#stage"), lens = $("#lens"), world = $("#world"), glow = $("#glow"), type = $("#type");
  const win = el(`<div id="win" class="ui"><div class="rail">${PROJ.map((p, i) => `<div class="ptab" style="left:${10 + i * 160}px">${p.name}<i>×</i></div>`).join("")}<div class="ptab plus" style="left:${10 + 3 * 160}px">+</div></div>
      <div class="trow"><div class="settings"><span class="ic">${IC.gear}</span>Settings</div></div>
      <div class="content">${["code", "claude", "figma", "dock", "browser", "vercel", "agents", "git", "codexP", "claudeS"].map((p) => `<div class="pane" data-p="${p}">${PANES[p]}</div>`).join("")}</div></div>`);
  const winedge = el(`<div id="winedge"></div>`);
  const bar = el(`<div id="bar">${Array.from({ length: NS }, (_, k) => `<div class="tp">${SETS.map((set) => { const id = set[k]; return id ? `<div class="v" data-id="${id}">${TOOLS[id][1]}<span>${TOOLS[id][0]}</span></div>` : `<div class="v" data-id=""></div>`; }).join("")}</div>`).join("")}<div id="plus">+</div></div>`);
  const card = el(`<div id="card"><h5><span class="ci"></span><span class="ct"></span><small>atlas-web</small></h5><label>Name</label><div class="fld nm"><span class="f1"></span></div><label class="l2"></label><div class="fld"><span class="f2"></span><i></i></div><div class="save">Save to toolbar</div></div>`);
  const QA = [["plus", "New<br>workspace"], ["agents", "Conversation"], ["browser", "Temp<br>browser"], ["term", "Terminal"], ["search", "Search"], ["more", "More"]];
  const MORE = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><circle cx="19" cy="12" r="1.9" fill="currentColor"/></svg>';
  const qdim = el(`<div id="qdim"></div>`), qa = el(`<div id="qa" class="ui">${QA.map(([ic, lb]) => `<div class="qt"><span class="ic">${ic === "more" ? MORE : IC[ic]}</span><span>${lb}</span></div>`).join("")}</div>`);
  world.append(win, winedge, bar, card, qdim, qa);
  $$(".site.day", win).forEach((n) => (n.innerHTML = site(false)));
  $$(".site.night", win).forEach((n) => (n.innerHTML = site(true)));
  $$(".page .site.night", win).forEach((n) => (n.style.display = "none"));
  const ptabs = $$(".ptab:not(.plus)", win), plus = $("#plus", bar), qtiles = $$(".qt", qa);
  const slots = $$(".tp", bar).map((root, k) => ({ root, k, vs: $$(".v", root), w: [0, 0, 0] }));
  const panes = {};
  $$(".pane", win).forEach((p) => {
    panes[p.dataset.p] = { root: p, at: $$("[data-at]", p).map((n) => [n, +n.dataset.at]), type: $$("[data-type]", p).map((n) => { const [s, c] = n.dataset.type.split(","); return [n, +s, +c, n.textContent]; }), carets: $$(".caret", p) };
  });

  /* type */
  const lineHTML = (parts) => parts.map(([txt, cls]) => txt.split(" ").map((w) => `<span class="w${cls ? " " + cls : ""}"><span>${w}</span></span>`).join(" ")).join(" ");
  const mk = (cls, parts) => { const n = el(`<div class="hd ${cls}"><span class="ln">${lineHTML(parts)}</span></div>`); type.append(n); return { root: n, words: $$(".w > span", n) }; };
  const roll = (c, t, tIn, tOut, stag = 0.06) => {
    const on = t > tIn - 0.05 && t < tOut + 0.7;
    c.root.style.visibility = on ? "visible" : "hidden";
    if (!on) return;
    c.words.forEach((w, i) => { const a = P(t, tIn + i * stag, 0.7, E.out5), b = P(t, tOut + i * 0.025, 0.3, E.in3); w.style.transform = `translateY(${(1 - a) * 118 - b * 118}%)`; });
  };
  const hA1 = mk("big", [["Six tools,"], ["built in.", "kw"]]), hA2 = mk("big", [["Now add"], ["your own.", "kw"]]);
  const hB1 = mk("side", [["Any"], ["URL.", "kw"]]), hB2 = mk("side", [["Any"], ["CLI.", "kw"]]), hB3 = mk("big", [["Ten tools."], ["One toolbar.", "kw"]]);
  const cC1 = mk("cap", [["Now"], ["play it.", "kw"]]), cC2 = mk("cap", [["Every tool."], ["One window.", "kw"]]);
  const cD0 = mk("cap", [["Tabs up top."], ["One per project.", "kw"]]), cD = mk("cap", [["Every project keeps"], ["its own toolbar.", "kw"]]), cQ = mk("cap", [["And one shortcut"], ["for the rest.", "kw"]]);
  const scrim = el(`<div id="scrim"></div>`); type.prepend(scrim);
  const read = el(`<div id="read"></div>`); type.append(read);
  const tring = el(`<div id="tring"></div>`); world.append(tring);
  let readKey = "";

  /* end */
  const BODY = "M 61 8 C 39 8 21 26 21 48 L 21 168 C 21 205 48 230 83 230 L 180 230 C 195 230 205 242 205 257 L 205 331 C 205 358 225 378 253 378 L 360 378 C 375 378 385 366 385 351 L 385 330 C 385 317 375 312 365 310 C 353 308 347 300 347 285 L 347 224 C 347 193 325 171 297 171 L 216 171 C 201 171 191 161 191 146 L 191 48 C 191 25 172 8 149 8 Z";
  const FOOT = "M 60 251 L 185 251 L 185 318 C 185 353 165 379 132 379 L 26 379 C 12 379 2 367 2 354 L 2 306 C 2 275 26 251 60 251 Z";
  const WORD = "M 0 1 H 94 V 17 H 60 V 80 H 38 V 17 H 0 Z M 82 80 L 118.5 1 H 150 L 185 80 H 160 L 152 62 H 112 L 103 80 Z M 120 48 H 144 L 132.5 19 Z M 192 1 H 248 C 274 1 284 11 284 24 C 284 35 279 41 269 44 C 283 46 289 55 289 65 C 289 78 279 80 252 80 H 192 Z M 212 17 V 34 H 249 C 258 34 261 31 261 26 C 261 20 256 17 249 17 Z M 212 47 V 65 H 251 C 261 65 265 62 265 56 C 265 50 261 47 251 47 Z M 384 26 H 362 V 22 C 362 17 356 15 346 15 H 328 C 314 15 310 18 310 23 C 310 29 317 31 330 33 L 355 37 C 379 40 386 48 386 62 C 386 76 373 81 349 81 H 324 C 300 81 290 75 290 57 H 313 C 313 64 318 66 330 66 H 348 C 362 66 365 63 365 58 C 365 52 358 50 345 48 L 320 44 C 298 41 291 34 291 23 C 291 7 304 0 330 0 H 350 C 372 0 384 6 384 21 Z";
  const end = $("#end");
  end.innerHTML = `<svg id="mk" width="320" height="320" viewBox="0 0 390 390"><g id="mkAll"><path fill="#f3efe9" d="${BODY}"/><g id="mkEyes" fill="#0e2af3"><rect x="65" y="108" width="23" height="56" rx="11.5"/><rect x="126" y="108" width="23" height="56" rx="11.5"/></g><path fill="#f3efe9" d="${FOOT}"/></g></svg>
    <svg id="wm" width="660" height="138" viewBox="0 0 386 81"><path fill="#f3efe9" fill-rule="evenodd" d="${WORD}"/></svg>
    <div class="tag"><span class="ln">${lineHTML([["Every project. Every tool."], ["One window.", "kw"]])}</span></div>
    <div class="meta"><span class="beta">PUBLIC BETA</span><span class="os">macOS · Windows · Linux</span><i class="sep"></i><span class="url">buildwithtabs.com</span></div>`;
  const mkS = $("#mk"), wm = $("#wm"), mkAll = $("#mkAll"), mkEyes = $("#mkEyes"), tagW = $$(".tag .w > span", end), metaKids = [...$(".meta", end).children];

  /* ── measured layout ── */
  function measure() {
    for (const s of slots) s.vs.forEach((v, p) => { s.vs.forEach((x) => x.classList.remove("on")); v.classList.add("on"); s.w[p] = v.dataset.id ? Math.ceil(s.root.offsetWidth) : 0; });
  }
  const slotState = (k, t) => { let from = 0, to = 0, p = 1; for (const [tf, pj] of FLIPS) { const s = tf + 0.04 * k; if (t >= s) { from = to; to = pj; p = clamp((t - s) / 0.44); } } return { from, to, p }; };
  /* row geometry at time t: x and width of every slot, in bar coordinates */
  function rowAt(t) {
    let x = 0; const out = [];
    for (const s of slots) {
      const st = slotState(s.k, t), w0 = lerp(s.w[st.from], s.w[st.to], smooth(0, 1, st.p));
      const grow = s.k < 6 ? 1 : P(t, APPEAR[s.k], 0.42, E.out5), w = w0 * grow;
      out.push({ x, w, st, full: w0 }); x += w + (w0 > 0 ? GAP * grow : 0);
    }
    out.end = x; return out;
  }
  const BX = -HW + 16;
  const slotOf = (id, t) => { const k = SETS[slotState(0, t).to].indexOf(id); return k; };

  /* ── camera: a few named shots, blended ── */
  const mixCam = (a, b, p) => { const c = {}; for (const k of ["sx", "sy", "tx", "ty", "pitch", "yaw"]) c[k] = lerp(a[k], b[k], p); c.s = Math.exp(lerp(Math.log(a.s), Math.log(b.s), p)); c.P = Math.exp(lerp(Math.log(a.P), Math.log(b.P), p)); return c; };
  const tabShot = (t) => P(t, 30.9, 1.0, E.io3) * (1 - P(t, 35.2, 0.9, E.io3));
  function camAt(t, row) {
    const cx = (k) => BX + row[k].x + row[k].w / 2;
    const A = { sx: 960, sy: 590, tx: (() => { const kf = clamp((t - 1) / 0.5, 0, 5), i = Math.min(4, Math.floor(kf)); return lerp(cx(i), cx(i + 1), E.io3(clamp(kf - i))) + 30; })(), ty: 29, s: lerp(6.4, 6.0, clamp(t / 3.6)), pitch: -8, yaw: 27, P: 1500 };
    const six = BX + (row[5].x + row[5].w) / 2 + 20;
    const A2 = { sx: 960, sy: 610, tx: six, ty: 29, s: lerp(2.7, 2.95, clamp((t - 4.6) / 3.6)), pitch: -6, yaw: 0, P: 1800 };
    const B = { sx: 1060, sy: 372, tx: BX + row.end - 130, ty: 29, s: 2.3, pitch: -4, yaw: -7, P: 1700 };
    const B2 = { sx: 960, sy: 640, tx: BX + row.end / 2, ty: 29, s: 1.5, pitch: -6, yaw: 0, P: 1800 };
    const C = { sx: 960, sy: 432, tx: 0, ty: 378, s: 0.93, pitch: 0, yaw: 0, P: 2600 };
    let c = mixCam(A, A2, P(t, 3.75, 1.35, E.io3));
    c = mixCam(c, B, P(t, 7.75, 1.2, E.io3));
    c = mixCam(c, B2, P(t, 18.1, 1.1, E.io3));
    c = mixCam(c, C, P(t, 19.5, 1.7, E.io3));
    /* up to the project tabs: close enough to read them, wide enough to watch the toolbar change underneath */
    const Dm = { sx: 960, sy: 250, tx: -160, ty: 6, s: 1.54, pitch: -3, yaw: 2.5, P: 2000 };
    c = mixCam(c, Dm, tabShot(t));
    /* inside the window: breathe, and nod on every key */
    const inW = P(t, 21, 1, E.io2);
    c.yaw += inW * 1.6 * Math.sin(((t - 20) * Math.PI * 2) / 8); c.pitch += inW * 0.8 * Math.sin(((t - 20) * Math.PI * 2) / 6 + 1);
    for (const [ts] of PSCH.slice(1)) if (t >= ts) c.s *= 1 + 0.012 * Math.exp(-(t - ts) * 9);
    /* the ending dives into the lit key until its colour fills the frame */
    const dv = P(t, 38.0, 0.9, E.in3);
    if (dv > 0) { const k = SETS[0].indexOf("code"); c.tx = lerp(c.tx, cx(k) - 6, P(t, 38.0, 0.5, E.out3)); c.ty = lerp(c.ty, 29, P(t, 38.0, 0.5, E.out3)); c.sy = lerp(c.sy, 540, dv); c.s *= Math.exp(dv * Math.log(110)); }
    return c;
  }

  function paneContent(pane, lt, t) {
    for (const [n, a] of pane.at) { const p = P(lt, a, 0.3, E.out5); n.style.opacity = p; n.style.transform = p < 1 ? `translateY(${(1 - p) * 8}px)` : ""; }
    let typing = false;
    for (const [n, s, cps, full] of pane.type) { const k = clamp(Math.floor((lt - s) * cps), 0, full.length); if (k > 0 && k < full.length) typing = true; const txt = full.slice(0, k); if (n.textContent !== txt) n.textContent = txt; }
    const blink = typing || (t * 2) % 1 < 0.55 ? 1 : 0;
    for (const c of pane.carets) c.style.opacity = blink;
  }

  function renderMain(t) {
    const row = rowAt(t), cam = camAt(t, row), gp = slotState(0, t);
    const acc = mixA(PROJ[gp.from].acc, PROJ[gp.to].acc, smooth(0, 1, gp.p)), on = mixA(PROJ[gp.from].on, PROJ[gp.to].on, smooth(0.3, 0.7, gp.p));
    const tint = mixA(PROJ[gp.from].tint, PROJ[gp.to].tint, smooth(0, 1, gp.p));
    stage.style.setProperty("--tint", rgb(tint)); win.style.setProperty("--acc", rgb(acc)); win.style.setProperty("--accfg", rgb(on));
    lens.style.perspective = `${cam.P}px`; lens.style.perspectiveOrigin = `${cam.sx}px ${cam.sy}px`;
    world.style.transform = `translate(${cam.sx}px,${cam.sy}px) translateZ(${cam.P - cam.P / cam.s}px) rotateX(${cam.pitch}deg) rotateY(${cam.yaw}deg) translate3d(${-cam.tx}px,${-cam.ty}px,0px)`;
    const g = 1 - P(t, 19.5, 1.5, E.io2);                              // macro look → the real toolbar
    const wv = P(t, 19.9, 1.3, E.io2);                                 // the window arrives

    /* ── stage light ── */
    const gy = lerp(54, 36, wv), ga = lerp(0.26, 0.2, wv) * P(t, 0.9, 0.6, E.lin);
    glow.style.background = `radial-gradient(62% 52% at 50% ${gy}%, ${rgb(tint, ga)}, transparent 70%)`;

    /* ── the keys ── */
    const act = sched(ACT, t);
    bar.style.webkitBoxReflect = g > 0.02 ? `below 12px linear-gradient(transparent 30%, rgba(0,0,0,${(0.42 * g).toFixed(3)}))` : "";
    for (const s of slots) {
      const r = row[s.k], st = r.st, shown = st.p < 0.5 ? st.from : st.to, id = SETS[shown][s.k];
      s.vs.forEach((v, p) => v.classList.toggle("on", p === shown));
      const ta = APPEAR[s.k], vis = t >= ta && r.full > 0.5;
      const root = s.root.style;
      root.visibility = vis ? "visible" : "hidden";
      if (!vis) continue;
      let lit = 0;
      if (id && act.cur === id) lit = P(act.lt, 0, 0.09, E.out3); else if (id && act.prev === id) lit = 1 - P(act.lt, 0, 0.28, E.lin);
      const sw = t - (SWEEP + s.k * 0.1); if (sw >= 0 && t < 20.2) lit = Math.max(lit, Math.exp(-sw * 4.5));
      let press = 0; for (const [te, pid] of ACT) if (pid === id && t >= te && t < te + 0.2) press = Math.sin(((t - te) / 0.2) * Math.PI);
      const pop = E.spring(clamp((t - ta) / 0.6)), flip = st.p < 1 ? Math.abs(Math.cos(st.p * Math.PI)) : 1;
      const base = mixA("#27272b", "#000000", 0), col = [0, 1, 2].map((i) => Math.round(lerp(base[i], acc[i], lit)));
      root.width = `${r.w}px`;
      root.background = rgb(col, Math.max(lit, g * 0.92));
      root.borderColor = `rgba(255,255,255,${(0.16 * g * (1 - lit * 0.5)).toFixed(3)})`;
      root.color = rgb(mixA("#a9a9a8", "#ffffff", 0).map((v, i) => Math.round(lerp(v, on[i], lit))));
      root.boxShadow = lit > 0.01 ? `0 0 ${(34 * lit * (0.5 + g)).toFixed(1)}px ${rgb(tint, 0.75 * lit * (0.35 + 0.65 * g))}` : "";
      root.setProperty("--gloss", (g * (0.55 + 0.45 * lit)).toFixed(3));
      const depth = Math.abs((BX + r.x + r.w / 2 - cam.tx) * Math.sin((cam.yaw * Math.PI) / 180)), blur = Math.min(5, Math.max(0, depth - 14) * 0.016) * g;
      root.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "";
      root.transform = `translate(${r.x}px,0) scale(${(0.3 + 0.7 * pop) * (1 - 0.07 * press)},${(0.3 + 0.7 * pop) * (1 - 0.07 * press) * flip})`;
      root.opacity = clamp(pop * 3);
      root.overflow = r.w < r.full - 1 ? "hidden" : "";
    }
    const pv = P(t, 6.0, 0.45, E.out5) * (1 - P(t, 18.2, 0.35, E.lin));
    plus.style.opacity = pv; plus.style.transform = `translate(${row.end + 6}px,0) scale(${0.5 + 0.5 * pv + 0.06 * Math.sin(t * Math.PI * 2)}) rotate(${(1 - pv) * -90}deg)`;

    /* ── "new tab" card: a name and a URL, or a name and a command ── */
    let cardOn = false;
    for (const [ts, tn, id] of ADDS) {
      if (t < ts || t >= tn) continue;
      cardOn = true;
      const [name, icon, kind, value] = TOOLS[id], u = t - ts, span = tn - ts;
      const a = E.spring(clamp(u / 0.55)), c = P(t, tn - 0.42, 0.42, E.io3);
      $(".ci", card).innerHTML = kind === "url" ? IC.globe : IC.term; $(".ct", card).textContent = kind === "url" ? "New browser tab" : "New terminal tab"; $(".l2", card).textContent = kind === "url" ? "URL" : "Command";
      const n1 = clamp(Math.floor((u - 0.28) * 30), 0, name.length), t2 = 0.28 + name.length / 30 + 0.12, cps = value.length / Math.max(0.2, span - 0.62 - t2 - 0.12);
      const n2 = clamp(Math.floor((u - t2) * cps), 0, value.length);
      $(".f1", card).textContent = name.slice(0, n1); $(".f2", card).textContent = value.slice(0, n2);
      const sv = $(".save", card), pr = Math.sin(clamp((u - (span - 0.6)) / 0.18) * Math.PI);
      sv.style.transform = `scale(${1 - 0.05 * pr})`; sv.style.filter = `brightness(${1 + 0.5 * pr})`;
      const k = SETS[0].indexOf(id), tx = BX + row[k].x, x0 = BX + row.end - 250 + 16, y0 = 78;
      card.style.transform = `translate3d(${lerp(x0, tx - 250 + row[k].full / 2, c)}px,${lerp(y0, 10, c) + (1 - a) * 22}px,30px) scale(${lerp(lerp(0.5, 0.6, a), 0.1, c)})`;
      card.style.opacity = clamp(a * 2.5) * (1 - smooth(0.55, 1, c));
    }
    card.style.visibility = cardOn ? "visible" : "hidden";

    /* ── the window ── */
    win.style.opacity = wv; win.style.visibility = wv > 0 ? "visible" : "hidden";
    winedge.style.opacity = wv; winedge.style.boxShadow = `0 0 170px ${rgb(tint, 0.32)}, 0 40px 120px rgba(0,0,0,.7)`;
    ptabs.forEach((n, i) => { const w = i === gp.to ? smooth(0, 0.5, gp.p) : i === gp.from ? 1 - smooth(0, 0.5, gp.p) : 0; n.style.background = rgb(mixA("#0b0b0c", "#171718", w)); n.style.color = rgb(mixA("#8b8b8a", "#f1f1ef", w)); });
    const ps = sched(PSCH, t), q = ps.i > 0 ? clamp(ps.lt / 0.26) : 1;
    for (const [id, pane] of Object.entries(panes)) {
      const r = pane.root.style;
      if (id === ps.cur) { const a = E.out5(q); r.display = ""; r.transform = q < 1 ? `translateY(${(1 - a) * 90}px)` : ""; r.opacity = q < 1 ? smooth(0, 0.5, q) : ""; r.zIndex = 2; paneContent(pane, ps.lt, t); }
      else if (id === ps.prev && q < 1) { r.display = ""; r.transform = `translateY(${-E.in3(q) * 70}px)`; r.opacity = 1 - smooth(0, 0.7, q); r.zIndex = 1; }
      else r.display = "none";
    }

    /* project tabs: a press and a ripple on each switch */
    scrim.style.opacity = tabShot(t);
    let rp = -1, ri = 0; for (const [tf, pj] of FLIPS) { const d = t - tf; if (d >= 0 && d < 0.55) { rp = d / 0.55; ri = pj; } }
    tring.style.opacity = rp < 0 ? 0 : (1 - rp) * 0.9; tring.style.transform = `translate3d(${-HW + 10 + ri * 160 + 76}px,${-17}px,4px) scale(${0.2 + E.out3(Math.max(rp, 0)) * 1.1})`; tring.style.borderColor = rgb(tint);
    ptabs.forEach((n, i) => { let pr = 0; for (const [tf, pj] of FLIPS) if (pj === i && t >= tf && t < tf + 0.2) pr = Math.sin(((t - tf) / 0.2) * Math.PI); n.style.transform = pr ? `scale(${1 - 0.06 * pr})` : ""; });

    /* ── quick actions cameo ── */
    const u = t - 36.5, qOpen = P(u, 0.05, 0.3, E.lin) * (1 - P(u, 1.12, 0.3, E.lin));
    qdim.style.opacity = P(u, 0, 0.3, E.out3) * (1 - P(u, 1.15, 0.4, E.io2)) * 0.62; qdim.style.transform = "translateZ(3px)";
    qa.style.visibility = qOpen > 0 ? "visible" : "hidden";
    if (qOpen > 0) {
      const step = Math.min(2, Math.floor(Math.max(0, u - 0.5) / 0.25)), focus = u < 0.5 ? -1 : [1, 2, 3][step], fT = 0.5 + step * 0.25;
      qtiles.forEach((n, i) => {
        const a = E.spring(clamp((u - 0.05 - i * 0.04) / 0.55)), out = P(u, 1.12 + (5 - i) * 0.02, 0.26, E.in3), r = 176 * a * (1 - out), ang = ((-90 + i * 60) * Math.PI) / 180;
        const w = i === focus ? P(u, fT, 0.1, E.out3) : 0;
        n.style.transform = `translate3d(${Math.cos(ang) * r}px,${400 + Math.sin(ang) * r}px,${50 + 24 * w}px) scale(${(0.3 + 0.7 * a) * (1 - out) * (1 + 0.1 * w)})`;
        n.style.opacity = clamp(a * 2.2) * (1 - out);
        n.style.background = rgb(mixA("#27272a", "#0e2af3", w)); n.style.color = rgb(mixA("#e9e9e7", "#ffffff", w));
      });
    }

    /* ── type ── */
    roll(hA1, t, 4.25, 5.95); roll(hA2, t, 6.15, 7.7); roll(hB1, t, 8.5, 13.25); roll(hB2, t, 13.7, 18.2); roll(hB3, t, 18.5, 20.25);
    roll(cC1, t, 21.0, 25.7); roll(cC2, t, 26.0, 30.85); roll(cD0, t, 31.1, 33.55); roll(cD, t, 33.8, 36.2); roll(cQ, t, 36.5, 37.95);
    const rd = sched(RD, t), row0 = rd.row;
    if (row0 && row0.length > 1 && t < 38) {
      const key = String(row0[0]);
      if (key !== readKey) { readKey = key; read.innerHTML = row0[1] === "QA" ? `<kbd>⌘</kbd><kbd>⌥</kbd><kbd>K</kbd> Quick Actions` : `<b>${row0[1]}</b>${row0[2]} — ${row0[3]}`; }
      const a = P(rd.lt, 0, 0.22, E.out5); read.style.opacity = a * (t > 19.2 && t < 21.9 ? 0 : 1); read.style.transform = `translateY(${(1 - a) * 10}px)`;
    } else { read.style.opacity = 0; readKey = ""; }

    /* ── end: inside the key's colour, the mark ── */
    const e0 = 38.9, endOn = t >= 38.55;
    end.style.visibility = endOn ? "visible" : "hidden";
    lens.style.display = t < 39 ? "" : "none"; type.style.display = t < 38.6 ? "" : "none";
    if (endOn) {
      end.style.opacity = P(t, 38.55, 0.3, E.lin);
      const lock = P(t, e0 + 0.85, 0.9, E.io3), sc = lerp(1.3, 1, lock);
      mkS.style.transform = `translate(${lerp(800, 442, lock)}px,${lerp(330, 232, lock)}px) scale(${sc})`; mkS.style.transformOrigin = "160px 160px";
      const bs = E.spring(clamp((t - e0) / 0.8));
      mkAll.setAttribute("transform", `translate(195 300) rotate(${(1 - bs) * -12}) scale(${bs}) translate(-195 -300)`);
      const blinkAt = (tb) => { const d = (t - tb) / 0.2; return d > 0 && d < 1 ? Math.sin(d * Math.PI) : 0; };
      const open = P(t, e0 + 0.45, 0.2, E.out5), bl = Math.max(blinkAt(e0 + 3.2), blinkAt(e0 + 3.5)), ey = open * (1 - 0.92 * bl) + 0.07 * (1 - open);
      const look = (P(t, e0 + 0.9, 0.5, E.io3) - P(t, e0 + 2.2, 0.6, E.io3)) * 7;
      mkEyes.setAttribute("transform", `translate(${look} 136) scale(1 ${ey}) translate(0 -136)`);
      const wp = P(t, e0 + 1.0, 0.85, E.out5);
      wm.style.left = `${lerp(750, 818, wp)}px`; wm.style.top = "331px"; wm.style.clipPath = `inset(0 ${(1 - wp) * 100}% 0 0)`; wm.style.opacity = P(t, e0 + 1.0, 0.2, E.lin);
      tagW.forEach((w, i) => { const a = P(t, e0 + 1.6 + i * 0.07, 0.75, E.out5); w.style.transform = `translateY(${(1 - a) * 118}%)`; });
      metaKids.forEach((n, i) => { const a = P(t, e0 + 2.3 + i * 0.09, 0.7, E.out5); n.style.opacity = a; n.style.transform = `translateY(${(1 - a) * 16}px)`; });
    }
  }


  /* ── prologue: too many windows, and someone to tidy them ── */
  const pro = el(`<div id="pro"></div>`); stage.insertBefore(pro, type);
  const pbar = (ws, c) => ws.map((w) => `<i style="width:${Math.abs(w)}%${w < 0 ? `;background:${c}` : ""}"></i>`).join("");
  const WINS = [
    { t: "editor — atlas-web", ic: IC.code, w: 620, h: 400, x: 585, y: 420, r: -4, c: "#8a9bff", at: 0.5, body: (c) => `<div class="cols2"><div>${pbar([70, 50, 62, 44, 58, 40], c)}</div><div>${pbar([-42, 78, 64, 86, 36, -52, 72, 60, 80, 44], c)}</div></div>` },
    { t: "zsh — bun dev", ic: IC.term, w: 480, h: 300, x: 1215, y: 345, r: 5, c: "#7fd6a4", at: 1.0, body: (c) => `<pre>$ bun dev\n<b style="color:${c}">VITE</b> ready in 412 ms\n➜ Local  localhost:4173\n$ ▌</pre>` },
    { t: "localhost:4173", ic: IC.browser, w: 540, h: 350, x: 945, y: 640, r: -2, c: "#ffd84a", at: 1.5, body: (c) => `<div class="pg" style="background:#f6efe2"><b>Get a little lost.</b><u style="background:${c}"></u><s style="background:#0e2af3"></s></div>` },
    { t: "agent — claude", ic: window.LOGOS.claude, w: 400, h: 330, x: 345, y: 690, r: 6, c: "#e08a5b", at: 2.0, body: (c) => `<div class="bub r"></div><div class="bub" style="background:${c}55"></div><div class="bub" style="width:52%;background:${c}55"></div><div class="bub r" style="width:40%"></div>` },
    { t: "git — 3 changes", ic: IC.git, w: 420, h: 280, x: 1515, y: 650, r: -6, c: "#ff8f8f", at: 2.25, body: () => pbar([-40], "#8b8b8a") + `<i style="width:82%;background:#7fd6a455"></i><i style="width:64%;background:#7fd6a455"></i><i style="width:70%;background:#ff8f8f55"></i><i style="width:58%;background:#7fd6a455"></i>` },
    { t: "Figma — atlas-brand", ic: window.LOGOS.figma, w: 440, h: 320, x: 1570, y: 265, r: 3, c: "#b9a6ff", at: 2.5, body: (c) => `<div class="fg"><i style="background:#f3efe9"></i><i style="background:#ff8a66"></i><i style="background:${c}"></i></div>` },
    { t: "Vercel — deployments", ic: IC.vercel, w: 390, h: 260, x: 315, y: 275, r: -7, c: "#f1f1ef", at: 2.75, body: (c) => pbar([-56, 84, 70], c) + `<em><i></i>Ready</em>` },
  ];
  WINS.forEach((w) => { w.el = el(`<div class="pw" style="width:${w.w}px;height:${w.h}px;margin:${-w.h / 2}px 0 0 ${-w.w / 2}px"><header><i></i><i></i><i></i><span class="ic">${w.ic}</span>${w.t}</header><div class="pb">${w.body(w.c)}</div></div>`); pro.append(w.el); });
  const pm = el(`<svg id="pm" width="260" height="260" viewBox="0 0 390 390"><g id="pmAll"><path fill="#f3efe9" d="${BODY}"/><g id="pmEyes" fill="#060608"><rect x="65" y="108" width="23" height="56" rx="11.5"/><rect x="126" y="108" width="23" height="56" rx="11.5"/></g><path id="pmFoot" fill="#f3efe9" d="${FOOT}"/></g></svg>`);
  pro.append(pm);
  const pmAll = $("#pmAll", pm), pmEyes = $("#pmEyes", pm), pmSh = el(`<div id="pmsh"></div>`); pro.insertBefore(pmSh, pm);
  const pH1 = mk("big pro1", [["Too many"], ["windows.", "kw"]]), pH2 = mk("big pro2", [["Tabs puts them"], ["in one.", "kw"]]);
  const pRead = el(`<div id="pread">One desktop app for every project and every tool</div>`); type.append(pRead);
  const GX = 960, GY = 905, HOPS = [[3.3, -160], [3.7, 250], [4.1, 620], [4.5, 960]];   // landing times and x positions
  function prologue(t) {
    const on = t < S + 0.05;
    pro.style.display = on ? "" : "none";
    roll(pH1, t, 1.9, 4.85); roll(pH2, t, 5.9, 7.55, 0.07);
    { const a = P(t, 6.4, 0.6, E.out5) * (1 - P(t, 7.45, 0.3, E.lin)); pRead.style.opacity = a; pRead.style.transform = `translateY(${(1 - P(t, 6.4, 0.6, E.out5)) * 12}px)`; }
    if (!on) return;
    /* the mascot: hop in, look at the mess, swallow it, leave */
    let mx = HOPS[0][1], lift = 0, land = 99;
    for (let i = 1; i < HOPS.length; i++) { const [t1, x1] = HOPS[i], [t0, x0] = HOPS[i - 1]; if (t >= t0 && t < t1) { const p = (t - t0) / (t1 - t0); mx = lerp(x0, x1, p); lift = Math.sin(p * Math.PI) * 130; } if (t >= t1) { mx = x1; land = Math.min(land, t - t1); land = t - t1; } }
    const jump = t >= 4.95 && t < 5.45 ? Math.sin(((t - 4.95) / 0.5) * Math.PI) * 90 : 0;           // the little leap that starts the gulp
    const joy = t >= 6.5 && t < 6.95 ? Math.sin(((t - 6.5) / 0.45) * Math.PI) * 110 : 0;
    const out = P(t, 7.3, 0.55, E.in3);                                                         // up and away
    const squash = Math.exp(-land * 9) * Math.cos(land * 22) * 0.22 + (t > 7.05 && t < 7.3 ? Math.sin(((t - 7.05) / 0.25) * Math.PI) * 0.2 : 0);
    let gulp = 0; WINS.forEach((w, i) => { const d = t - (5.42 + i * 0.125); if (d > 0 && d < 0.3) gulp = Math.max(gulp, Math.sin((d / 0.3) * Math.PI)); });
    const my = GY - lift - jump - joy - out * 1400, sc = 1 + gulp * 0.13;
    pm.style.transform = `translate(${mx - 130}px,${my - 260}px)`; pm.style.visibility = t > 3.25 ? "visible" : "hidden";
    pmAll.setAttribute("transform", `translate(195 379) scale(${(1 + squash) * sc} ${(1 - squash) * sc * (1 + out * 0.5)}) translate(-195 -379)`);
    const blinkAt = (tb) => { const d = (t - tb) / 0.18; return d > 0 && d < 1 ? Math.sin(d * Math.PI) : 0; };
    const bl = Math.max(blinkAt(4.72), blinkAt(6.15), blinkAt(6.98)), lookUp = P(t, 4.55, 0.25, E.out3) * (1 - P(t, 6.3, 0.3, E.io2));
    pmEyes.setAttribute("transform", `translate(${Math.sin(t * 2.2) * 3 * lookUp} ${136 - lookUp * 12}) scale(1 ${1 - 0.92 * bl}) translate(0 -136)`);
    const air = (lift + jump + joy) / 130;
    pmSh.style.transform = `translate(${mx - 115}px,${GY - 6}px) scale(${1 - 0.4 * clamp(air)},1)`; pmSh.style.opacity = t > 3.3 ? 0.5 * (1 - clamp(air) * 0.6) * (1 - out) : 0;
    /* the windows */
    WINS.forEach((w, i) => {
      const a = E.spring(clamp((t - w.at) / 0.55)), g = P(t, 5.0 + i * 0.125, 0.46, E.in3);
      const fx = Math.sin(t * 0.9 + i * 1.7) * 9, fy = Math.cos(t * 0.8 + i * 2.3) * 7;
      const x = lerp(w.x + fx, GX, g), y = lerp(w.y + fy, GY - 140, g) - Math.sin(g * Math.PI) * 120;
      const dim = 1 - 0.45 * P(t, 1.9, 0.5, E.lin) * (1 - P(t, 4.8, 0.3, E.lin));
      w.el.style.visibility = t >= w.at && g < 1 ? "visible" : "hidden";
      w.el.style.transform = `translate(${x}px,${y}px) rotate(${w.r * (1 - g) + g * (i % 2 ? 40 : -40)}deg) scale(${(0.6 + 0.4 * a) * lerp(1, 0.04, g)})`;
      w.el.style.opacity = clamp(a * 3) * (1 - smooth(0.85, 1, g)); w.el.style.filter = `brightness(${dim})`;
    });
  }

  /* ── boot ── */
  const fit = $("#fit"), rendering = location.search.includes("render");
  const doFit = () => { const s = rendering ? 1 : Math.min(innerWidth / 1920, (innerHeight - 40) / 1080); fit.style.transform = `scale(${s})`; fit.style.left = rendering ? "0" : `${(innerWidth - 1920 * s) / 2}px`; };
  addEventListener("resize", doFit); doFit();
  if (rendering) $("#hud").style.display = "none";
  const render = (t) => { prologue(t); renderMain(t - S); };
  window.DURATION = DUR; window.seek = (t) => render(t);
  const faces = ['400 20px "Balbes"', '400 20px "Seenonim"'];
  Promise.all(faces.map((f) => document.fonts.load(f))).then(() => document.fonts.ready).then(() => {
    measure(); render(0); window.READY = true;
    if (rendering) return;
    const scrub = $("#scrub"), clock = $("#clock"), btn = $("#play");
    let playing = true, t = Number(new URLSearchParams(location.search).get("t") || 0), last = performance.now();
    btn.onclick = () => { playing = !playing; btn.textContent = playing ? "pause" : "play"; last = performance.now(); };
    scrub.oninput = () => { t = scrub.value * DUR; playing = false; btn.textContent = "play"; render(t); clock.textContent = t.toFixed(2); };
    const loop = (now) => { if (playing) { t = (t + (now - last) / 1000) % DUR; scrub.value = t / DUR; render(t); clock.textContent = t.toFixed(2); } last = now; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
})();

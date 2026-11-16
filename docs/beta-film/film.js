/* Tabs — public beta film. Every frame is a pure function of time: render(t).
   One idea: a row of project tabs on a line turns out to be a drawer of folders,
   and the front folder is the Tabs window. */
(() => {
  const DUR = 42.6;
  const { IC, PANES, PROJECTS, toolbar, site } = window.UI;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, p) => a + (b - a) * p;
  const E = {
    lin: (x) => x,
    out3: (x) => 1 - (1 - x) ** 3,
    out5: (x) => 1 - (1 - x) ** 5,
    in2: (x) => x * x,
    in3: (x) => x ** 3,
    io2: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
    io3: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
    io5: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
    spring: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-6.2 * x) * Math.cos(11 * x)),
  };
  const P = (t, s, d, e = E.out5) => e(clamp((t - s) / d));
  const smooth = (a, b, x) => { const p = clamp((x - a) / (b - a)); return p * p * (3 - 2 * p); };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, p) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], p))).join(",")})`; };
  const el = (html) => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild; };
  const INK = "#101116", IVORY = "#f3efe9";

  /* ── geometry (world px; y = 0 is "the line": top of every sheet, bottom of every tab) ── */
  const HW = 740, S = 300, N = PROJECTS.length;
  const FX = [-549, -327, -105, 117, 339], FW = 210, FH = 44;      // folder-form tabs
  const AX = (i) => -HW + 10 + i * 160, AW = 152, AH = 34;         // app-form tabs
  const HERO_X = FX[0] + FW / 2;

  /* ── timeline (100 BPM: a beat is 0.6 s, a bar 2.4 s) ── */
  const T = { land: 1.2, pops: [0, 3.0, 3.3, 3.6, 3.9], reveal: 4.8, form: 8.5, tools: 12.0, qa: 24.0, sw1: 28.2, sw2: 29.4, crane: 30.6, ink: 32.4, end: 36.0 };
  const SCH = [[10.2, "code"], [14.4, "agents"], [16.8, "dock"], [19.2, "browser"], [21.6, "git"]];
  const VERBS = [
    [12.0, "Write it.", "Code", "A full Code OSS editor, built in."],
    [14.4, "Hand it off.", "Agents", "Claude, Codex, Cursor and more, working in your repo."],
    [16.8, "Run it.", "Dock", "Dev servers and terminals, side by side."],
    [19.2, "See it.", "Browser", "A live preview, right beside the code."],
    [21.6, "Ship it.", "Git", "Review the diff, then commit."],
  ];
  const sched = (list, t) => { let i = 0; while (i + 1 < list.length && list[i + 1][0] <= t) i++; return { i, cur: list[i][1], prev: i ? list[i - 1][1] : null, lt: t - list[i][0] }; };

  /* ── camera ── */
  const CAM = [
    { t: 0, sx: 960, sy: 610, tx: HERO_X, ty: 0, tz: 0, s: 3.0, pitch: 0, yaw: 0, P: 120000 },
    { t: 2.3, s: 2.86, e: E.lin },
    { t: 4.5, sy: 668, tx: 0, s: 1.5, e: E.io3 },
    { t: 4.8, s: 1.49, e: E.lin },
    { t: 7.5, sy: 440, ty: 190, tz: -1.7 * S, s: 0.74, pitch: -38, yaw: 24, P: 2300, e: E.io3 },
    { t: 8.5, pitch: -36.5, yaw: 21, s: 0.76, e: E.lin },
    { t: 10.5, sy: 442, ty: 378, tz: 0, s: 0.98, pitch: 0, yaw: 0, P: 2600, e: E.io3 },
    { t: 24.0, e: E.lin },
    { t: 24.9, s: 1.005, e: E.io2 },
    { t: 26.6, s: 1.015, e: E.lin },
    { t: 27.6, s: 0.98, e: E.io2 },
    { t: 28.2, s: 0.94, e: E.io2 },
    { t: 30.6, e: E.lin },
    { t: 32.4, sy: 430, ty: 300, tz: -1.3 * S, s: 0.62, pitch: -23, yaw: -25, P: 2300, e: E.io3 },
    { t: 44, e: E.lin },
  ];
  for (let i = 1; i < CAM.length; i++) CAM[i] = { ...CAM[i - 1], ...CAM[i] };
  const camAt = (t) => {
    let i = 0; while (i + 2 < CAM.length && CAM[i + 1].t <= t) i++;
    const a = CAM[i], b = CAM[i + 1], p = b.e(clamp((t - a.t) / (b.t - a.t))), c = {};
    for (const k of ["sx", "sy", "tx", "ty", "tz", "pitch", "yaw"]) c[k] = lerp(a[k], b[k], p);
    c.s = Math.exp(lerp(Math.log(a.s), Math.log(b.s), p));
    c.P = Math.exp(lerp(Math.log(a.P), Math.log(b.P), p));
    return c;
  };

  /* ── build the world ── */
  const stage = $("#stage"), lens = $("#lens"), world = $("#world");
  const folders = PROJECTS.map((pj, i) => {
    const f = el(`<div class="folder"><div class="sheet" style="--acc:${pj.acc};--accfg:${pj.on}">
        <div class="paper"><div class="print"><div class="pn">${pj.name}</div><div class="no">0${i + 1}</div><div class="pm"><i style="background:${pj.acc}"></i>${pj.note}</div><div class="rules"></div></div></div>
        <div class="ui">${toolbar(pj.extra)}<div class="content">${pj.panes.map((p) => `<div class="pane" data-p="${p}">${PANES[p]}</div>`).join("")}</div></div>
        <div class="shade"></div><div class="edge"></div></div></div>`);
    world.append(f);
    $$(".site.day", f).forEach((n) => (n.innerHTML = site(false)));
    $$(".site.night", f).forEach((n) => (n.innerHTML = site(true)));
    const panes = {};
    $$(".pane", f).forEach((p) => {
      panes[p.dataset.p] = {
        root: p,
        at: $$("[data-at]", p).map((n) => [n, +n.dataset.at]),
        type: $$("[data-type]", p).map((n) => { const [s, c] = n.dataset.type.split(","); return [n, +s, +c, n.textContent]; }),
        carets: $$(".caret", p),
      };
    });
    return { pj, i, root: f, sheet: $(".sheet", f), paper: $(".paper", f), print: $(".print", f), ui: $(".ui", f), shade: $(".shade", f), edge: $(".edge", f), hl: $(".hl", f), pills: $$(".pill", f), panes };
  });
  const winshadow = el(`<div id="winshadow"></div>`), railbg = el(`<div id="railbg"><div class="plus">+</div></div>`), line = el(`<div id="line"></div>`);
  world.prepend(winshadow); world.append(railbg, line);
  const tabs = PROJECTS.map((pj) => { const n = el(`<div class="tab"><span class="tl">${pj.name}</span><span class="tx">×</span></div>`); world.append(n); return { root: n, tl: $(".tl", n), tx: $(".tx", n), pj }; });
  const cursor = el(`<div id="cursor"><svg viewBox="0 0 28 34"><path d="M3 2l21 15.5-9.6 1.6L9.2 28.6z" fill="#101116" stroke="#F3EFE9" stroke-width="2.4" stroke-linejoin="round"/></svg></div>`), ring = el(`<div id="ring"></div>`);
  /* Quick Actions: the dial that opens on ⌘⌥K */
  const QA = [["plus", "New<br>workspace"], ["agents", "Conversation"], ["browser", "Temp<br>browser"], ["term", "Terminal"], ["search", "Search"], ["more", "More"]];
  const MORE = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><circle cx="19" cy="12" r="1.9" fill="currentColor"/></svg>';
  const qdim = el(`<div id="qdim"></div>`), qa = el(`<div id="qa" class="ui">${QA.map(([ic, lb]) => `<div class="qt"><span class="ic">${ic === "more" ? MORE : IC[ic]}</span><span>${lb}</span></div>`).join("")}</div>`);
  const qtiles = $$(".qt", qa);
  world.append(qdim, qa, ring, cursor);

  /* ── type ── */
  const lineHTML = (parts) => parts.map(([txt, cls]) => txt.split(" ").map((w) => `<span class="w${cls ? " " + cls : ""}"><span>${w}</span></span>`).join(" ")).join(" ");
  const mkLines = (host, cls, lines) => { const n = el(`<div class="${cls}">${lines.map((l) => `<span class="ln">${lineHTML(l)}</span>`).join("")}</div>`); host.append(n); return { root: n, words: $$(".w > span", n) }; };
  const roll = (c, t, tIn, tOut, stag = 0.07) => {
    const on = t > tIn - 0.05 && t < tOut + 0.8;
    c.root.style.visibility = on ? "visible" : "hidden";
    if (!on) return;
    c.words.forEach((w, i) => {
      const a = P(t, tIn + i * stag, 0.8, E.out5), b = P(t, tOut + i * 0.03, 0.34, E.in3);
      w.style.transform = `translateY(${(1 - a) * 115 - b * 115}%) rotate(${(1 - a) * 5}deg)`;
    });
  };
  const headA = mkLines($("#headA"), "", [[["You’re never building"]], [["just"], ["one thing.", "kw"]]]);
  const caps = $("#caps");
  const capB = mkLines(caps, "cap", [[["So every project gets"], ["its own tab.", "kw"]]]);
  const capC = mkLines(caps, "cap", [[["And every tab is a"], ["whole workspace.", "kw"]]]);
  const capQ = mkLines(caps, "cap qcap", [[["Anything else is"], ["one shortcut away.", "kw"]]]);
  const qdesc = el(`<div class="desc qd"><kbd>⌘</kbd><kbd>⌥</kbd><kbd>K</kbd>Quick Actions — a new tab, a throwaway browser or terminal, a web search.</div>`);
  caps.append(qdesc);
  const qkeys = $$("kbd", qdesc);
  const capD = mkLines(caps, "cap", [[["Then"], ["switch.", "kw"]]]);
  const capE = mkLines(caps, "cap", [[["Everything’s right"], ["where you left it.", "kw"]]]);
  const verbs = VERBS.map(([t0, txt, tool, desc], i) => {
    const v = el(`<div class="cap verb">${[...txt].map((ch) => (ch === " " ? " " : `<span class="c">${ch}</span>`)).join("")}</div>`);
    const d = el(`<div class="desc"><b>0${i + 1} / 05</b>${tool} — ${desc}</div>`);
    caps.append(v, d);
    return { t0, v, d, chars: $$(".c", v) };
  });

  /* ── agents (ink) ── */
  const ink = $("#ink");
  const PROV = ["claude", "codex", "cursor", "copilot", "grok", "opencode", "antigravity", "factory-droid", "kilo", "openrouter"];
  const inkH = mkLines(ink, "ih", [[["Bring"], ["your own", "kw"], ["agents."]]]);
  ink.append(el(`<div class="il"></div>`));
  const discs = PROV.map((k) => { const d = el(`<div class="disc">${window.LOGOS[k]}</div>`); ink.append(d); return d; });
  const inkS = el(`<div class="is"><b>Claude, Codex, Cursor, Copilot</b> and more — on the accounts you already have.</div>`);
  ink.append(inkS);
  const inkLine = $(".il", ink);

  /* ── end ── */
  const BODY = "M 61 8 C 39 8 21 26 21 48 L 21 168 C 21 205 48 230 83 230 L 180 230 C 195 230 205 242 205 257 L 205 331 C 205 358 225 378 253 378 L 360 378 C 375 378 385 366 385 351 L 385 330 C 385 317 375 312 365 310 C 353 308 347 300 347 285 L 347 224 C 347 193 325 171 297 171 L 216 171 C 201 171 191 161 191 146 L 191 48 C 191 25 172 8 149 8 Z";
  const FOOT = "M 60 251 L 185 251 L 185 318 C 185 353 165 379 132 379 L 26 379 C 12 379 2 367 2 354 L 2 306 C 2 275 26 251 60 251 Z";
  const WORD = "M 0 1 H 94 V 17 H 60 V 80 H 38 V 17 H 0 Z M 82 80 L 118.5 1 H 150 L 185 80 H 160 L 152 62 H 112 L 103 80 Z M 120 48 H 144 L 132.5 19 Z M 192 1 H 248 C 274 1 284 11 284 24 C 284 35 279 41 269 44 C 283 46 289 55 289 65 C 289 78 279 80 252 80 H 192 Z M 212 17 V 34 H 249 C 258 34 261 31 261 26 C 261 20 256 17 249 17 Z M 212 47 V 65 H 251 C 261 65 265 62 265 56 C 265 50 261 47 251 47 Z M 384 26 H 362 V 22 C 362 17 356 15 346 15 H 328 C 314 15 310 18 310 23 C 310 29 317 31 330 33 L 355 37 C 379 40 386 48 386 62 C 386 76 373 81 349 81 H 324 C 300 81 290 75 290 57 H 313 C 313 64 318 66 330 66 H 348 C 362 66 365 63 365 58 C 365 52 358 50 345 48 L 320 44 C 298 41 291 34 291 23 C 291 7 304 0 330 0 H 350 C 372 0 384 6 384 21 Z";
  const end = $("#end");
  end.innerHTML = `<div class="lock">
      <svg id="mk" width="320" height="320" viewBox="0 0 390 390"><g id="mkBody"><path fill="${IVORY}" d="${BODY}"/><g id="mkEyes" fill="#0e2af3"><rect x="65" y="108" width="23" height="56" rx="11.5"/><rect x="126" y="108" width="23" height="56" rx="11.5"/></g></g><path id="mkFoot" fill="${IVORY}" d="${FOOT}"/></svg>
      <svg id="wm" width="660" height="138" viewBox="0 0 386 81"><path fill="${IVORY}" fill-rule="evenodd" d="${WORD}"/></svg></div>`;
  const endTag = mkLines(end, "tag", [[["Every project."], ["One window.", "kw"]]]);
  const endMeta = el(`<div class="meta"><span class="beta">PUBLIC BETA</span><span class="os">macOS · Windows · Linux</span><i class="sep"></i><span class="url">buildwithtabs.com</span></div>`);
  end.append(endMeta);
  const mk = $("#mk"), wm = $("#wm"), mkBody = $("#mkBody"), mkFoot = $("#mkFoot"), mkEyes = $("#mkEyes"), metaKids = [...endMeta.children];

  /* ── measured layout ── */
  let CUR = [];
  const off = (n, root) => { let x = 0, y = 0; while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; } return [x, y]; };
  function measure() {
    for (const f of folders) f.pillBox = Object.fromEntries(f.pills.map((p) => [p.dataset.tool, [p.offsetLeft, p.offsetWidth, p]]));
    const s0 = folders[0], at = (n, fx = 0.5, fy = 0.5) => { const [x, y] = off(n, s0.sheet); return [x - HW + n.offsetWidth * fx, y + n.offsetHeight * fy]; };
    const pill = (id) => at(s0.pillBox[id][2], 0.6, 0.62);
    const tab = (i) => [AX(i) + AW * 0.55, -AH * 0.42];
    CUR = [
      [11.7, 380, 560], [14.4, ...pill("agents")], [16.8, ...pill("dock")], [19.2, ...pill("browser")],
      [20.25, ...at($(".site.day .tog", s0.sheet), 0.5, 0.6)], [21.6, ...pill("git")], [23.0, ...at($(".commit", s0.sheet), 0.62, 0.55)],
      [T.sw1, ...tab(1)], [T.sw2, ...tab(2)], [31.0, 300, 260],
    ];
    const tog = off($(".site.day .tog", s0.sheet), $(".page", s0.sheet));
    R.tog = [tog[0] + 27, tog[1] + 15];
  }
  const R = {};

  /* ── per-frame pieces ── */
  function paneContent(pane, lt, t) {
    for (const [n, a] of pane.at) { const p = P(lt, a, 0.42, E.out5); n.style.opacity = p; n.style.transform = p < 1 ? `translateY(${(1 - p) * 10}px)` : ""; }
    let typing = false;
    for (const [n, s, cps, full] of pane.type) { const k = clamp(Math.floor((lt - s) * cps), 0, full.length); if (k > 0 && k < full.length) typing = true; const txt = full.slice(0, k); if (n.textContent !== txt) n.textContent = txt; }
    const blink = typing || (t * 1.7) % 1 < 0.55 ? 1 : 0;
    for (const c of pane.carets) c.style.opacity = blink;
  }

  function render(t) {
    const cam = camAt(t);
    /* a breath of handheld life while we are inside the window */
    const inWin = P(t, 10.6, 1.4, E.io2) * (1 - P(t, 27.2, 0.9, E.io2));
    cam.yaw += inWin * 2.0 * Math.sin(((t - 12) * Math.PI * 2) / 9.6);
    cam.pitch += inWin * 1.1 * Math.sin(((t - 12) * Math.PI * 2) / 7.2 + 1);
    for (const [ts] of SCH.slice(1)) cam.s *= 1 - 0.014 * Math.exp(-Math.max(0, t - ts) * 5) * (t >= ts ? 1 : 0);
    for (const ts of [T.sw1, T.sw2]) cam.s *= 1 + 0.03 * Math.sin(clamp((t - ts) / 0.85) * Math.PI);
    lens.style.perspective = `${cam.P}px`;
    lens.style.perspectiveOrigin = `${cam.sx}px ${cam.sy}px`;
    world.style.transform = `translate(${cam.sx}px,${cam.sy}px) translateZ(${cam.P - cam.P / cam.s}px) rotateX(${cam.pitch}deg) rotateY(${cam.yaw}deg) translate3d(${-cam.tx}px,${-cam.ty}px,${-cam.tz}px)`;
    const worldOn = t < T.ink + 1.0;
    lens.style.visibility = worldOn ? "visible" : "hidden";

    /* ── the line ── */
    const lh = 2.5 / cam.s;
    line.style.cssText = `left:${HERO_X - 3200}px;top:${-lh / 2}px;width:6400px;height:${lh}px;transform:translateZ(1px) scaleX(${P(t, T.land, 1.1, E.out5)});opacity:${t < T.land ? 0 : 1 - P(t, 5.0, 0.9, E.lin)}`;

    /* ── folders: depth, paper → interface, focus ── */
    const c = P(t, T.sw1, 0.85, E.io3) + P(t, T.sw2, 0.85, E.io3);       // which project is at the front
    const depthBlur = P(t, 5.3, 1.6, E.io2) * (1 - P(t, 8.7, 1.3, E.io2)) + P(t, 30.8, 1.4, E.io2);
    const printP = P(t, 5.0, 1.3, E.out3);
    const pills0 = P(t, 9.75, 0.01);
    const hlS = sched(SCH, t);
    for (const f of folders) {
      const i = f.i;
      let pos = i - c, z, op = 1;
      if (pos < -0.999) pos += N;
      if (pos < 0) { z = -pos * 2500; op = 1 - smooth(0.1, 0.62, -pos); } else z = -pos * S;
      f.root.style.transform = `translateZ(${z}px)`;
      f.root.style.opacity = op < 1 ? op : "";
      f.root.style.visibility = op <= 0.001 ? "hidden" : "visible";
      const blur = pos < 0 ? -pos * 14 : Math.max(0, Math.abs(pos - 0.7) - 0.75) * 2.3 * depthBlur;
      f.sheet.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "";
      f.print.style.opacity = printP; f.paper.style.opacity = P(t, 4.75, 0.8, E.lin);
      /* ink soaks down the sheet and it becomes the interface */
      const soak = P(t, T.form + 0.2 + 0.13 * i, 1.15, E.io2);
      f.ui.style.visibility = soak > 0 ? "visible" : "hidden";
      const mask = soak < 1 ? `linear-gradient(180deg,#000 ${soak * 135 - 35}%,transparent ${soak * 135}%)` : "";
      f.ui.style.webkitMaskImage = mask; f.ui.style.maskImage = mask;
      f.paper.style.visibility = soak >= 1 ? "hidden" : "visible";
      f.shade.style.opacity = soak >= 1 ? clamp(pos * 0.07, 0, 0.3) : 0; f.edge.style.opacity = soak >= 1 && pos > 0.01 ? P(t, 30.7, 0.8, E.lin) : 0;

      /* tool pills + highlight */
      const active = i === 0 ? hlS.cur : f.pj.active;
      const prev = i === 0 && hlS.prev ? hlS.prev : active;
      const hp = i === 0 ? P(hlS.lt, 0, 0.5, E.out5) : 1;
      const A = f.pillBox[prev], B = f.pillBox[active];
      const stretch = Math.sin(hp * Math.PI) * 0.0;
      f.hl.style.left = `${lerp(A[0], B[0], hp)}px`; f.hl.style.width = `${lerp(A[1], B[1], hp) * (1 + stretch)}px`;
      f.pills.forEach((p, k) => {
        const id = p.dataset.tool, w = id === active ? hp : id === prev ? 1 - hp : 0;
        p.style.color = mix("#a9a9a8", f.pj.on, w);
        if (i === 0) { const a = P(t, 9.75 + k * 0.07, 0.5, E.out5); p.style.opacity = a; p.style.transform = a < 1 ? `translateY(${(1 - a) * 12}px)` : ""; }
      });
      if (i === 0) f.hl.style.opacity = P(t, 9.75, 0.4, E.out3);

      /* panes */
      if (i === 0) {
        const s = sched(SCH, t), q = s.i ? clamp(s.lt / 0.66) : 1;
        for (const [id, pane] of Object.entries(f.panes)) {
          const r = pane.root;
          if (id === s.cur) {
            const a = E.out5(q);
            r.style.display = ""; r.style.transform = q < 1 ? `scale(${0.95 + 0.05 * a})` : ""; r.style.transformOrigin = "50% 40%"; r.style.opacity = q < 1 ? smooth(0, 0.22, q) : "";
            r.style.filter = "";
            paneContent(pane, s.lt, t);
          } else if (id === s.prev && q < 1) {
            /* the old tool falls forward off the stack, like the front card in an index box */
            const a = E.io3(q);
            r.style.display = ""; r.style.transformOrigin = "50% 100%"; r.style.transform = `translateZ(${2 + 30 * a}px) rotateX(${-102 * a}deg)`; r.style.opacity = 1 - smooth(0.42, 0.8, q); r.style.filter = "";
          } else r.style.display = "none";
        }
        /* browser: the night theme washes across the page from the toggle */
        const night = $(".site.night", f.sheet);
        if (s.cur === "browser") night.style.clipPath = `circle(${P(s.lt, 1.08, 1.0, E.io3) * 1750}px at ${R.tog[0]}px ${R.tog[1]}px)`;
        /* git: commit */
        const c2 = $(".commit .c2", f.sheet);
        if (s.cur === "git") { c2.style.clipPath = `circle(${P(s.lt, 1.42, 0.55, E.out3) * 420}px at 62% 55%)`; $(".commit", f.sheet).style.transform = `scale(${1 - 0.04 * Math.sin(clamp((s.lt - 1.36) / 0.24) * Math.PI)})`; }
      } else {
        const lt = i === 1 ? t - (T.sw1 + 0.3) : i === 2 ? t - (T.sw2 + 0.3) : 99;
        for (const pane of Object.values(f.panes)) paneContent(pane, lt, t);
      }
    }
    void pills0;

    /* ── tabs: folder tabs that become the app's project tabs ── */
    const act = t < T.sw1 ? 0 : t < T.sw2 ? 1 : 2, actP = t < T.sw1 ? 1 : P(t - (t < T.sw2 ? T.sw1 : T.sw2), 0, 0.3, E.out3);
    const prevAct = t < T.sw1 ? 0 : t < T.sw2 ? 0 : 1;
    const formed = P(t, T.form + 0.8, 0.8, E.out3);
    tabs.forEach((tb, i) => {
      const m = P(t, T.form + 0.05 * i, 1.6, E.io5), pj = tb.pj;
      let x = lerp(FX[i], AX(i), m), w = lerp(FW, AW, m), h = lerp(FH, AH, m), y = -h, rot = 0, sx = 1, sy = 1, vis = true;
      let rad = [lerp(16, 11, m), lerp(16, 11, m), 0, 0];
      const aw = i === act ? actP : i === prevAct ? 1 - actP : 0;
      if (i === 0) {
        if (t < 0.45) vis = false;
        const u = t - T.land;
        if (u < 0) {                                   // the tab piece of the mark, falling
          const fp = clamp((t - 0.45) / 0.75);
          w = 150; h = 104; x = HERO_X - 75; y = -h - (1 - fp * fp) * 760; rot = (1 - fp) * -16; rad = [48, 6, 46, 20];
        } else {                                       // it lands on the line and settles into a tab
          const p = P(u, 0.02, 0.55, E.out5), wob = Math.exp(-u * 8) * Math.cos(u * 23);
          w = lerp(150, FW, p) * (m > 0 ? lerp(1, AW / FW, m) : 1); h = lerp(104, FH, p) * (m > 0 ? lerp(1, AH / FH, m) : 1); x = m > 0 ? x : HERO_X - w / 2; y = -h;
          rad = [lerp(48, rad[0], p), lerp(6, rad[1], p), lerp(46, 0, p), lerp(20, 0, p)];
          sx = 1 + 0.2 * wob; sy = 1 - 0.3 * wob;
        }
      } else {
        const tp = T.pops[i]; vis = t >= tp;
        const sp = E.spring(clamp((t - tp) / 0.75)); sy = sp; sx = 1 + (1 - sp) * 0.12;
      }
      const z = -i * S * (1 - m) + 2;
      const blur = Math.max(0, Math.abs(i - 0.7) - 0.75) * 2.3 * depthBlur * (1 - m);
      const bg = mix(pj.acc, aw > 0 ? mix("#0b0b0c", "#171718", aw).replace(/rgb\((\d+),(\d+),(\d+)\)/, (_, r, g, b) => "#" + [r, g, b].map((v) => (+v).toString(16).padStart(2, "0")).join("")) : "#0b0b0c", m);
      const fg = mix(pj.on, aw > 0.5 ? "#f1f1ef" : "#8b8b8a", m);
      const s = tb.root.style;
      s.visibility = vis ? "visible" : "hidden";
      s.width = `${w}px`; s.height = `${h}px`; s.background = bg; s.color = fg;
      s.borderRadius = rad.map((r) => `${r}px`).join(" ");
      s.fontSize = `${lerp(19, 14.5, m)}px`; s.padding = `0 ${lerp(20, 13, m)}px 0 ${lerp(20, 14, m)}px`;
      s.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "";
      s.transform = `translate3d(${x}px,${y}px,${z}px) rotate(${rot}deg) scale(${sx},${sy})`;
      tb.tx.style.opacity = m * (0.35 + 0.5 * aw);
      if (i === 0) { const full = pj.name, k = t < 1.52 ? 0 : clamp(Math.floor((t - 1.52) * 17), 0, full.length); const txt = full.slice(0, k); if (tb.tl.textContent !== txt) tb.tl.textContent = txt; }
    });
    railbg.style.opacity = formed; winshadow.style.opacity = formed * (1 - P(t, 30.6, 0.6, E.lin) * 0.5);
    railbg.style.transform = "translateZ(1px)";
    $(".plus", railbg).style.left = `${AX(N) - HW + 2}px`;

    /* ── Quick Actions ── */
    const u = t - T.qa, qOpen = P(u, 0.3, 0.5, E.lin) * (1 - P(u, 2.62, 0.4, E.lin));
    qdim.style.opacity = P(u, 0.25, 0.45, E.out3) * (1 - P(u, 2.7, 0.6, E.io2)) * 0.62; qdim.style.transform = "translateZ(3px)";
    qa.style.visibility = qOpen > 0 ? "visible" : "hidden";
    if (qOpen > 0) {
      const step = Math.min(4, Math.floor(Math.max(0, u - 0.9) / 0.3)), focus = u < 0.9 ? -1 : [4, 5, 0, 1, 2][step], fT = 0.9 + step * 0.3;
      const press = Math.sin(clamp((u - 2.32) / 0.22) * Math.PI);
      qtiles.forEach((n, i) => {
        const a = E.spring(clamp((u - 0.3 - i * 0.055) / 0.7)), out = P(u, 2.62 + (5 - i) * 0.03, 0.34, E.in3), r = 176 * a * (1 - out), ang = ((-90 + i * 60) * Math.PI) / 180;
        const on = i === focus, w = on ? P(u, fT, 0.14, E.out3) : 0;
        n.style.transform = `translate3d(${Math.cos(ang) * r}px,${400 + Math.sin(ang) * r}px,${50 + 24 * w}px) scale(${(0.3 + 0.7 * a) * (1 - out) * (1 + 0.1 * w - (on ? 0.12 * press : 0))})`;
        n.style.opacity = clamp(a * 2.2) * (1 - out);
        n.style.background = mix("#27272a", "#0e2af3", w); n.style.color = mix("#e9e9e7", "#ffffff", w);
      });
    }
    qdesc.style.visibility = u > -0.1 && u < 3.9 ? "visible" : "hidden";
    { const da = P(u, 0.1, 0.5, E.out5), db = P(u, 3.35, 0.25, E.lin); qdesc.style.opacity = Math.min(da, 1 - db); qdesc.style.transform = `translateY(${(1 - da) * 12}px)`;
      qkeys.forEach((k, i) => { const pr = Math.sin(clamp((u - i * 0.08) / 0.3) * Math.PI); k.style.transform = `translateY(${pr * 3}px) scale(${1 - pr * 0.08})`; k.style.background = mix("#101116", "#0e2af3", clamp(pr * 1.5)); }); }

    /* ── cursor ── */
    let ci = 0; while (ci + 1 < CUR.length && CUR[ci + 1][0] <= t) ci++;
    const k0 = CUR[ci], k1 = CUR[ci + 1] || k0, mv = Math.min(0.8, (k1[0] - k0[0]) * 0.55), mp = E.io3(clamp((t - (k1[0] - mv - 0.05)) / mv));
    const cx = lerp(k0[1], k1[1], mp), cy = lerp(k0[2], k1[2], mp) + Math.sin(mp * Math.PI) * -26;
    let press = 0, ringP = -1;
    for (const k of CUR.slice(1, -1)) { const d = t - k[0]; if (d > -0.09 && d < 0.14) press = Math.sin(((d + 0.09) / 0.23) * Math.PI); if (d >= 0 && d < 0.6) ringP = d / 0.6; }
    const cop = P(t, 11.3, 0.4, E.lin) * (1 - P(t, 30.5, 0.4, E.lin)) * (1 - P(t, 23.75, 0.3, E.lin) * (1 - P(t, 27.45, 0.3, E.lin)));
    cursor.style.opacity = cop; cursor.style.transform = `translate3d(${cx}px,${cy}px,6px) scale(${1.25 * (1 - 0.14 * press)})`;
    ring.style.opacity = ringP < 0 ? 0 : (1 - ringP) * 0.9 * cop; ring.style.transform = `translate3d(${cx}px,${cy}px,5px) scale(${0.25 + E.out3(Math.max(ringP, 0)) * 0.95})`;

    /* ── type ── */
    roll(headA, t, 2.35, 4.72, 0.085);
    $("#scrim").style.opacity = P(t, 5.0, 0.8, E.lin) * (1 - P(t, T.ink + 0.4, 0.4, E.lin));
    roll(capB, t, 5.6, 8.25); roll(capC, t, 9.35, 11.6); roll(capQ, t, 24.2, 27.4); roll(capD, t, 27.75, 29.65); roll(capE, t, 30.1, 32.35);
    verbs.forEach((v, i) => {
      const tIn = v.t0, tOut = i + 1 < verbs.length ? verbs[i + 1].t0 - 0.2 : 23.85;
      const on = t > tIn - 0.05 && t < tOut + 0.6;
      v.v.style.visibility = v.d.style.visibility = on ? "visible" : "hidden";
      if (!on) return;
      v.chars.forEach((ch, k) => {
        const a = P(t, tIn + k * 0.028, 0.7, E.out5), b = P(t, tOut + k * 0.012, 0.22, E.in3);
        ch.style.opacity = Math.min(P(t, tIn + k * 0.028, 0.2, E.lin), 1 - b);
        ch.style.transform = `translateY(${(1 - a) * 0.6 - b * 0.35}em) rotate(${(1 - a) * 9}deg)`;
      });
      const da = P(t, tIn + 0.25, 0.6, E.out5), db = P(t, tOut, 0.2, E.lin);
      v.d.style.opacity = Math.min(da, 1 - db); v.d.style.transform = `translateY(${(1 - da) * 12}px)`;
    });

    /* ── agents: ink ── */
    const inkOn = t >= T.ink - 0.02 && t < T.end + 1.1;
    ink.style.visibility = inkOn ? "visible" : "hidden";
    if (inkOn) {
      ink.style.clipPath = `circle(${P(t, T.ink, 0.95, E.io3) * 1300}px at 960px 430px)`;
      roll(inkH, t, T.ink + 0.5, 99, 0.09);
      inkLine.style.transform = `scaleX(${P(t, T.ink + 0.45, 1.2, E.out5)})`;
      discs.forEach((d, i) => {
        const tx = 960 + (i - (discs.length - 1) / 2) * 150, p = P(t, T.ink + 0.75 + i * 0.075, 1.35, E.out5), x = lerp(2150 + i * 30, tx, p);
        const hop = Math.sin(clamp((t - (T.ink + 2.55 + i * 0.05)) / 0.36) * Math.PI) * 26;
        d.style.transform = `translate(${x}px,${-hop}px) rotate(${((x - tx) / 60) * (180 / Math.PI)}deg)`;
      });
      const sp = P(t, T.ink + 1.9, 0.7, E.out5); inkS.style.opacity = sp; inkS.style.transform = `translateY(${(1 - sp) * 14}px)`;
    }

    /* ── end ── */
    const endOn = t >= T.end - 0.02;
    end.style.visibility = endOn ? "visible" : "hidden";
    if (endOn) {
      const e0 = T.end;
      end.style.clipPath = t < e0 + 1 ? `circle(${P(t, e0, 0.95, E.io3) * 1320}px at 960px 741px)` : "";
      const lock = P(t, e0 + 2.15, 0.95, E.io5);                         // the mark steps aside for the word
      const sc = lerp(1.3, 1, lock), mx = lerp(800, 442, lock), my = lerp(330, 232, lock);
      mk.style.transform = `translate(${mx}px,${my}px) scale(${sc})`; mk.style.transformOrigin = "160px 160px";
      const fp = clamp((t - (e0 + 0.5)) / 0.7), u = t - (e0 + 1.2), wob = u > 0 ? Math.exp(-u * 8) * Math.cos(u * 23) : 0;
      mkFoot.setAttribute("transform", `translate(0 ${-(1 - fp * fp) * 1500}) translate(95 379) rotate(${(1 - fp) * -16}) scale(${1 + 0.2 * wob} ${1 - 0.3 * wob}) translate(-95 -379)`);
      mkFoot.style.visibility = t > e0 + 0.5 ? "visible" : "hidden";
      const bs = E.spring(clamp((t - (e0 + 1.32)) / 0.8));
      mkBody.setAttribute("transform", `translate(200 236) rotate(${(1 - bs) * -10}) scale(${0.4 + 0.6 * bs} ${bs}) translate(-200 -236)`);
      mkBody.style.visibility = t > e0 + 1.32 ? "visible" : "hidden";
      const blinkAt = (tb) => { const d = (t - tb) / 0.2; return d > 0 && d < 1 ? Math.sin(d * Math.PI) : 0; };
      const open = P(t, e0 + 1.82, 0.22, E.out5), bl = Math.max(blinkAt(e0 + 4.75), blinkAt(e0 + 5.05)), ey = open * (1 - 0.92 * bl) + 0.07 * (1 - open);
      const look = (P(t, e0 + 2.2, 0.5, E.io3) - P(t, e0 + 3.5, 0.6, E.io3)) * 7;
      mkEyes.setAttribute("transform", `translate(${look} 136) scale(1 ${ey}) translate(0 -136)`);
      const wp = P(t, e0 + 2.3, 0.9, E.out5);
      wm.style.left = `${lerp(750, 818, wp)}px`; wm.style.top = "331px"; wm.style.clipPath = `inset(0 ${(1 - wp) * 100}% 0 0)`; wm.style.opacity = P(t, e0 + 2.3, 0.2, E.lin);
      roll(endTag, t, e0 + 3.0, 99, 0.08);
      metaKids.forEach((n, i) => { const a = P(t, e0 + 3.75 + i * 0.09, 0.7, E.out5); n.style.opacity = a; n.style.transform = `translateY(${(1 - a) * 16}px)`; });
    }
  }

  /* ── boot ── */
  const fit = $("#fit"), rendering = location.search.includes("render");
  const doFit = () => { const s = rendering ? 1 : Math.min(innerWidth / 1920, (innerHeight - 40) / 1080); fit.style.transform = `scale(${s})`; fit.style.left = rendering ? "0" : `${(innerWidth - 1920 * s) / 2}px`; };
  addEventListener("resize", doFit); doFit();
  if (rendering) $("#hud").style.display = "none";
  window.DURATION = DUR;
  window.seek = (t) => render(t);
  const faces = ['400 20px "Hebdomadal"', 'italic 400 20px "Instrument Serif"', '400 20px "Overused Grotesk"', '500 20px "Overused Grotesk"', '600 20px "Overused Grotesk"', '700 20px "Overused Grotesk"'];
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

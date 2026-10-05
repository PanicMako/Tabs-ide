import { overlaps, intensity, jumpHeight, runComplete, type Intensity } from "./tab-hop";
const root = document.querySelector<HTMLElement>("[data-arcade]");
if (root) {
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const canvas = get<HTMLCanvasElement>("[data-canvas]");
  const ctx = canvas.getContext("2d")!;
  const overlay = get("[data-overlay]");
  const start = get<HTMLButtonElement>("[data-start]");
  const pause = get<HTMLButtonElement>("[data-pause]");
  const laneButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-lane]"));
  let level: Intensity = "chill";
  let config: (typeof intensity)[Intensity] = intensity[level];
  const levelButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-level]"));
  const names = ["STUDIO SITE", "NEXT PRODUCT", "WEEKEND IDEA"];
  const colors = ["#3259ed", "#509981", "#c49664"];
  const tools = [
    { mark: "</>", name: "Code", lesson: "Code: a complete IDE in your project tab." },
    { mark: "✳", name: "Claude", lesson: "Agents: coding conversations stay with their project." },
    { mark: ">_", name: "Codex CLI", lesson: "Your CLI: add commands like Codex or Claude." },
    { mark: "⑂", name: "GitHub", lesson: "Git: review changes without leaving your workspace." },
    { mark: "◎", name: "Figma", lesson: "Browser: add any website, including Figma." },
  ];
  const mascot = new Image();
  mascot.src = "/game/maco-surfer-v2.png";
  mascot.onload = () => {
    if (!running || paused) draw();
  };
  const glyphs = Array.from(root.querySelectorAll<SVGElement>("[data-tool-glyphs] svg")).map(
    (svg) => {
      const image = new Image();
      const copy = svg.cloneNode(true) as SVGElement;
      copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      copy.setAttribute("stroke", "#243654");
      image.src =
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(new XMLSerializer().serializeToString(copy));
      return image;
    },
  );
  for (const [index, src] of [
    [1, "/providers/claude.svg"],
    [2, "/providers/codex.svg"],
    [4, "/game/figma.svg"],
  ] as const) {
    const icon = new Image();
    icon.src = src;
    glyphs[index] = icon;
  }
  let laneCounts = [0, 0, 0];
  let visualLane = 1;
  let held: number[] = [];
  let lane = 1,
    score = 0,
    lives = 3,
    running = false,
    paused = false,
    frame = 0,
    last = 0,
    clock = 0,
    spawn = 0,
    jump = 0,
    invincible = 0,
    width = 1200,
    height = 480;
  type Item = { x: number; lane: number; kind: "tool" | "window"; tool: number; phase: number };
  let items: Item[] = [];
  let particles: { x: number; y: number; age: number; color: string; mark: string }[] = [];
  let combo = 0;
  let shake = 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function resize() {
    const r = canvas.getBoundingClientRect();
    width = r.width;
    height = r.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!running || paused) {
      visualLane = lane;
      draw();
    }
  }
  const y = (n: number) => height * (0.23 + n * 0.28);
  const waveY = (x: number, n: number) =>
    y(n) +
    Math.sin((x / width) * 7 - clock * 1.7 + n * 1.7) * 20 +
    Math.sin((x / width) * 15 - clock * 2.2 + n) * 6;
  const playerX = () => Math.max(100, width * 0.24);
  function rounded(x: number, y: number, w: number, h: number, r: number, fill: string) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }
  function toolArt(x: number, py: number, index: number, size = 1) {
    ctx.save();
    ctx.translate(x, py);
    ctx.scale(size, size);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const ink = ["#c7d7ff", "#f2c6ab", "#faf7ee", "#f7c7be", "#faf7ee"][index];
    ctx.shadowColor = "#27456b35";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = ink;
    ctx.beginPath();
    if (index === 0) {
      for (let n = 0; n < 8; n++) {
        const angle = (n * Math.PI) / 4 + Math.PI / 8;
        const x = Math.cos(angle) * 28,
          y = Math.sin(angle) * 28;
        if (n === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    } else if (index === 2) ctx.roundRect(-30, -22, 60, 44, 15);
    else ctx.arc(0, 0, 27, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = "#fffdf2";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#ffffff75";
    ctx.beginPath();
    ctx.ellipse(-7, -12, 12, 4, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#26384b30";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, Math.PI * 2);
    ctx.stroke();
    const glyph = glyphs[index];
    if (glyph?.complete && glyph.naturalWidth) ctx.drawImage(glyph, -13, -13, 26, 26);
    ctx.restore();
  }
  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    if (shake > 0 && !reduced) ctx.translate(Math.sin(clock * 65) * shake * 6, 0);
    const sea = ctx.createLinearGradient(0, 0, 0, height);
    sea.addColorStop(0, "#f6f7fc");
    sea.addColorStop(0.5, "#dce8f7");
    sea.addColorStop(1, "#c9dcf0");
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, width, height);
    // Three rolling currents, each a project. Foam drifts at a different pace from the tools.
    for (let n = 0; n < 3; n++) {
      const center = y(n);
      const current = ctx.createLinearGradient(0, y(n) - 35, 0, y(n) + height * 0.32);
      current.addColorStop(0, ["#b6d7ee", "#96cddc", "#83b7d9"][n]);
      current.addColorStop(0.15, ["#dceffa", "#c3e9ed", "#b8dced"][n]);
      current.addColorStop(1, ["#c8deed", "#aed4e4", "#9fc6e1"][n]);
      ctx.fillStyle = current;
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, waveY(0, n) - 27);
      for (let x = 0; x <= width + 20; x += 20) ctx.lineTo(x, waveY(x, n) - 27);
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = n === lane ? "#ffffff" : "#ffffff90";
      ctx.lineWidth = n === lane ? 5 : 3;
      ctx.beginPath();
      for (let x = 0; x <= width + 20; x += 12) {
        const v = waveY(x, n) - 27;
        if (x === 0) ctx.moveTo(x, v);
        else ctx.lineTo(x, v);
      }
      ctx.stroke();
      ctx.strokeStyle = "#ffffff80";
      ctx.lineWidth = 1;
      ctx.setLineDash([12, 8, 3, 16]);
      ctx.lineDashOffset = -clock * 40;
      ctx.stroke();
      ctx.setLineDash([]);
      for (let ripple = 0; ripple < 13; ripple++) {
        const rx =
          (((((ripple * width) / 12 - clock * (25 + n * 7)) % (width + 120)) + width + 120) %
            (width + 120)) -
          60;
        const ry = waveY(rx, n) + 45 + (ripple % 2) * 8;
        ctx.strokeStyle = "#ffffff9a";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.quadraticCurveTo(rx + 17, ry - 4, rx + 36, ry);
        ctx.stroke();
      }
      ctx.fillStyle = n === lane ? "#657e9f" : "#9aacc1";
      ctx.font = "9px monospace";
      ctx.fillText(names[n], 20, center - 47);
    }
    // Small distant sparkles keep the sea alive without a heavy particle engine.
    if (!reduced)
      for (let i = 0; i < 14; i++) {
        const sx = (((i * 113 - clock * 18) % (width + 50)) + width + 50) % (width + 50);
        const sy = height * 0.1 + ((i * 97) % (height * 0.8));
        ctx.globalAlpha = 0.12 + 0.15 * Math.sin(clock * 2 + i);
        ctx.fillStyle = "#fff";
        ctx.fillRect(sx, sy, 3, 1);
        ctx.fillRect(sx + 1, sy - 1, 1, 3);
      }
    ctx.globalAlpha = 1;
    for (const item of items) {
      const py = waveY(item.x, item.lane);
      if (item.kind === "window") {
        ctx.save();
        ctx.translate(item.x, py);
        ctx.rotate(Math.sin(clock + item.phase) * 0.08);
        rounded(-28, -19, 56, 44, 8, "#283750");
        ctx.fillStyle = "#71829f";
        ctx.fillRect(-22, -11, 43, 1);
        ctx.fillStyle = "#b5c5df";
        ctx.font = "9px monospace";
        ctx.fillText("×", 16, -5);
        ctx.strokeStyle = "#50627f";
        ctx.strokeRect(-17, -1, 33, 17);
        ctx.restore();
      } else {
        const bob = reduced ? 0 : Math.sin(clock * 3 + item.phase) * 5;
        ctx.save();
        ctx.translate(item.x, py - 4 + bob);
        ctx.rotate(Math.sin(clock * 2 + item.phase) * 0.08);
        ctx.shadowColor = "#425d8530";
        ctx.shadowBlur = 14;
        ctx.shadowOffsetY = 7;
        toolArt(0, 0, item.tool);
        ctx.restore();
        ctx.font = "8px monospace";
        ctx.fillStyle = "#7892af";
        ctx.textAlign = "center";
        ctx.fillText(tools[item.tool].name.toUpperCase(), item.x, py + 40);
        ctx.textAlign = "left";
      }
    }
    const lift = jump > 0 ? jumpHeight(jump, config.jumpDuration) : 0;
    const px = playerX(),
      py = waveY(playerX(), visualLane) - lift;
    const bob = reduced ? 0 : Math.sin(clock * 4) * 3;
    ctx.globalAlpha = invincible > 0 ? 0.5 : 1;
    ctx.fillStyle = "#bac8e63a";
    ctx.beginPath();
    ctx.ellipse(px + 3, waveY(px, visualLane) + 26, 39 - lift / 6, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(px, py + bob);
    ctx.rotate(
      jump > 0
        ? Math.sin(jump * 5) * 0.1
        : (lane - visualLane) * 0.22 + Math.sin(clock * 2) * 0.025,
    );
    ctx.strokeStyle = "#ffffffb0";
    ctx.lineWidth = 2;
    for (let t = 0; t < 5; t++) {
      ctx.beginPath();
      ctx.moveTo(-110 - t * 14, 17 + t * 4);
      ctx.quadraticCurveTo(-60, 7 + t * 8, -40, 24 + t * 3);
      ctx.stroke();
    }
    const spriteWidth = width < 650 ? 146 : 190;
    if (mascot.complete && mascot.naturalWidth) {
      ctx.drawImage(
        mascot,
        -spriteWidth * 0.52,
        -spriteWidth * 0.57,
        spriteWidth,
        (spriteWidth * 2) / 3,
      );
    } else {
      rounded(-45, -30, 90, 45, 24, "#3259ed");
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    // Collected enamel patches stay attached to Maco's canvas backpack.
    ctx.save();
    ctx.translate(px, py + bob);
    ctx.rotate(
      jump > 0
        ? Math.sin(jump * 5) * 0.1
        : (lane - visualLane) * 0.22 + Math.sin(clock * 2) * 0.025,
    );
    for (let i = Math.min(held.length, 5) - 1; i >= 0; i--) {
      const bx = -30 + (i % 3) * 10;
      const by = -54 + Math.floor(i / 3) * 13;
      toolArt(bx, by, held[i], 0.29);
    }
    ctx.restore();
    for (const p of particles) {
      const t = p.age;
      const fx = p.x + (playerX() - 20 - p.x) * t,
        fy = p.y + (waveY(px, visualLane) - lift - 50 - p.y) * t - Math.sin(t * Math.PI) * 80;
      ctx.globalAlpha = Math.max(0, 1 - t);
      toolArt(
        fx,
        fy,
        tools.findIndex((tool) => tool.mark === p.mark),
        0.65 * (1 - t) + 0.2,
      );
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  function select(n: number) {
    lane = Math.max(0, Math.min(2, n));
    get(".arcade-projects").style.setProperty("--lane-index", String(lane));
    laneButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === lane)));
    if (!running || paused) {
      visualLane = lane;
      draw();
    }
  }
  function stats() {
    get("[data-score]").textContent = `BAG ${String(score).padStart(2, "0")} / ${config.goal}`;
    const seconds = Math.max(0, Math.ceil(config.duration - clock));
    get("[data-time]").textContent =
      `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    get("[data-time]").classList.toggle("is-urgent", seconds <= 15);
    root!.querySelectorAll("[data-lane-count]").forEach((el, i) => {
      el.textContent = `${laneCounts[i]}/${config.quota}`;
    });
    get("[data-lives]").textContent = "♥ ".repeat(lives) + "♡ ".repeat(config.lives - lives);
  }
  function end(won: boolean) {
    running = false;
    cancelAnimationFrame(frame);
    overlay.hidden = false;
    levelButtons.forEach((b) => (b.disabled = false));
    pause.disabled = true;
    get("[data-overlay-kicker]").textContent = won
      ? "YOUR TOOLS. THREE PROJECTS. ONE WINDOW."
      : "A LITTLE CLUTTER GOT IN THE WAY.";
    get("[data-overlay-title]").textContent = won ? "You found your flow." : "Another little ride?";
    get("[data-overlay-copy]").textContent = won
      ? "That’s the idea: your code, agents, websites, and CLI tools stay together in Tabs."
      : `${score} tools collected. ${clock >= config.duration ? "Time ran out." : "The clutter caught you."} Collect tools in every project, and time your jumps.`;
    start.textContent = won ? "Surf again ↗" : "Try again ↗";
    get("[data-message]").textContent = won
      ? "Nice ride. Now make something real in Tabs."
      : "No worries. Your next run is waiting.";
  }
  function tick(now: number) {
    if (!running || paused) return;
    const dt = Math.min((now - last) / 1000, 0.04);
    last = now;
    clock += dt;
    spawn += dt;
    stats();
    if (clock >= config.duration) {
      end(false);
      return;
    }
    visualLane = reduced ? lane : visualLane + (lane - visualLane) * (1 - Math.exp(-dt * 7));
    jump = Math.max(0, jump - dt);
    invincible = Math.max(0, invincible - dt);
    const speed = Math.min(width * config.speed, config.cap) + score * config.acceleration;
    shake = Math.max(0, shake - dt * 2);
    if (spawn > config.spawn) {
      spawn = 0;
      const isTool = Math.random() > config.obstacles;
      if (level !== "chill" && Math.random() < 0.45) {
        const safe = Math.floor(Math.random() * 3);
        for (let n = 0; n < 3; n++)
          items.push({
            x: width + 35,
            lane: n,
            kind: n === safe ? "tool" : "window",
            tool: Math.floor(Math.random() * tools.length),
            phase: Math.random() * 6,
          });
      } else
        items.push({
          x: width + 35,
          lane: Math.floor(Math.random() * 3),
          kind: isTool ? "tool" : "window",
          tool: Math.floor(Math.random() * tools.length),
          phase: Math.random() * 6,
        });
    }
    for (const item of items) {
      item.x -= dt * speed;
      if (overlaps(item.x, playerX(), item.lane, Math.round(visualLane))) {
        if (item.kind === "tool") {
          score++;
          laneCounts[item.lane]++;
          combo++;
          held = [item.tool, ...held].slice(0, 5);
          item.x = -100;
          stats();
          get("[data-message]").textContent =
            `${combo > 1 ? `${combo} in the bag! ` : ""}${tools[item.tool].lesson}`;
          if (!reduced)
            particles.push({
              x: playerX(),
              y: waveY(playerX(), visualLane),
              age: 0,
              color: colors[lane],
              mark: tools[item.tool].mark,
            });
          if (runComplete(score, laneCounts, config.goal, config.quota)) {
            end(true);
            return;
          }
        } else if (jumpHeight(jump, config.jumpDuration) < 32 && invincible === 0) {
          lives--;
          combo = 0;
          shake = 1;
          invincible = 0.85;
          item.x = -100;
          stats();
          get("[data-message]").textContent =
            "Window clutter! Hop with Space, or switch to another project.";
          if (lives === 0) {
            end(false);
            return;
          }
        }
      }
    }
    items = items.filter((item) => item.x > -60);
    particles.forEach((p) => (p.age += dt * 1.5));
    particles = particles.filter((p) => p.age < 1);
    draw();
    frame = requestAnimationFrame(tick);
  }
  function begin() {
    cancelAnimationFrame(frame);
    score = 0;
    laneCounts = [0, 0, 0];
    config = intensity[level];
    lives = config.lives;
    combo = 0;
    shake = 0;
    held = [];
    visualLane = 1;
    clock = 0;
    spawn = 0;
    jump = 0;
    invincible = 0;
    items = [];
    particles = [];
    running = true;
    paused = false;
    overlay.hidden = true;
    levelButtons.forEach((b) => (b.disabled = true));
    pause.disabled = false;
    pause.textContent = "Ⅱ";
    pause.setAttribute("aria-label", "Pause game");
    select(1);
    stats();
    get("[data-message]").textContent =
      "Maco’s ready. Catch the floating tools. Hop over window clutter.";
    last = performance.now();
    canvas.focus();
    frame = requestAnimationFrame(tick);
  }
  function hop() {
    if (running && !paused && jump === 0) jump = config.jumpDuration;
  }
  function togglePause() {
    if (!running) return;
    paused = !paused;
    pause.textContent = paused ? "▶" : "Ⅱ";
    pause.setAttribute("aria-label", paused ? "Resume game" : "Pause game");
    get("[data-message]").textContent = paused
      ? "Taking a breath. Resume whenever you’re ready."
      : "Back in your flow.";
    if (paused) {
      cancelAnimationFrame(frame);
    } else {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }
  levelButtons.forEach((button) =>
    button.addEventListener("click", () => {
      level = button.dataset.level as Intensity;
      config = intensity[level];
      get(".arcade-selector").style.setProperty(
        "--level-index",
        String(["chill", "flow", "turbo"].indexOf(level)),
      );
      get("[data-level-note]").textContent =
        `${config.duration} seconds · ${config.lives} hearts · ${config.quota} tools per project`;
      levelButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      get("[data-overlay-copy]").textContent =
        `Collect ${config.goal} tools. ${config.lives} hearts. ${level === "turbo" ? "Fast waves. Stay sharp." : level === "flow" ? "Find your rhythm." : "Easy waves. Plenty of room to learn."}`;
      score = 0;
      laneCounts = [0, 0, 0];
      clock = 0;
      lives = config.lives;
      stats();
    }),
  );
  start.addEventListener("click", begin);
  get("[data-restart]").addEventListener("click", begin);
  get("[data-jump]").addEventListener("click", hop);
  pause.addEventListener("click", togglePause);
  laneButtons.forEach((b, i) => b.addEventListener("click", () => select(i)));
  root.addEventListener("keydown", (e) => {
    if (!running || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const key = e.key;
    if (["ArrowUp", "ArrowDown", " ", "1", "2", "3"].includes(key)) {
      e.preventDefault();
      if (key === " ") hop();
      else if (key === "ArrowUp") select(lane - 1);
      else if (key === "ArrowDown") select(lane + 1);
      else select(Number(key) - 1);
    }
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (!running || paused) return;
    const rect = canvas.getBoundingClientRect();
    select(Math.round(((e.clientY - rect.top) / height - 0.23) / 0.28));
    hop();
    canvas.focus();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running && !paused) togglePause();
  });
  const observer = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting && running && !paused) togglePause();
  });
  observer.observe(root);
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(canvas);
  lives = config.lives;
  stats();
  resize();
  document.addEventListener(
    "astro:before-swap",
    () => {
      running = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      sizeObserver.disconnect();
    },
    { once: true },
  );
}

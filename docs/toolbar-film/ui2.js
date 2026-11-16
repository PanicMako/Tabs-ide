/* Extra interface pieces for the toolbar film: tools a project pins to its own toolbar.
   A browser tab is a name + URL, a terminal tab is a name + command (Project settings → Browser Tabs / Terminal Tabs). */
(() => {
  const { IC, PANES } = window.UI, L = window.LOGOS;
  const tri = '<svg viewBox="0 0 24 24"><path d="M12 3.5l10 17H2z" fill="currentColor"/></svg>';
  IC.vercel = tri; IC.codex = L.codex; IC.claude = L.claude; IC.figma = L.figma;
  IC.book = '<svg viewBox="0 0 24 24" class="stroke"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11"/></svg>';
  IC.db = '<svg viewBox="0 0 24 24" class="stroke"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>';

  /* a CLI pinned as a terminal tab */
  const cli = ({ logo, name, cmd, cwd, banner, prompt, lines, col }) => `
    <div class="clihead"><span class="ic" style="color:${col}">${logo}</span><b>${name}</b><small>Terminal tab · <code>${cmd}</code></small><span class="dbtn">Split</span><span class="dbtn">Restart</span></div>
    <div class="cliterm"><pre><div data-at="0.05"><span class="d">${cwd} $</span> ${cmd}</div><div data-at="0.12">&nbsp;</div>
<div class="cbox" data-at="0.16"><span style="color:${col}">${banner[0]}</span>  <b>${banner[1]}</b>\n<span class="d">${banner[2]}</span></div>
<div data-at="0.22">&nbsp;</div><div class="cprompt" data-at="0.26"><span style="color:${col}">›</span> <span data-type="0.32,46">${prompt}</span><i class="caret blk"></i></div><div data-at="0.3">&nbsp;</div>${lines.map(([at, h]) => `<div data-at="${at}">${h}</div>`).join("")}</pre></div>`;

  PANES.claude = cli({ logo: L.claude, name: "Claude Code", cmd: "claude", cwd: "~/code/atlas-web", col: "#e08a5b",
    banner: ["✻", "Claude Code", "cwd: ~/code/atlas-web · /help for commands"], prompt: "give the landing page a night theme",
    lines: [[1.15, '<span class="g">●</span> Read <span class="u">src/theme.css</span>'], [1.3, '<span class="g">●</span> Update <span class="u">src/theme.css</span>  <span class="g">+24</span> <span class="r">−3</span>'], [1.45, '<span class="g">●</span> Bash <span class="d">bun test</span>  <span class="g">42 passed</span>']] });
  PANES.codexP = cli({ logo: L.codex, name: "Codex", cmd: "codex", cwd: "~/code/passes-api", col: "#f1f1ef",
    banner: [">_", "OpenAI Codex", "workdir: ~/code/passes-api · approvals: on-request"], prompt: "write tests for the tickets router",
    lines: [[1.1, '<span class="d">•</span> Explored <span class="u">app/tickets.py</span>, <span class="u">tests/</span>'], [1.25, '<span class="d">•</span> Added <span class="u">tests/test_tickets.py</span>  <span class="g">+86</span>'], [1.4, '<span class="d">•</span> Ran <span class="d">pytest -q</span>  <span class="g">18 passed</span>']] });
  PANES.claudeS = cli({ logo: L.claude, name: "Claude Code", cmd: "claude", cwd: "~/design/studio", col: "#e08a5b",
    banner: ["✻", "Claude Code", "cwd: ~/design/studio · /help for commands"], prompt: "export the brand palette as CSS variables",
    lines: [[1.1, '<span class="g">●</span> Read <span class="u">tokens/brand.json</span>'], [1.25, '<span class="g">●</span> Write <span class="u">styles/brand.css</span>  <span class="g">+31</span>'], [1.4, '<span class="g">●</span> Done. 12 colours, 4 type sizes.']] });

  /* a site pinned as a browser tab */
  PANES.vercel = `
    <div class="urlrow"><span class="nav">${IC.back}${IC.fwd}${IC.reload}</span><div class="url">${IC.lock}<span>vercel.com/atlas/atlas-web</span></div><span class="ubtn">${IC.cam}Capture</span><span class="ubtn">Tools</span><span class="ubtn">View</span></div>
    <div class="vpage">
      <div class="vnav"><span class="ic">${tri}</span><i>/</i><b>atlas</b><i>/</i><b>atlas-web</b><span>Overview</span><span>Deployments</span><span>Analytics</span><span>Logs</span><span>Settings</span></div>
      <h3 data-at="0.08">Production Deployment</h3>
      <div class="vcard" data-at="0.14"><div class="vshot"><div class="site night mini"></div></div>
        <div class="vmeta"><label>Deployment</label><p>atlas-web-9f2k1x.vercel.app</p><label>Domains</label><p>atlas.guide</p>
          <label>Status</label><p class="vready" data-at="0.5"><i></i>Ready <small>38s</small></p><label>Source</label><p><code>${IC.branch} atlas/night-theme</code></p><p class="vcommit">a41c9e2 · Add night theme</p></div></div>
      <div class="vrow" data-at="0.3"><span>Preview Deployments</span><b>3</b><span>Edge Requests</span><b>18.2k</b><span>Web Vitals</span><b class="g">98</b></div>
    </div>`;

  window.UI.TOOLS = {
    code: ["Code", IC.code], agents: ["Agents", IC.agents], dock: ["Dock", IC.dock], git: ["Git", IC.git], browser: ["Browser", IC.browser], testing: ["Testing", IC.testing],
    figma: ["Figma", L.figma, "url", "figma.com/design/atlas-brand"], vercel: ["Vercel", tri, "url", "vercel.com/atlas/atlas-web"],
    claude: ["Claude Code", L.claude, "cli", "claude"], codex: ["Codex", L.codex, "cli", "codex"],
    docs: ["API docs", IC.book, "url"], psql: ["psql", IC.db, "cli"], story: ["Storybook", IC.book, "url"],
  };
})();

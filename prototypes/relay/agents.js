/* Agent notebook: Ask Relay, From agents and Share with agents.
   Uses window.tabsExtension.notebook when Tabs grants it, and the shared @relay parser
   (window.RelayCommand, generated from tabs-app/packages/shared/src/relayCommand.ts). */
(() => {
  const E = R.e, I = R.icon;
  const GRANT_HINT = 'In Tabs: Settings → Extensions → Relay → allow Agent notebook for this project.';
  const MODEL_KEY = 'relay-agents-model';
  const SHARE_PREFIX = 'relay-note:';
  const HOUR = 3600000, DAY = 86400000;

  Object.assign(R.paths, {
    spark: R.paths.spark || 'm12 3 2 6 7 3-7 2-2 7-2-7-7-2 7-3z',
    todo: 'M5 4h14v16H5zM8.5 12l2.5 2.5 4.5-5',
    bell: 'M6 17v-6a6 6 0 0 1 12 0v6l2 2H4zM10 21h4',
    context: R.paths.lines || 'M4 6h16M4 12h16M4 18h10',
    note: R.paths.file,
    tick: 'm5 12 4 4L19 6',
    share: 'M12 15V3m0 0L7 8m5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  });

  // ---------- Demo notebook (?agents=demo): in memory, for the standalone preview ----------
  function makeDemo() {
    let seq = 0;
    const iso = t => new Date(t).toISOString();
    const base = (o) => ({ id: 'demo-' + (++seq), projectId: null, kind: 'todo', title: '', body: '', status: 'open', pinned: false, tags: [], dueAt: null, firedAt: null, externalKey: null, url: null, author: 'user', threadId: null, createdAt: iso(Date.now()), updatedAt: iso(Date.now()), completedAt: null, ...o });
    let items = [
      base({ kind: 'todo', title: 'Fix the sidebar width reset', body: 'Read the persisted width before the first paint.', tags: ['bug'], author: 'agent', threadId: 'demo-thread-1', dueAt: iso(Date.now() + 5 * HOUR) }),
      base({ kind: 'context', title: 'We deploy from main on Fridays', body: 'Hotfixes go through a release branch.', author: 'user', pinned: true }),
      base({ kind: 'reminder', title: 'Check the release notes', dueAt: iso(Date.now() + 25000), author: 'user' }),
      base({ kind: 'note', title: 'Command palette feels quieter with grouped intents', author: 'agent', threadId: 'demo-thread-1' }),
    ];
    let fired = [];
    const clone = x => JSON.parse(JSON.stringify(x));
    const touch = it => { it.updatedAt = iso(Date.now()); return it; };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    return {
      demo: true,
      async list() {
        await wait(40);
        for (const it of items) if (it.kind === 'reminder' && it.status === 'open' && it.dueAt && !it.firedAt && Date.parse(it.dueAt) <= Date.now()) { it.firedAt = iso(Date.now()); fired.push(it.id); }
        const out = { items: clone(items), fired: [...fired] };
        fired = [];
        return out;
      },
      async apply(ops) {
        await wait(40);
        const applied = [];
        for (const op of ops) {
          if (op.op === 'create') {
            const { op: _o, ...rest } = op;
            const existing = rest.externalKey && items.find(i => i.externalKey === rest.externalKey);
            if (existing) { const previous = clone(existing); Object.assign(existing, rest, { updatedAt: iso(Date.now()) }); applied.push({ op, item: clone(existing), previous }); continue; }
            const item = base({ ...rest, dueAt: rest.dueAt || null }); items.unshift(item); applied.push({ op, item: clone(item), previous: null });
          } else if (op.op === 'update') {
            const it = items.find(i => i.id === op.id); if (!it) continue;
            const previous = clone(it); const { op: _o, id, ...rest } = op;
            Object.assign(it, rest); if (rest.status === 'done') it.completedAt = iso(Date.now()); if (rest.status === 'open') it.completedAt = null;
            if ('dueAt' in rest) it.firedAt = null;
            touch(it); applied.push({ op, item: clone(it), previous });
          } else if (op.op === 'delete') {
            const it = items.find(i => i.id === op.id); if (!it) continue;
            items = items.filter(i => i !== it); applied.push({ op, item: clone(it), previous: clone(it) });
          } else if (op.op === 'restore') {
            const previous = items.find(i => i.id === op.item.id); const prevClone = previous ? clone(previous) : null;
            items = items.filter(i => i.id !== op.item.id); items.unshift(clone(op.item)); applied.push({ op, item: clone(op.item), previous: prevClone });
          }
        }
        return { applied };
      },
      async models() {
        return [
          { id: 'auto', label: 'Auto', group: 'Recommended', selection: { id: 'auto' } },
          { id: 'sonnet', label: 'Claude Sonnet', group: 'Anthropic', selection: { id: 'sonnet' } },
          { id: 'opus', label: 'Claude Opus', group: 'Anthropic', selection: { id: 'opus' } },
          { id: 'gpt', label: 'GPT', group: 'OpenAI', selection: { id: 'gpt' } },
        ];
      },
      async delegate({ text }) {
        const threadId = 'demo-thread-' + (++seq);
        const titles = /github|issue/i.test(text) ? ['Triage #214: window flickers on resume', 'Reply to #209 about the extension grant'] : /brief|context/i.test(text) ? ['Context brief: what to know before touching the sidebar'] : /tidy|finished/i.test(text) ? ['Tidied 3 finished to-dos'] : ['Follow up: ' + text.slice(0, 48)];
        titles.forEach((title, n) => setTimeout(() => { items.unshift(base({ kind: /brief/i.test(title) ? 'context' : 'todo', title, author: 'agent', threadId, tags: n ? ['github'] : [] })); }, 1400 + n * 1600));
        return { threadId };
      },
    };
  }

  const params = new URLSearchParams(location.search);
  if (params.get('agents') === 'demo' && !window.tabsExtension?.notebook) {
    window.tabsExtension = Object.assign(window.tabsExtension || {}, { notebook: makeDemo() });
  }

  // ---------- State ----------
  const A = R.agents = {
    items: [], fired: [], sig: '', status: window.tabsExtension?.notebook ? 'loading' : 'unavailable',
    filter: 'open', menu: null, toasted: new Set(), queue: [], models: null, modelOpen: false, busy: false,
    ask: { text: '', force: false, working: false, since: 0, threadId: '' },
  };
  const api = () => window.tabsExtension?.notebook || null;
  const isDemo = () => !!api()?.demo;
  const RC = () => window.RelayCommand;
  const iso = t => new Date(t).toISOString();
  const noteKey = id => SHARE_PREFIX + id;

  // ---------- Toasts (with actions) ----------
  const host = document.createElement('div');
  host.className = 'agents-toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite');
  document.body.append(host);
  A.toast = (message, buttons = [], ms = 6500) => {
    if (modal.open) { A.queue.push([message, buttons, ms]); return; }
    const el = document.createElement('div'); el.className = 'agents-toast';
    const text = document.createElement('span'); text.textContent = message; el.append(text);
    let gone = false;
    const dismiss = () => { if (gone) return; gone = true; el.classList.remove('visible'); setTimeout(() => el.remove(), 200); };
    for (const [label, fn] of buttons) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'agents-toast-button'; b.textContent = label;
      b.addEventListener('click', () => { dismiss(); fn(); }); el.append(b);
    }
    while (host.children.length > 2) host.firstElementChild.remove();
    host.append(el); requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(dismiss, ms);
  };
  modal.addEventListener('close', () => { const q = A.queue.splice(0); q.forEach(args => A.toast(...args)); });

  // ---------- Notebook calls ----------
  const inverse = applied => applied.slice().reverse().map(({ op, item, previous }) => {
    if (op.op === 'create') return { op: 'delete', id: item.id };
    if (op.op === 'delete') return { op: 'restore', item: previous || item };
    return previous ? { op: 'restore', item: previous } : { op: 'delete', id: item.id };
  });
  A.run = async (ops, message, { undo = true } = {}) => {
    if (!api()) return null;
    let result;
    try { result = await api().apply(ops); } catch { A.toast('Couldn’t reach the Tabs notebook. Nothing changed.'); return null; }
    const applied = result?.applied || [];
    if (message) A.toast(message, undo && applied.length ? [['Undo', () => A.undo(applied)]] : []);
    await A.refresh(true);
    return applied;
  };
  A.undo = async applied => {
    try { await api().apply(inverse(applied)); } catch { A.toast('Couldn’t undo that.'); return; }
    await A.refresh(true);
  };

  // ---------- Polling ----------
  let inflight = false;
  A.known = null; A.fresh = '';
  A.refresh = async (force = false, arrival = false) => {
    if (!api() || inflight) return;
    inflight = true;
    try {
      const result = await api().list();
      const items = Array.isArray(result?.items) ? result.items : [];
      const sig = JSON.stringify(items);
      // Items that appeared since the last look: show them in All notes, softly highlighted.
      if (A.known) {
        const added = items.filter(i => !A.known.has(i.id) && i.status === 'open');
        if (added.length) {
          A.fresh = added[0].id;
          if (arrival && !modal.open && R.ui.scope !== 'all') { R.ui.scope = 'all'; R.ui.folder = ''; R.ui.type = 'all'; R.ui.query = ''; }
        }
      }
      A.known = new Set(items.map(i => i.id));
      const changed = sig !== A.sig || A.status !== 'ready';
      A.status = 'ready'; A.sig = sig; A.items = items;
      for (const id of result?.fired || []) {
        if (A.toasted.has(id)) continue; A.toasted.add(id);
        const item = items.find(i => i.id === id); if (item && item.status === 'open') A.reminderToast(item);
      }
      if (changed || force) A.changed();
    } catch {
      if (A.status === 'loading') { A.status = 'denied'; A.changed(); }
    } finally { inflight = false; }
  };
  A.reminderToast = item => A.toast('Reminder: ' + item.title, [
    ['Done', () => A.run([{ op: 'update', id: item.id, status: 'done' }], 'Marked done')],
    ['Snooze 1 h', () => A.snooze(item, Date.now() + HOUR)],
  ], 15000);
  setInterval(() => { if (!document.hidden) A.refresh(); }, 2500);
  window.addEventListener('focus', () => A.refresh(false, true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) A.refresh(false, true); });

  const openItems = () => A.items.filter(i => i.status === 'open');
  A.changed = (changedList = true) => {
    const count = document.querySelector('[data-scope="agents"] small');
    if (count) count.textContent = A.status === 'ready' ? String(openItems().length) : '';
    if (R.ui.scope === 'agents' && !A.menu && !modal.open) A.renderMain();
    else if (changedList && ['all', 'saved'].includes(R.ui.scope) && !A.menu && !modal.open && !document.activeElement?.matches?.('input,textarea,select,[contenteditable]')) { R.render(); A.reveal(); }
    if (modal.open && modalKind === 'agents-ask') A.renderLive();
    if (modal.open && modalKind === 'reader' && modalCard) A.refreshShare();
  };
  A.renderMain = () => {
    const main = document.querySelector('#main'); if (!main || R.ui.scope !== 'agents') return;
    const focused = document.activeElement?.closest?.('[data-item]')?.dataset.item;
    main.outerHTML = A.main();
    if (focused) document.querySelector(`[data-item="${CSS.escape(focused)}"] button`)?.focus();
  };

  // ---------- Formatting ----------
  const kindLabel = { todo: 'To-do', reminder: 'Reminder', context: 'Context', note: 'Note' };
  const glyph = kind => I(R.paths[kind] ? kind : 'note');
  const dueChip = item => {
    if (!item.dueAt) return '';
    const t = Date.parse(item.dueAt); if (Number.isNaN(t)) return '';
    const late = item.status === 'open' && t < Date.now();
    return `<span class="agent-chip ${late ? 'late' : ''}">${I('clock')}${late ? 'Overdue · ' : ''}${E(RC() ? RC().formatRelayDue(t) : new Date(t).toLocaleString())}</span>`;
  };
  const agentMark = item => (item.author === 'agent' ? `<span class="agent-chip agent-mark" title="Added by an agent">${I('spark')}Agent</span>` : `<span class="agent-chip agent-mark" title="Saved with @relay">via @relay</span>`) + (item.projectId === null ? '<span class="agent-chip" title="Not tied to one project">All projects</span>' : '');
  const tagChips = item => (item.tags || []).slice(0, 3).map(t => `<span class="note-tag">${E(t)}</span>`).join('');
  const excerpt = item => String(item.body || '').replace(/\s+/g, ' ').slice(0, 140);

  // ---------- Sidebar entry and header button ----------
  const sidebar = R.sidebar;
  R.sidebar = () => sidebar().replace(/(<button data-scope="saved"[\s\S]*?<\/button>)/, (m) =>
    m + `<button data-scope="agents" class="${R.ui.scope === 'agents' && !R.ui.folder ? 'active' : ''}">${I('spark')}<span>From agents</span><small>${A.status === 'ready' ? openItems().length : ''}</small></button>`);
  const header = R.header;
  R.header = () => header().replace('<div class="header-tools">', m => m + R.btn(`${I('spark')}<span>Ask</span>`, 'agents-ask', 'button secondary agents-ask-button', 'aria-label="Ask Relay"'));

  // ---------- From agents ----------
  const sortOpen = (a, b) => (b.pinned - a.pinned) || ((a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity)) || (Date.parse(b.createdAt) - Date.parse(a.createdAt));
  A.row = item => `<article class="note-row agent-row ${item.status === 'done' ? 'is-done' : ''}" data-item="${E(item.id)}">
    <button class="agent-tick" data-action="agent-tick" data-id="${E(item.id)}" aria-pressed="${item.status === 'done'}" aria-label="${item.status === 'done' ? 'Mark not done' : 'Mark done'}: ${E(item.title)}">${I('tick')}</button>
    <button class="note-row-open" data-action="agent-edit" data-id="${E(item.id)}" aria-label="Edit ${E(item.title)}"><span class="note-row-icon" title="${kindLabel[item.kind] || ''}">${glyph(item.kind)}</span><div><h3>${E(item.title)}</h3>${excerpt(item) ? `<p>${E(excerpt(item))}</p>` : ''}${dueChip(item) || agentMark(item) || tagChips(item) ? `<div class="agent-chips">${dueChip(item)}${agentMark(item)}${tagChips(item)}</div>` : ''}</div></button>
    <div class="agent-row-actions">${R.btn(I('pin'), 'agent-pin', 'icon-button keep-button' + (item.pinned ? ' kept' : ''), `data-id="${E(item.id)}" aria-pressed="${!!item.pinned}" aria-label="${item.pinned ? 'Unpin' : 'Pin'} ${E(item.title)}"`)}${item.status === 'open' ? R.btn(I('clock'), 'agent-snooze', 'icon-button', `data-id="${E(item.id)}" aria-haspopup="menu" aria-label="Snooze ${E(item.title)}"`) : ''}${R.btn(I('trash'), 'agent-delete', 'icon-button', `data-id="${E(item.id)}" aria-label="Delete ${E(item.title)}"`)}</div>
  </article>`;
  A.main = () => {
    const ready = A.status === 'ready';
    const list = A.items.filter(i => A.filter === 'all' || i.status === A.filter).sort(A.filter === 'done' ? (a, b) => Date.parse(b.completedAt || 0) - Date.parse(a.completedAt || 0) : sortOpen);
    const filters = [['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([k, label]) => `<button data-action="agent-filter" data-filter="${k}" class="${A.filter === k ? 'active' : ''}" aria-pressed="${A.filter === k}"><span>${label}</span></button>`).join('');
    let body;
    if (!api()) body = `<div class="empty agents-empty"><h3>Agents can’t reach Relay yet.</h3><p>${E(GRANT_HINT)}</p>${window.tabsExtension ? '' : '<p class="agents-preview-note">Previewing in a browser? Add ?agents=demo to the address to try it with demo data.</p>'}</div>`;
    else if (A.status === 'denied') body = `<div class="empty agents-empty"><h3>Agent notebook is off for this project.</h3><p>${E(GRANT_HINT)}</p></div>`;
    else if (!ready) body = '<div class="empty agents-empty"><h3>Looking…</h3></div>';
    else if (!list.length) body = `<div class="empty agents-empty"><h3>${A.filter === 'done' ? 'Nothing finished yet.' : 'Nothing from agents yet.'}</h3><p>Ask Relay to keep a to-do, a reminder or some context, or let your agents add their own.</p>${R.btn(`${I('spark')}Ask Relay`, 'agents-ask', 'button primary')}</div>`;
    else body = `<div class="note-list">${list.map(A.row).join('')}</div>`;
    return `<main class="studio-main agents-main" id="main"><div class="studio-heading"><div><h1>From agents<span>.</span></h1><p>To-dos, reminders and context kept for you and your agents in this project. ${isDemo() ? '<span class="agents-demo">Demo data</span>' : ''}</p></div><div class="heading-actions">${R.btn(`${I('spark')}Ask Relay`, 'agents-ask', 'button primary')}</div></div><section class="collection"><div class="collection-header"><h2>${A.filter === 'done' ? 'Done' : A.filter === 'all' ? 'Everything' : 'Open'}<small>${ready ? list.length : 0}</small></h2><div><div class="view-picker" role="group" aria-label="Show">${filters}</div></div></div>${body}</section></main>`;
  };
  // ---------- Items in All notes and Pinned ----------
  A.inline = () => {
    if (A.status !== 'ready' || R.ui.folder || R.ui.type !== 'all' || !['all', 'saved'].includes(R.ui.scope)) return [];
    const q = (R.ui.query || '').toLowerCase();
    return A.items.filter(i => i.status === 'open' && (R.ui.scope !== 'saved' || i.pinned) && (!q || [i.title, i.body, ...(i.tags || [])].join(' ').toLowerCase().includes(q))).sort(sortOpen);
  };
  const collection = R.collection;
  R.collection = (cards) => {
    const html = collection(cards), rows = A.inline();
    return rows.length ? `<div class="note-list agents-inline" aria-label="Saved with @relay">${rows.map(i => A.row(i).replace('class="note-row agent-row', `class="note-row agent-row${i.id === A.fresh ? ' agent-fresh' : ''}`)).join('')}</div>${html}` : html;
  };
  A.reveal = () => {
    if (!A.fresh) return;
    const el = document.querySelector(`[data-item="${CSS.escape(A.fresh)}"]`);
    if (el) { el.scrollIntoView({ block: 'nearest' }); const id = A.fresh; setTimeout(() => { if (A.fresh === id) A.fresh = ''; document.querySelector(`[data-item="${CSS.escape(id)}"]`)?.classList.remove('agent-fresh'); }, 4000); }
  };
  const studio = R.studio;
  R.studio = () => { const html = studio(); return R.ui.scope === 'agents' ? html.replace(/<main\b[^>]*>[\s\S]*<\/main>/, () => A.main()) : html; };

  const find = id => A.items.find(i => i.id === id);
  A.snooze = (item, until) => A.run([{ op: 'update', id: item.id, dueAt: iso(until), status: 'open' }], 'Snoozed until ' + (RC() ? RC().formatRelayDue(until) : new Date(until).toLocaleString()));
  actions['agent-filter'] = b => { A.filter = b.dataset.filter; A.renderMain(); };
  actions['agent-tick'] = b => { const it = find(b.dataset.id); if (it) A.run([{ op: 'update', id: it.id, status: it.status === 'done' ? 'open' : 'done' }], it.status === 'done' ? 'Back to open' : 'Marked done'); };
  actions['agent-pin'] = b => { const it = find(b.dataset.id); if (it) A.run([{ op: 'update', id: it.id, pinned: !it.pinned }], it.pinned ? 'Unpinned' : 'Pinned'); };
  actions['agent-delete'] = b => { const it = find(b.dataset.id); if (it) A.run([{ op: 'delete', id: it.id }], 'Deleted “' + it.title.slice(0, 40) + '”'); };
  const closeMenu = () => { document.querySelector('.agents-menu')?.remove(); A.menu = null; };
  actions['agent-snooze'] = b => {
    const was = A.menu === b.dataset.id; closeMenu(); if (was) return;
    const it = find(b.dataset.id); if (!it) return;
    const at = (d, h) => { const x = new Date(Date.now() + d * DAY); x.setHours(h, 0, 0, 0); return x.getTime(); };
    const nextMon = () => { const x = new Date(); x.setDate(x.getDate() + ((8 - x.getDay()) % 7 || 7)); x.setHours(9, 0, 0, 0); return x.getTime(); };
    const choices = [['In 1 hour', Date.now() + HOUR], ['This evening', Math.max(at(0, 18), Date.now() + HOUR)], ['Tomorrow 9 am', at(1, 9)], ['Next week', nextMon()]];
    const menu = document.createElement('div'); menu.className = 'agents-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Snooze until');
    choices.forEach(([label, t]) => { const m = document.createElement('button'); m.type = 'button'; m.setAttribute('role', 'menuitem'); m.textContent = label; m.addEventListener('click', e => { e.stopPropagation(); closeMenu(); A.snooze(it, t); }); menu.append(m); });
    b.closest('.agent-row').append(menu); A.menu = it.id; menu.firstElementChild.focus();
  };
  document.addEventListener('click', e => { if (A.menu && !e.target.closest('.agents-menu,[data-action="agent-snooze"]')) closeMenu(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && A.menu) { const id = A.menu; closeMenu(); document.querySelector(`[data-item="${CSS.escape(id)}"] [data-action="agent-snooze"]`)?.focus(); } });

  // ---------- Edit modal ----------
  const timeOptions = (current) => {
    const out = ['<option value="">No time</option>']; const fmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    const slots = new Set(); for (let m = 0; m < 1440; m += 30) slots.add(m); if (current != null) slots.add(current);
    [...slots].sort((a, b) => a - b).forEach(m => { const d = new Date(); d.setHours(Math.floor(m / 60), m % 60, 0, 0); out.push(`<option value="${m}" ${m === current ? 'selected' : ''}>${E(fmt.format(d))}</option>`); });
    return out.join('');
  };
  const pad = n => String(n).padStart(2, '0');
  actions['agent-edit'] = b => {
    const it = find(b.dataset.id); if (!it) return;
    const due = it.dueAt ? new Date(it.dueAt) : null;
    const date = due ? `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}` : '';
    R.showModal(`${R.modalTop('FROM AGENTS')}<h2 id="modal-title">Edit ${E((kindLabel[it.kind] || 'item').toLowerCase())}.</h2>
    <form id="agents-edit-form" class="agents-form" data-id="${E(it.id)}">
      <label class="agents-field"><span>Title</span><input name="title" required maxlength="300" value="${E(it.title)}"></label>
      <label class="agents-field"><span>Details</span><textarea name="body" rows="5">${E(it.body || '')}</textarea></label>
      <div class="agents-form-row"><label class="agents-field"><span>Kind</span><select name="kind" aria-label="Kind">${Object.entries(kindLabel).map(([k, l]) => `<option value="${k}" ${k === it.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="agents-field"><span>Due date</span><input type="date" name="date" aria-label="Due date" value="${date}"></label>
      <label class="agents-field"><span>Time</span><select name="time" aria-label="Due time">${timeOptions(due ? due.getHours() * 60 + due.getMinutes() : null)}</select></label></div>
      <label class="agents-field"><span>Tags <small>comma separated</small></span><input name="tags" value="${E((it.tags || []).join(', '))}"></label>
      <div class="dialog-actions">${R.btn('Save', 'agent-save', 'button primary', 'type="submit"').replace('data-action="agent-save"', '')}${R.btn('Cancel', 'close', 'button secondary')}${R.btn(`${I('trash')}Delete`, 'agent-delete-modal', 'quiet-button', `data-id="${E(it.id)}"`)}</div>
    </form>`, 'agents-edit');
    requestAnimationFrame(() => modalContent.querySelector('[name="title"]')?.focus());
  };
  actions['agent-delete-modal'] = b => { modal.close(); actions['agent-delete'](b); R.render(); };
  document.addEventListener('submit', e => {
    const f = e.target;
    if (f.id === 'agents-edit-form') {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f)); const it = find(f.dataset.id); if (!it) return;
      let dueAt = null;
      if (v.date) { const [y, m, d] = v.date.split('-').map(Number); const mins = v.time === '' || v.time == null ? 9 * 60 : Number(v.time); dueAt = iso(new Date(y, m - 1, d, Math.floor(mins / 60), mins % 60).getTime()); }
      const tags = v.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      modal.close();
      A.run([{ op: 'update', id: it.id, title: v.title.trim() || it.title, body: v.body, kind: v.kind, dueAt, tags }], 'Saved');
      R.render();
    }
    if (f.id === 'agents-ask-form') { e.preventDefault(); A.send(); }
  });

  // ---------- Ask Relay ----------
  const CHIPS = ['Turn next steps into to-dos', 'Fetch the latest GitHub issues into to-dos', 'Tidy finished work', 'Write a context brief for agents'];
  const savedModel = () => { try { return localStorage.getItem(MODEL_KEY) || ''; } catch { return ''; } };
  const currentModel = () => { const list = A.models || []; return list.find(m => m.id === savedModel()) || list[0] || null; };
  const modelPanel = () => {
    const list = A.models || []; const groups = [...new Set(list.map(m => m.group || 'Models'))]; const cur = currentModel();
    return groups.map(g => `<div class="agents-group" role="group" aria-label="${E(g)}"><span class="agents-group-label">${E(g)}</span>${list.filter(m => (m.group || 'Models') === g).map(m => `<button type="button" role="option" class="relay-option agents-option" data-action="agents-model-pick" data-id="${E(m.id)}" aria-selected="${cur?.id === m.id}">${E(m.label)}</button>`).join('')}</div>`).join('');
  };
  const modelPicker = () => {
    const cur = currentModel();
    return `<div class="relay-control agents-model"><span class="agents-label" id="agents-model-label">Model</span><button type="button" class="relay-control-trigger" id="agents-model-trigger" data-action="agents-model-toggle" role="combobox" aria-haspopup="listbox" aria-expanded="${A.modelOpen}" aria-controls="agents-model-panel" aria-labelledby="agents-model-label agents-model-trigger">${E(cur?.label || 'Default model')}</button><div class="relay-control-panel agents-model-panel" id="agents-model-panel" role="listbox" aria-label="Model" ${A.modelOpen && A.models?.length ? '' : 'hidden'}>${modelPanel()}</div></div>`;
  };
  A.hint = () => {
    if (!RC()) return '';
    const text = A.ask.text.trim();
    if (A.ask.force && text) return RC().describeRelayIntent({ type: 'agent', text });
    const intent = RC().parseRelayCommand(text);
    const base = RC().describeRelayIntent(intent);
    return intent.type === 'create' || intent.type === 'complete' ? base + ' · saved instantly' : base;
  };
  const askBody = () => {
    if (!api() || A.status === 'denied') return `<p class="agents-note">${E(GRANT_HINT)}</p>${window.tabsExtension ? '' : '<p class="settings-help">Previewing in a browser? Add ?agents=demo to the address to try it with demo data.</p>'}`;
    return `${isDemo() ? '<span class="agents-demo">Demo data</span>' : ''}${modelPicker()}
    <form id="agents-ask-form" class="agents-form" autocomplete="off">
      <label class="agents-label" for="agents-ask-input">Ask</label>
      <textarea id="agents-ask-input" rows="3" maxlength="2000" placeholder="@relay remind me to call Sam tomorrow at 4" ${A.ask.working ? 'disabled' : ''}>${E(A.ask.text)}</textarea>
      <p class="agents-hint" id="agents-hint" aria-live="polite">${E(A.hint())}</p>
      <div class="agents-suggestions" role="group" aria-label="Suggestions">${CHIPS.map(c => `<button type="button" class="agents-suggestion" data-action="agents-chip" data-text="${E(c)}">${E(c)}</button>`).join('')}</div>
      <div class="dialog-actions">${R.btn(`${I('arrow')}Send`, 'agents-send', 'button primary', `type="submit" ${A.ask.working ? 'disabled' : ''}`).replace('data-action="agents-send"', '')}</div>
    </form>
    <section class="agents-live" id="agents-live" aria-live="polite" ${A.ask.working ? '' : 'hidden'}></section>`;
  };
  A.openAsk = async () => {
    R.flushInline?.();
    R.showModal(`${R.modalTop('ASK RELAY')}<h2 id="modal-title">What should Relay do?</h2><p class="modal-intro">Keep something quick with <code>@relay</code>, or ask your agent for more.</p><div id="agents-ask-body">${askBody()}</div>`, 'agents-ask');
    A.renderLive(); modalContent.querySelector('#agents-ask-input')?.focus();
    if (api() && !A.models) {
      try { A.models = await api().models(); } catch { A.models = []; }
      if (modal.open && modalKind === 'agents-ask') { const old = modalContent.querySelector('.agents-model'); if (old) old.outerHTML = modelPicker(); }
    }
  };
  actions['agents-ask'] = () => { if (modal.open) modal.close(); A.openAsk(); };
  actions['agents-model-toggle'] = () => {
    A.modelOpen = !A.modelOpen; const old = modalContent.querySelector('.agents-model'); if (old) old.outerHTML = modelPicker();
    if (A.modelOpen) (modalContent.querySelector('.agents-option[aria-selected="true"]') || modalContent.querySelector('.agents-option'))?.focus(); else modalContent.querySelector('#agents-model-trigger')?.focus();
  };
  actions['agents-model-pick'] = b => {
    try { localStorage.setItem(MODEL_KEY, b.dataset.id); } catch { /* remembered only for this session */ }
    A.modelOpen = false; const old = modalContent.querySelector('.agents-model'); if (old) old.outerHTML = modelPicker();
    modalContent.querySelector('#agents-model-trigger')?.focus();
  };
  document.addEventListener('keydown', e => {
    if (!modalContent.contains(e.target)) return;
    if (e.target.closest?.('.agents-model') && A.modelOpen) {
      const opts = [...modalContent.querySelectorAll('.agents-option')], i = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); opts[Math.min(opts.length - 1, i + 1)]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); opts[Math.max(0, i - 1)]?.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); actions['agents-model-toggle'](); }
    } else if (e.target.id === 'agents-model-trigger' && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !A.modelOpen) { e.preventDefault(); actions['agents-model-toggle'](); }
    if (e.target.id === 'agents-ask-input' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); A.send(); }
  }, true);
  document.addEventListener('input', e => {
    if (e.target.id !== 'agents-ask-input') return;
    A.ask.text = e.target.value; if (A.ask.force && A.ask.text !== A.ask.forced) A.ask.force = false;
    const hint = modalContent.querySelector('#agents-hint'); if (hint) hint.textContent = A.hint();
  });
  actions['agents-chip'] = b => {
    A.ask.text = b.dataset.text; A.ask.forced = b.dataset.text; A.ask.force = true;
    const input = modalContent.querySelector('#agents-ask-input'); input.value = A.ask.text; input.focus();
    modalContent.querySelector('#agents-hint').textContent = A.hint();
  };
  const bestMatch = query => {
    const q = query.toLowerCase(); const open = openItems().filter(i => i.title.toLowerCase().includes(q));
    return open.sort((a, b) => (a.title.toLowerCase() === q ? -1 : 0) - (b.title.toLowerCase() === q ? -1 : 0) || a.title.length - b.title.length)[0];
  };
  A.send = async () => {
    const text = A.ask.text.trim(); if (!text || A.busy || A.ask.working) return; if (!api() || !RC()) return;
    const intent = A.ask.force ? { type: 'agent', text } : RC().parseRelayCommand(text);
    if (intent.type === 'empty') return;
    A.busy = true;
    try {
      if (intent.type === 'create') {
        const op = { op: 'create', kind: intent.kind, title: intent.title };
        if (intent.tags.length) op.tags = [...intent.tags];
        if (intent.due != null) op.dueAt = iso(intent.due);
        A.ask.text = ''; A.ask.force = false; modal.close(); R.render();
        await A.run([op], `${kindLabel[intent.kind]} kept${intent.due != null ? ' · ' + RC().formatRelayDue(intent.due) : ''}`);
      } else if (intent.type === 'complete') {
        const match = bestMatch(intent.query);
        if (!match) { A.toast(`Couldn’t find an open item matching “${intent.query}”.`); return; }
        A.ask.text = ''; modal.close(); R.render();
        await A.run([{ op: 'update', id: match.id, status: 'done' }], `Marked “${match.title.slice(0, 40)}” done`);
      } else {
        A.ask.working = true; A.ask.since = Date.now();
        const model = currentModel(); const btn = modalContent.querySelector('#agents-ask-input'), go = modalContent.querySelector('.agents-form [type="submit"]'); if (btn) btn.disabled = true; if (go) go.disabled = true;
        try { const res = await api().delegate(model ? { text, model: model.selection } : { text }); A.ask.threadId = res?.threadId || ''; }
        catch { A.ask.working = false; if (btn) btn.disabled = false; if (go) go.disabled = false; A.toast('Couldn’t start that in Tabs. Try again.'); return; }
        modalContent.querySelector('#agents-live').hidden = false; A.renderLive(); A.startLive();
      }
    } finally { A.busy = false; }
  };
  let liveTimer = 0;
  A.startLive = () => { clearInterval(liveTimer); const stop = Date.now() + 120000; liveTimer = setInterval(() => { if (!A.ask.working || Date.now() > stop) { clearInterval(liveTimer); return; } A.refresh(); }, 2000); };
  A.renderLive = () => {
    const box = modalContent.querySelector('#agents-live'); if (!box || !A.ask.working) return;
    const arrived = A.items.filter(i => i.author === 'agent' && Date.parse(i.createdAt) >= A.ask.since - 2000).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    box.innerHTML = `<div class="agents-live-head"><span class="agents-pulse" aria-hidden="true"></span><strong>Working on it in Tabs…</strong></div>${arrived.length ? `<ul class="agents-live-list">${arrived.map(i => `<li><span class="note-row-icon">${glyph(i.kind)}</span><span>${E(i.title)}</span><span class="agent-chip agent-mark">${I('spark')}Agent</span></li>`).join('')}</ul>` : '<p class="settings-help">New items will appear here as your agent adds them.</p>'}<div class="dialog-actions">${R.btn('See all in From agents', 'agents-open-list', 'button secondary')}${R.btn('Ask something else', 'agents-reset', 'quiet-button')}</div>`;
  };
  actions['agents-open-list'] = () => { modal.close(); R.ui.scope = 'agents'; R.ui.folder = ''; R.ui.selected = ''; A.filter = 'open'; R.render(); };
  actions['agents-reset'] = () => { A.ask = { text: '', force: false, working: false, since: 0, threadId: '' }; clearInterval(liveTimer); A.openAsk(); };
  modal.addEventListener('close', () => { A.modelOpen = false; });

  // ---------- Share with agents ----------
  const shareBody = card => {
    const fields = R.template(card.template)?.fields || [];
    const lines = fields.map(f => { const v = R.value(card, f.id); return v === '' || v === false || v == null ? '' : `${f.label}: ${v === true ? 'Yes' : Array.isArray(v) ? v.join(', ') : v}`; }).filter(Boolean);
    return [card.body || '', lines.join('\n')].filter(Boolean).join('\n\n');
  };
  const sharePayload = card => ({ title: card.title || 'Untitled note', body: shareBody(card), tags: [...(card.tags || [])] });
  const sharedItem = id => A.items.find(i => i.externalKey === noteKey(id));
  const shareControls = card => {
    const shared = sharedItem(card.id);
    return shared ? `<span class="agents-shared">${R.btn(`${I('share')}Shared with agents ✓`, 'agents-shared-info', 'quiet-button', 'aria-pressed="true"')}${R.btn('Stop sharing', 'agents-unshare', 'quiet-button', `data-id="${E(card.id)}"`)}</span>` : R.btn(`${I('share')}Share with agents`, 'agents-share', 'quiet-button', `data-id="${E(card.id)}"`);
  };
  const noteContents = R.noteContents;
  R.noteContents = (c, ...args) => { const html = noteContents(c, ...args); return args[0] ? html : html.replace(/(<div class="reading-bottom">[\s\S]*?)(<\/div>)/, (m, a, b) => a + `<span class="agents-share-slot" data-share-for="${E(c.id)}">${shareControls(c)}</span>` + b); };
  A.refreshShare = () => { const slot = modalContent.querySelector('.agents-share-slot'); const card = slot && R.card(slot.dataset.shareFor); if (card) slot.innerHTML = shareControls(card); };
  actions['agents-share'] = async b => {
    const card = R.card(b.dataset.id); if (!card) return;
    if (!api() || A.status === 'denied') { A.toast(GRANT_HINT, [], 9000); return; }
    const existing = sharedItem(card.id), payload = sharePayload(card);
    const op = existing ? { op: 'update', id: existing.id, ...payload } : { op: 'create', kind: 'context', ...payload, externalKey: noteKey(card.id) };
    const applied = await A.run([op], null); if (applied) A.refreshShare();
  };
  actions['agents-unshare'] = async b => {
    const existing = sharedItem(b.dataset.id); if (!existing) return;
    const applied = await A.run([{ op: 'delete', id: existing.id }], null); if (applied) A.refreshShare();
  };
  actions['agents-shared-info'] = () => {};
  let syncTimer = 0;
  A.syncShared = () => {
    for (const item of A.items) {
      if (!item.externalKey?.startsWith(SHARE_PREFIX)) continue;
      const card = R.card(item.externalKey.slice(SHARE_PREFIX.length)); if (!card) continue;
      const p = sharePayload(card);
      if (p.title === item.title && p.body === (item.body || '') && JSON.stringify(p.tags) === JSON.stringify(item.tags || [])) continue;
      A.run([{ op: 'update', id: item.id, ...p }], null);
    }
  };
  const save = R.save;
  R.save = function () { const ok = save.apply(this, arguments); if (ok && api() && A.status === 'ready') { clearTimeout(syncTimer); syncTimer = setTimeout(A.syncShared, 700); } return ok; };

  // ---------- Start ----------
  if (api()) A.refresh(); else A.changed();
  R.render();
})();

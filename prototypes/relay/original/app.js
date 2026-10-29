const $ = (selector) => document.querySelector(selector);
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const seed = {
  projects: ['Tabs', 'Personal site', 'Side experiments'],
  cards: [
    { id: 'tabs-1', project: 'Tabs', type: 'Feature', title: 'Give every project a place to pick up.', tried: 'Mapped out the handoff card flow. Keeping the latest context tied to a project feels right — the next step should be the first thing you see when you return.', next: 'Build the empty state for a project’s first handoff. Make it feel like an invitation, not another task.', blocked: 'Deciding when a gentle save reminder should appear.', branch: 'feature/project-handoffs', files: ['src/views/ProjectHome.tsx:48', 'src/components/HandoffCard.tsx'], saved: true, created: Date.now() - 12 * 60000 },
    { id: 'site-1', project: 'Personal site', type: 'Bug', title: 'The mobile nav has a mind of its own.', tried: 'The menu stays open after following an anchor. Tried closing on route change, but same-page links never trigger it.', next: 'Close the menu on anchor selection, then check keyboard focus returns to the toggle.', blocked: '', branch: 'fix/mobile-navigation', files: ['src/components/Nav.tsx:86'], saved: false, created: Date.now() - 95 * 60000 },
    { id: 'labs-1', project: 'Side experiments', type: 'Exploration', title: 'What if bookmarks felt more like a shelf?', tried: 'Sketched a few arrangements. A loose grid feels more personal than a table, but long titles need some breathing room.', next: 'Try three card sizes with real, messy bookmark titles before choosing a layout.', blocked: '', branch: 'explore/bookmark-shelf', files: ['sketches/shelf.html'], saved: true, created: Date.now() - 4 * 3600000 },
    { id: 'tabs-2', project: 'Tabs', type: 'Feature', title: 'A quieter command palette.', tried: 'Grouped the results by intent. Recent actions stay on top, and less-used commands move into a secondary group.', next: 'Add the recent-actions group and give the empty search a helpful starting point.', blocked: '', branch: 'feature/command-palette', files: ['src/components/CommandPalette.tsx:32'], saved: false, created: Date.now() - 22 * 3600000 },
    { id: 'tabs-3', project: 'Tabs', type: 'Bug', title: 'Track down the disappearing sidebar width.', tried: 'The width is written correctly, but the initial render replaces it before the saved value finishes loading.', next: 'Read the persisted width before applying the default. Keep the minimum width at 180px.', blocked: 'Need a reliable sequence that reproduces the race.', branch: 'fix/sidebar-persistence', files: ['src/layout/Sidebar.tsx:71'], saved: false, created: Date.now() - 27 * 3600000 },
    { id: 'site-2', project: 'Personal site', type: 'Feature', title: 'Make room for the little things I build.', tried: 'Collected screenshots and short descriptions for three side projects. The small experiments deserve a home too.', next: 'Draft a compact “on the side” section below selected work.', blocked: '', branch: 'feature/side-projects', files: ['src/pages/index.astro'], saved: false, created: Date.now() - 49 * 3600000 }
  ]
};
let data;
try {
  const stored = JSON.parse(localStorage.getItem('relay-prototype-v1'));
  const valid = stored && Array.isArray(stored.projects) && stored.projects.every((p) => typeof p === 'string') && Array.isArray(stored.cards) && stored.cards.every((c) => c && typeof c.id === 'string' && typeof c.title === 'string' && typeof c.project === 'string' && typeof c.type === 'string' && typeof c.created === 'number' && Array.isArray(c.files));
  data = valid ? stored : structuredClone(seed);
} catch { data = structuredClone(seed); }
let view = 'overview';
let project = null;
let filter = 'all';
let search = '';
let editingId = null;
let toastTimer;
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4200);
}
function persist() {
  try { localStorage.setItem('relay-prototype-v1', JSON.stringify(data)); return true; }
  catch { toast('Browser storage is unavailable. Your changes will last for this session.'); return false; }
}
function age(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
function bookmark(c) {
  return `<button class="bookmark-button ${c.saved ? 'bookmarked' : ''}" data-bookmark="${escapeHTML(c.id)}" aria-label="${c.saved ? 'Remove bookmark' : 'Bookmark handoff'}" aria-pressed="${Boolean(c.saved)}">${icon('mark')}</button>`;
}
function top(c, branch = false) {
  return `<div class="card-top"><span class="project-icon">${escapeHTML(c.project[0])}</span><span>${escapeHTML(c.project)}</span>${branch ? `<span class="divider">/</span><span class="branch-label">${icon('branch')}${escapeHTML(c.branch || 'No branch linked')}</span>` : ''}${bookmark(c)}</div>`;
}
function notes(c) {
  return `<div class="note-block"><div class="note-label">${icon('clock')} LAST THING TRIED</div><p>${escapeHTML(c.tried || 'No previous attempt recorded yet.')}</p></div><div class="note-block next-step"><div class="note-label">${icon('arrow')} NEXT STEP</div><p>${escapeHTML(c.next)}</p></div>${c.blocked ? `<div class="blocked-note"><span></span><strong>One thing to untangle</strong><span>${escapeHTML(c.blocked)}</span></div>` : ''}<div class="file-chips">${c.files.map((file, index) => `<button class="file-chip" data-file="${escapeHTML(c.id)}" data-index="${index}">${icon('file')}${escapeHTML(file)}</button>`).join('')}</div>`;
}
function featured(c) {
  return `<article class="featured-card">${top(c, true)}<div class="featured-body"><div class="card-label-row"><span class="type-pill ${escapeHTML(c.type)}">${escapeHTML(c.type)}</span><span class="subtle-text">Left ${age(c.created)}</span></div><h2>${escapeHTML(c.title)}</h2>${notes(c)}</div><div class="featured-footer"><span class="saved-note">${icon('check')} A little context, safely kept.</span><button class="button primary" data-open="${escapeHTML(c.id)}">Pick up here ${icon('arrow')}</button></div></article>`;
}
function render() {
  const sorted = [...data.cards].sort((a, b) => b.created - a.created);
  let selected = sorted.filter((c) => (!project || c.project === project) && (view !== 'saved' || c.saved));
  const label = project || (view === 'history' ? 'All handoffs' : view === 'saved' ? 'Bookmarked' : 'Overview');
  $('#breadcrumb').textContent = label;
  $('#total-count').textContent = data.cards.length;
  $('#bookmark-count').textContent = data.cards.filter((c) => c.saved).length;
  $('#filter-count').textContent = selected.length;
  $('#projects').innerHTML = data.projects.map((p) => `<button class="project-button ${project === p ? 'selected' : ''}" data-project="${escapeHTML(p)}"><span class="project-dot"></span>${escapeHTML(p)}<span>${data.cards.filter((c) => c.project === p).length}</span></button>`).join('');
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', !project && button.dataset.view === view));
  const showOverview = view === 'overview';
  $('#overview').classList.toggle('hidden', !showOverview);
  $('.section-title').classList.toggle('hidden', !showOverview);
  $('#main-heading').textContent = project ? `Pick up in ${project}` : 'Pick up the thread';
  $('#featured').innerHTML = selected.length ? featured(selected[0]) : `<div class="empty-state">Every good project starts with a thread.<button data-create>Leave your first handoff →</button></div>`;
  $('#history-heading').textContent = project ? `${project} handoffs` : view === 'saved' ? 'Kept for later' : view === 'history' ? 'All your threads' : 'A few open threads';
  $('#history-subtitle').textContent = view === 'saved' ? 'The context you wanted to keep close.' : project ? 'A small history of what you’ve been thinking.' : 'Different projects. One place to remember.';
  if (showOverview && selected.length && !search && filter === 'all') selected = selected.slice(1);
  selected = selected.filter((c) => (filter === 'all' || c.type === filter) && [c.title, c.project, c.tried, c.next, c.blocked, c.branch, ...c.files].join(' ').toLowerCase().includes(search.toLowerCase()));
  $('#cards').innerHTML = selected.length ? selected.map((c) => `<article class="thread-card">${top(c)}<button class="card-content-button" data-open="${escapeHTML(c.id)}"><h3>${escapeHTML(c.title)}</h3><p>${escapeHTML(c.next)}</p></button><div class="thread-footer"><span class="type-pill ${escapeHTML(c.type)}">${escapeHTML(c.type)}</span><span>${age(c.created)}</span>${icon('arrow')}</div></article>`).join('') : `<div class="empty-state">${search ? 'No threads match that search. Try another word.' : view === 'saved' ? 'Bookmark a handoff to keep it close.' : 'A little breathing room. No more threads here yet.'}<button data-create>Leave a handoff →</button></div>`;
}
function openEditor(c = null) {
  editingId = c?.id || null;
  const form = $('#card-form');
  form.reset();
  $('#project-select').innerHTML = data.projects.map((p) => `<option>${escapeHTML(p)}</option>`).join('');
  $('#editor-title').textContent = c ? 'Keep the thread going.' : 'Leave a little context.';
  if (c) {
    ['title', 'project', 'type', 'tried', 'next', 'blocked', 'branch'].forEach((key) => { form.elements[key].value = c[key] || ''; });
    form.elements.files.value = c.files.join(', ');
  } else { form.elements.project.value = project || data.projects[0]; }
  $('#editor').showModal();
}
function openCard(id) {
  const c = data.cards.find((item) => item.id === id);
  if (!c) return;
  $('#detail-content').innerHTML = `<div class="dialog-heading"><span class="eyebrow">WELCOME BACK TO YOUR TRAIN OF THOUGHT</span><button class="close-button" data-close aria-label="Close">×</button></div>${top(c, true)}<h2>${escapeHTML(c.title)}</h2>${notes(c)}<div class="dialog-footer"><span>Saved ${age(c.created)} · ${escapeHTML(c.type)}</span><button class="button primary" data-edit="${escapeHTML(c.id)}">Update this handoff ${icon('arrow')}</button></div>`;
  $('#detail').showModal();
}
document.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.hasAttribute('data-close')) target.closest('dialog').close();
  if (target.hasAttribute('data-create')) openEditor();
  if (target.dataset.view) { view = target.dataset.view; project = null; filter = 'all'; search = ''; $('#search').value = ''; resetFilters(); render(); }
  if (target.dataset.project) { project = target.dataset.project; view = 'overview'; filter = 'all'; search = ''; $('#search').value = ''; resetFilters(); render(); }
  if (target.dataset.filter) { filter = target.dataset.filter; resetFilters(); render(); }
  if (target.dataset.open) openCard(target.dataset.open);
  if (target.dataset.edit) { const c = data.cards.find((item) => item.id === target.dataset.edit); $('#detail').close(); openEditor(c); }
  if (target.dataset.bookmark) {
    const c = data.cards.find((item) => item.id === target.dataset.bookmark);
    c.saved = !c.saved;
    persist(); render();
    target.classList.toggle('bookmarked', c.saved);
    target.setAttribute('aria-pressed', String(c.saved));
    target.setAttribute('aria-label', c.saved ? 'Remove bookmark' : 'Bookmark handoff');
  }
  if (target.dataset.file) {
    const c = data.cards.find((item) => item.id === target.dataset.file);
    toast(`Reference: ${c.files[Number(target.dataset.index)]}. Opening editor files comes with the extension.`);
  }
});
function resetFilters() { document.querySelectorAll('[data-filter]').forEach((button) => button.classList.toggle('active', button.dataset.filter === filter)); }
$('#new-card').addEventListener('click', () => openEditor());
$('#ritual-new').addEventListener('click', () => openEditor());
$('#search').addEventListener('input', (event) => { search = event.target.value; render(); });
$('#card-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  values.title = values.title.trim(); values.next = values.next.trim();
  if (!values.title || !values.next) { toast('Give this thread a name and one concrete next step.'); return; }
  values.files = values.files.split(',').map((s) => s.trim()).filter(Boolean);
  const previous = data.cards.find((c) => c.id === editingId);
  const c = { ...values, id: editingId || crypto.randomUUID(), saved: previous?.saved || false, created: Date.now() };
  if (editingId) data.cards = data.cards.filter((item) => item.id !== editingId);
  data.cards.unshift(c);
  const stored = persist();
  $('#editor').close(); view = 'overview'; project = c.project; search = ''; filter = 'all'; $('#search').value = ''; resetFilters(); render();
  if (stored) toast('Context kept. Your future self says thanks.');
});
$('#add-project').addEventListener('click', () => { $('#project-form').reset(); $('#project-dialog').showModal(); });
$('#project-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = String(new FormData(event.currentTarget).get('name')).trim();
  if (!name) return;
  if (data.projects.some((p) => p.toLowerCase() === name.toLowerCase())) { toast('That project already has a place here.'); return; }
  data.projects.push(name); persist(); project = name; view = 'overview'; search = ''; filter = 'all'; $('#search').value = ''; resetFilters(); render(); $('#project-dialog').close();
});
$('#how-it-works').addEventListener('click', () => {
  $('#detail-content').innerHTML = `<div class="dialog-heading"><span class="eyebrow">THE THINKING BEHIND THE THREAD</span><button class="close-button" data-close aria-label="Close">×</button></div><h2>Keep the reasoning.<br>Make returning easier.</h2><div class="research-copy"><p>Relay is a small handoff from present you to future you. Capture the goal, the last attempt, the next action, and anything blocking you.</p><h3>Why this direction?</h3><p><a href="https://www.microsoft.com/en-us/research/?p=159976" target="_blank" rel="noopener noreferrer">Research from Parnin and DeLine</a> found developers rely heavily on notes and preferred chronological code cues for resuming interrupted tasks. Our design hypothesis: a concise note paired with relevant files can make the return less disorienting.</p><h3>Projects, then threads.</h3><p>Start with one project per workspace. Use Bug, Feature, and Exploration labels to organize the work. Deeper folders can wait until real usage shows a need.</p><h3>A tiny ritual.</h3><p>Before you switch away, leave one concrete next step. On return, the latest handoff is waiting. Previous attempts remain in the history.</p><h3>What this prototype does</h3><p>Create and update handoffs, switch projects, search, filter, and bookmark. Changes are saved in this browser. The initial cards are illustrative examples. External fonts load from Google Fonts; otherwise the page uses system fonts.</p><h3>What comes with the extension</h3><p>Workspace and branch detection, opening referenced files at a line, and a gentle save prompt. Editor integration is not connected in this HTML concept.</p><p>Original conversations: <a href="https://www.reddit.com/r/vscode/comments/1pp05qq/anyone_else_lose_their_entire_mental_context/" target="_blank" rel="noopener noreferrer">Reddit</a> · <a href="https://news.ycombinator.com/item?id=9895713" target="_blank" rel="noopener noreferrer">Hacker News</a>.</p></div>`;
  $('#detail').showModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); $('#search').focus(); }
});
render();

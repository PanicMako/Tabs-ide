/** Pure, reversible folder operations shared by the prototype and packaged tool. */
export function subtreeIds(state, rootId) {
  const root = state.folders.find(folder => folder.id === rootId);
  if (!root) throw new Error('This folder no longer exists.');
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

export function trashFolder(state, rootId, makeId = () => crypto.randomUUID(), now = Date.now()) {
  const ids = subtreeIds(state, rootId);
  const folder = state.folders.find(folder => folder.id === rootId);
  const entry = {
    id: makeId(), deletedAt: now, project: folder.project, rootId,
    folders: structuredClone(state.folders.filter(item => item.project === folder.project && ids.has(item.id))),
    cards: structuredClone(state.cards.filter(note => note.project === folder.project && ids.has(note.folder))),
  };
  state.trash ||= [];
  state.trash.unshift(entry);
  state.folders = state.folders.filter(item => !entry.folders.some(removed => removed.id === item.id));
  state.cards = state.cards.filter(note => !entry.cards.some(removed => removed.id === note.id));
  // The older one-folder undo must never resurrect a partial deleted tree.
  if (state.folderUndo && (ids.has(state.folderUndo.folder.id) || ids.has(state.folderUndo.folder.parent) || state.folderUndo.children.some(id => ids.has(id)))) delete state.folderUndo;
  return entry;
}

export function restoreFolder(state, entryId, makeId = () => crypto.randomUUID()) {
  const entry = state.trash?.find(item => item.id === entryId);
  if (!entry) throw new Error('This item is no longer in Trash.');
  const project = state.projects.includes(entry.project) ? entry.project : state.projects[0];
  if (!project) throw new Error('Create a project before restoring this folder.');
  const folderIds = new Set(state.folders.map(item => item.id));
  const mapping = new Map(entry.folders.map(item => [item.id, folderIds.has(item.id) ? makeId() : item.id]));
  const folders = structuredClone(entry.folders);
  for (const folder of folders) {
    const originalId = folder.id;
    folder.project = project;
    folder.id = mapping.get(originalId);
    folder.parent = mapping.get(folder.parent) || (state.folders.some(item => item.id === folder.parent && item.project === project) ? folder.parent : '');
    if (originalId === entry.rootId) {
      const base = folder.name;
      let index = 1;
      while (state.folders.some(item => item.project === project && item.parent === folder.parent && item.name.toLowerCase() === folder.name.toLowerCase())) folder.name = `${base} (restored${index++ === 1 ? '' : ' '+(index-1)})`;
    }
  }
  const noteIds = new Set(state.cards.map(item => item.id));
  const cards = structuredClone(entry.cards);
  for (const note of cards) {
    if (noteIds.has(note.id)) note.id = makeId();
    note.project = project;
    note.folder = mapping.get(note.folder) || '';
    if (!state.columns.some(column => column.id === note.status)) note.status = state.columns[0].id;
    if (!state.templates.some(template => template.id === note.template)) note.template = state.templates[0].id;
  }
  state.folders.push(...folders);
  state.cards.push(...cards);
  state.trash = state.trash.filter(item => item.id !== entryId);
  return { project, folder: mapping.get(entry.rootId), notes: cards.length };
}

export function validProjectLogo(value) {
  return typeof value === 'string' && value.length <= 350000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value);
}

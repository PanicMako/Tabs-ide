import { subtreeIds, trashFolder, restoreFolder, validProjectLogo } from './operations.mjs';

// Commit destructive changes only after a successful durable write.
R.commitChange = operation => {
  const before = structuredClone(R.data);
  try {
    const result = operation();
    if (!R.save()) { R.data = before; R.refreshStatuses(); R.render(); R.toast('Nothing was deleted. Storage could not save this change.'); return null; }
    return { result };
  } catch (error) { R.data = before; R.refreshStatuses(); R.render(); R.toast(error.message || 'Could not save this change.'); return null; }
};
R.deleteFolder = id => {
  const folder = R.folder(id); if (!folder) return;
  const ids = subtreeIds(R.data, id), notes = R.data.cards.filter(note => note.project === folder.project && ids.has(note.folder)).length;
  const directNotes = R.data.cards.filter(note => note.folder === id).length, directFolders = R.data.folders.filter(item => item.parent === id).length;
  R.showModal(`${R.modalTop('CHOOSE WHAT GOES WITH IT')}<h2 id="modal-title">Delete “${E(folder.name)}”?</h2><p class="modal-intro">Keep what’s inside, or clear out the whole folder in one go.</p><div class="delete-options"><section><span class="delete-option-icon">${I('folder')}</span><div><h3>Only the folder</h3><p>Move its ${directNotes} direct ${directNotes===1?'note':'notes'} and ${directFolders} ${directFolders===1?'subfolder':'subfolders'} to ${E(R.folder(folder.parent)?.name||'the project root')}. Keep all their contents.</p>${R.btn('Remove folder, keep contents','confirm-delete-folder','button secondary',`data-id="${E(id)}"`)}</div></section><section class="delete-option-all"><span class="delete-option-icon">${I('trash')}</span><div><h3>Folder + everything inside</h3><p>Move this folder, ${ids.size-1} nested ${ids.size-1===1?'folder':'folders'}, and ${notes} ${notes===1?'note':'notes'} to Trash together. Includes notes you’ve archived.</p><small>You can restore the whole structure from Trash.</small>${R.btn(`Move all ${notes} ${notes===1?'note':'notes'} & folder to Trash`,'trash-folder-tree','button danger',`data-id="${E(id)}"`)}</div></section></div><div class="dialog-actions">${R.btn('Cancel','organize','quiet-button')}</div>`,'folder-delete');
};
actions['delete-folder'] = button => R.deleteFolder(button.dataset.id);
// Upgrade the earlier keep-contents action with atomic persistence.
const keepFolderContents = actions['confirm-delete-folder'];
actions['confirm-delete-folder'] = button => {
  const before = structuredClone(R.data), oldSave = R.save;
  let saved = false;
  R.save = () => { saved = oldSave(); return saved; };
  try { keepFolderContents(button); } finally { R.save = oldSave; }
  if (!saved) { R.data = before; R.render(); R.organize(); R.toast('Nothing was removed. Storage could not save this change.'); }
};
actions['trash-folder-tree'] = button => {
  R.flushInline();
  const root = R.folder(button.dataset.id); if (!root) return;
  const parent = root.parent;
  const change = R.commitChange(() => trashFolder(R.data, root.id)); if (!change) return;
  const entry = change.result;
  for (const note of entry.cards) { try { localStorage.removeItem('relay-studio-draft:'+note.id); } catch {} }
  if (entry.folders.some(folder => folder.id === R.ui.folder)) R.ui.folder = parent;
  R.ui.selected = ''; R.render(); R.openTrash(); R.toast('Folder and contents moved to Trash together.');
};
R.openTrash = () => {
  const entries = (R.data.trash || []).filter(entry => entry.project === R.ui.project || !R.data.projects.includes(entry.project));
  R.showModal(`${R.modalTop('A LITTLE ROOM TO CHANGE YOUR MIND')}<h2 id="modal-title">Trash.</h2><p class="modal-intro">Deleted folders stay here with their notes and nested structure until you delete them permanently.</p><div class="trash-list">${entries.length?entries.map(entry=>`<article><div class="trash-title">${I('folder')}<div><h3>${E(entry.folders.find(folder=>folder.id===entry.rootId)?.name||'Deleted folder')}</h3><p>${entry.cards.length} ${entry.cards.length===1?'note':'notes'} · ${entry.folders.length} ${entry.folders.length===1?'folder':'folders'} · ${R.age(entry.deletedAt)}</p></div></div><div class="trash-actions">${R.btn(`${I('restore')}Restore all`,'restore-folder-tree','button secondary',`data-id="${E(entry.id)}"`)}${R.btn('Delete permanently…','delete-trash-entry','danger-link',`data-id="${E(entry.id)}"`)}</div></article>`).join(''):'<div class="settings-empty">Nothing in Trash. A little breathing room.</div>'}</div><p class="settings-help">Trash stays on this device and is included in full backups.</p>`,'trash');
};
actions.trash = R.openTrash;
actions['restore-folder-tree'] = button => {
  const change = R.commitChange(() => restoreFolder(R.data, button.dataset.id)); if (!change) return;
  R.ui.project = change.result.project; R.ui.folder = change.result.folder; R.ui.scope = 'all'; R.ui.query = ''; R.ui.view = ''; R.ui.selected = '';
  R.data.prefs.organization[R.ui.project] = 'folders'; R.save(); modal.close(); R.render(); R.toast('The folder, its notes, and all subfolders are back.');
};
actions['delete-trash-entry'] = button => {
  const entry = R.data.trash?.find(item=>item.id===button.dataset.id); if (!entry) return;
  R.showModal(`${R.modalTop('THIS CANNOT BE UNDONE')}<h2 id="modal-title">Delete permanently?</h2><p class="modal-intro">Remove ${entry.folders.length} ${entry.folders.length===1?'folder':'folders'} and ${entry.cards.length} ${entry.cards.length===1?'note':'notes'} from Trash. You’ll need a previously saved backup to bring them back.</p><div class="dialog-actions">${R.btn('Keep in Trash','trash','button secondary')}${R.btn('Delete permanently','confirm-delete-trash','button danger',`data-id="${E(entry.id)}"`)}</div>`,'permanent-delete');
};
actions['confirm-delete-trash'] = async button => {
  const entry = R.data.trash?.find(item=>item.id===button.dataset.id); if (!entry) return;
  const change = R.commitChange(() => { R.data.trash = R.data.trash.filter(item=>item.id!==entry.id); return entry; }); if (!change) return;
  // Remove only file payloads no longer referenced by any active or trashed note.
  const drafts = []; try { for (let i=0;i<localStorage.length;i++) { const key=localStorage.key(i); if (key?.startsWith('relay-studio-draft:')) { const draft=R.read(key); if (draft?.attachments) drafts.push(draft); } } } catch {}
  const retained = new Set([...R.data.cards,...(R.data.trash||[]).flatMap(item=>item.cards),...drafts].flatMap(note=>(note.attachments||[]).map(file=>file.id)));
  await R.filesReady;
  if (R.fileDatabase) { try { const tx=R.fileDatabase.transaction('files','readwrite'); for(const note of entry.cards)for(const file of note.attachments||[])if(!retained.has(file.id))tx.objectStore('files').delete(file.id); } catch { /* Unreferenced payloads can be reclaimed later. */ } }
  R.render(); R.openTrash(); R.toast('Deleted permanently from this workspace.');
};
const sidebarWithOrganization = R.sidebar;
R.sidebar = () => sidebarWithOrganization().replace('<div class="sidebar-bottom">',`<button class="side-add trash-nav" data-action="trash">${I('trash')}Trash <small>${(R.data.trash||[]).filter(entry=>entry.project===R.ui.project||!R.data.projects.includes(entry.project)).length||''}</small></button><div class="sidebar-bottom">`);

// Uploaded logos live with project metadata. No remote image service is contacted.
const monogram = R.projectMark;
R.projectMark = project => { const logo = R.data.projectDetails[project]?.logo; return validProjectLogo(logo)?`<span class="project-initial project-logo"><img src="${E(logo)}" alt="" loading="lazy"></span>`:monogram(project); };
R.projectSelect = () => `<div class="project-picker"><button data-action="project-switcher" class="project-switcher-button" aria-label="Switch project: ${E(R.ui.project)}">${R.projectMark(R.ui.project)}<span>${E(R.ui.project)}</span>${I('down')}</button></div>`;
R.openProjects = () => R.showModal(`${R.modalTop('YOUR PLACES TO KEEP GOING')}<h2 id="modal-title">Pick a project.</h2><div class="project-menu">${R.data.projects.map(project=>`<div><button data-action="choose-project" data-project="${E(project)}" aria-current="${project===R.ui.project?'true':'false'}">${R.projectMark(project)}<span><strong>${E(project)}</strong><small>${R.data.cards.filter(note=>note.project===project&&!note.archived).length} notes</small></span>${project===R.ui.project?I('check'):I('arrow')}</button>${R.btn(I('edit'),'edit-project-logo','icon-button',`data-project="${E(project)}" aria-label="Edit ${E(project)} name and logo"`)}</div>`).join('')}</div>${R.btn(`${I('plus')}New project`,'new-project','button secondary')}`,'project-switcher');
const projectHeader = R.header;
R.header = () => projectHeader().replace(`<button data-action="root">${E(R.ui.project)}</button>`, `<button class="header-project" data-action="project-switcher" aria-label="Switch project: ${E(R.ui.project)}">${R.projectMark(R.ui.project)}<span>${E(R.ui.project)}</span>${I('down')}</button>`);
actions['project-switcher'] = R.openProjects;
actions['choose-project'] = button => { modal.close(); R.setProject(button.dataset.project); };
actions['edit-project-logo'] = button => { R.setProject(button.dataset.project); R.projectForm(false); };
const projectFormWithoutLogo = R.projectForm;
R.projectForm = create => {
  projectFormWithoutLogo(create);
  const form = document.querySelector('#project-form'), logo = !create&&validProjectLogo(R.data.projectDetails[R.ui.project]?.logo)?R.data.projectDetails[R.ui.project].logo:'';
  const actionsRow = form.querySelector('.dialog-actions');
  actionsRow.insertAdjacentHTML('beforebegin',`<input type="hidden" name="logo" value="${E(logo)}"><input type="hidden" name="originalProject" value="${E(create?'':R.ui.project)}"><div class="project-logo-editor"><div id="project-logo-preview">${logo?`<img src="${E(logo)}" alt="Current project logo">`:I('grid')}</div><div><strong>A face for this project</strong><p>PNG, JPG or WebP. Stored on this device.</p>${R.btn(`${I('plus')}Choose logo`,'choose-project-logo','button secondary','type="button"')}<input type="file" id="project-logo-file" accept="image/png,image/jpeg,image/webp" hidden>${R.btn('Use initials','remove-project-logo','quiet-button','type="button"')}</div></div><p class="logo-status" id="logo-status" role="status"></p>`);
};
actions['choose-project-logo'] = () => document.querySelector('#project-logo-file')?.click();
actions['remove-project-logo'] = () => { const form=document.querySelector('#project-form'); if(!form)return; form.elements.logo.value=''; document.querySelector('#project-logo-preview').innerHTML=I('grid'); document.querySelector('#logo-status').textContent='Initials will be used when you save.'; };
document.addEventListener('change',async event=>{
  if(event.target.id!=='project-logo-file')return;
  const file=event.target.files[0], form=event.target.closest('form'), status=form.querySelector('#logo-status'); if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024){status.textContent='Choose a PNG, JPG or WebP smaller than 5 MB.';return;}
  const submit=form.querySelector('[type=submit]');submit.disabled=true;status.textContent='Preparing your logo…';
  try {
    const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    const image=new Image(); image.src=src; await image.decode();
    if(!image.width||!image.height)throw Error('Invalid image');
    const canvas=document.createElement('canvas');const scale=Math.min(1,256/image.width,256/image.height);canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    const logo=canvas.toDataURL('image/png');if(!validProjectLogo(logo))throw Error('Image too large');
    if(!form.isConnected)return;
    form.elements.logo.value=logo;form.querySelector('#project-logo-preview').innerHTML=`<img src="${E(logo)}" alt="Your chosen project logo">`;status.textContent='Ready. Save the project to keep this logo.';
  } catch { if(form.isConnected)status.textContent='Could not read this image. Try a different PNG or JPG.'; }
  finally {if(form.isConnected)submit.disabled=false;}
});
document.addEventListener('submit',event=>{
  const form=event.target;if(form.id!=='project-form')return;
  const old=form.elements.originalProject?.value,name=form.elements.name.value.trim();
  if(old&&old!==name&&R.ui.project===name&&R.data.projects.includes(name)){
    for(const entry of R.data.trash||[])if(entry.project===old){entry.project=name;entry.folders.forEach(folder=>folder.project=name);entry.cards.forEach(note=>note.project=name);}
    if(R.data.prefs.organization?.[old]){R.data.prefs.organization[name]=R.data.prefs.organization[old];delete R.data.prefs.organization[old];}
    if(R.data.folderUndo?.folder.project===old)R.data.folderUndo.folder.project=name;
    R.save();
  }
});
// Backups include attachment payloads in Trash as well as visible notes.
R.exportBackup=async()=>{R.flushInline();await R.filesReady;const notes=[...R.data.cards,...(R.data.trash||[]).flatMap(entry=>entry.cards)],ids=new Set(notes.flatMap(note=>(note.attachments||[]).map(file=>file.id))),files={};for(const id of ids){const file=await R.getFile(id);if(file)files[id]=file;}R.download(JSON.stringify({format:'relay-studio-v3',version:3,state:R.data,files},null,2),'relay-my-workspace.json','application/json');};
actions['export-json']=R.exportBackup;
const validWithoutTrash=R.validStudio;
R.validStudio=state=>validWithoutTrash(state)&&(!state.trash||(Array.isArray(state.trash)&&state.trash.every(entry=>entry&&typeof entry.id==='string'&&typeof entry.project==='string'&&Number.isFinite(entry.deletedAt)&&typeof entry.rootId==='string'&&Array.isArray(entry.folders)&&entry.folders.length>0&&entry.folders.some(folder=>folder.id===entry.rootId)&&Array.isArray(entry.cards)&&entry.cards.every(note=>note&&typeof note.status==='string'&&typeof note.template==='string')&&validWithoutTrash({...state,folders:entry.folders.map(folder=>({...folder,parent:entry.folders.some(item=>item.id===folder.parent)?folder.parent:''})),cards:entry.cards.map(note=>({...note,status:state.columns.some(column=>column.id===note.status)?note.status:state.columns[0].id,template:state.templates.some(template=>template.id===note.template)?note.template:state.templates[0].id})),projects:[...new Set([...state.projects,entry.project])]}))));
R.render();

// Imported attachments receive fresh IDs, so a failed import cannot overwrite
// payloads belonging to the notebook already on disk.
actions['confirm-import'] = async () => {
  const pending=R.pendingImport;if(!pending)return;
  R.pendingImport=null;
  const original=R.data, incoming=structuredClone(pending.state), added=[];
  incoming.prefs.organization ||= {}; incoming.trash ||= [];
  if(incoming.folderUndo&&(!incoming.folderUndo.folder||!Array.isArray(incoming.folderUndo.notes)||!Array.isArray(incoming.folderUndo.children)))delete incoming.folderUndo;
  const notes=[...incoming.cards,...incoming.trash.flatMap(entry=>entry.cards)], wanted=new Set(notes.flatMap(note=>note.attachments.map(file=>file.id)));
  await R.filesReady;
  if(wanted.size&&!R.fileDatabase){R.toast('File storage is unavailable. Your current notebook is unchanged.');R.pendingImport=pending;return;}
  try{
    const ids=new Map();
    for(const id of wanted){const file=pending.files[id];if(!file)throw Error('The backup is missing an attachment.');const replacement=crypto.randomUUID();await R.putFile({...file,id:replacement});ids.set(id,replacement);added.push(replacement);}
    for(const note of notes)for(const file of note.attachments)file.id=ids.get(file.id)||file.id;
    R.data=incoming;
    if(!R.save())throw Error('Not enough local storage.');
  }catch{
    R.data=original;
    if(R.fileDatabase&&added.length){try{const tx=R.fileDatabase.transaction('files','readwrite');for(const id of added)tx.objectStore('files').delete(id);}catch{}}
    R.toast('The backup could not be saved. Your current notebook is unchanged.');R.pendingImport=pending;return;
  }
  R.refreshStatuses();Object.assign(R.ui,{project:incoming.projects[0],folder:'',query:'',scope:'all',selected:'',view:'',collapsed:new Set()});modal.close();R.render();R.toast('Your notebook is back, including Trash and attachments.');
};

R.render();

// Keep navigation predictable: choose a project, then browse its notes and folders.
R.openProjects=()=>{
 R.showModal(`${R.modalTop('PROJECTS')}<h2 id="modal-title">Switch project</h2><label class="picker-search">${I('search')}<input data-picker-search="projects" aria-label="Find a project" placeholder="Find a project…" autocomplete="off"></label><div class="project-menu simple-project-menu">${R.data.projects.map(project=>`<div data-picker-row="${E(project.toLowerCase())}"><button data-action="choose-project" data-project="${E(project)}" aria-current="${project===R.ui.project?'true':'false'}">${R.projectMark(project)}<span><strong>${E(project)}</strong><small>${R.data.cards.filter(note=>note.project===project&&!note.archived).length} notes</small></span>${project===R.ui.project?I('check'):''}</button>${R.btn(I('edit'),'edit-project-logo','icon-button',`data-project="${E(project)}" aria-label="Edit ${E(project)}"`)}</div>`).join('')}</div><p class="picker-no-results" hidden>No projects found.</p><div class="picker-footer">${R.btn(`${I('plus')}New project`,'new-project','button secondary')}</div>`,'project-switcher');
 document.querySelector('[data-picker-search]')?.focus();
};
actions['project-switcher']=()=>R.openProjects();
document.addEventListener('input',event=>{const input=event.target;if(!input.hasAttribute('data-picker-search'))return;const query=input.value.trim().toLowerCase();let visible=0;modalContent.querySelectorAll('[data-picker-row]').forEach(row=>{row.hidden=!row.dataset.pickerRow.includes(query);if(!row.hidden)visible++;});const empty=modalContent.querySelector('.picker-no-results');if(empty)empty.hidden=visible>0;});

const simpleSettingSections=[['feel','settings','General','Theme, spacing and note defaults'],['templates','file','Templates','Optional fields for your notes'],['board','board','Board','Column names, colors and order'],['data','export','Backup & data','Export and restore your notebook']];
R.customize=(tab='feel',fromEditor=false)=>{
 if(fromEditor||modalKind==='editor')R.persistEditorBeforeSettings();
 settingsTab=simpleSettingSections.some(([key])=>key===tab)?tab:'feel';
 const current=simpleSettingSections.find(([key])=>key===settingsTab);
 R.showModal(`<div class="settings-shell">${R.btn(I('close'),'close','settings-shell-close icon-button','aria-label="Close settings"')}<div class="settings-shell-body"><nav class="settings-nav" aria-label="Settings categories"><h2 id="modal-title">Settings</h2>${simpleSettingSections.map(([key,icon,label])=>`<button data-settings-tab="${key}" class="${key===settingsTab?'active':''}" ${key===settingsTab?'aria-current="page"':''}>${I(icon)}${label}</button>`).join('')}</nav><section class="settings-panel" data-settings-page="${settingsTab}" aria-label="${current[2]}"><header><span class="settings-page-icon">${I(current[1])}</span><h3>${current[2]}</h3><p>${current[3]}</p><small>${settingsTab==='board'?'Edit a column, then confirm your changes.':settingsTab==='data'?'A copy for your next chapter.':'Your preferences save automatically.'}</small></header>${{feel:R.feelSettings,templates:R.templateSettings,board:R.boardSettings,data:R.dataSettings}[settingsTab]()}</section></div></div>`,'settings');
 modalContent.querySelector('[data-settings-tab="'+settingsTab+'"]')?.focus();
};
actions.customize=b=>R.customize(b.dataset.tab||'feel',!!b.dataset.fromEditor);

// Show only the name up front; personality and preferences remain optional.
const simpleProjectForm=R.projectForm;
R.projectForm=create=>{
 simpleProjectForm(create);
 const form=document.querySelector('#project-form');
 modalContent.querySelector('#modal-title').textContent=create?'New project':'Project settings';
 modalContent.querySelector('.modal-top .eyebrow').textContent='PROJECT';
 const name=form.elements.name;name.closest('label').firstChild.textContent='Project name';name.placeholder='e.g. Website redesign';
 const extras=document.createElement('details');extras.className='project-optional';extras.innerHTML='<summary>Description, color & logo <small>Optional</small></summary>';
 const actionsRow=form.querySelector('.dialog-actions');form.insertBefore(extras,actionsRow);
 for(const el of [form.elements.description.closest('label'),form.elements.color.closest('label'),form.querySelector('.project-logo-editor'),form.querySelector('#logo-status')])if(el)extras.append(el);
 form.elements.description.closest('label').firstChild.textContent='Description';
 const submit=actionsRow.querySelector('[type="submit"]');submit.textContent=create?'Create project':'Save changes';
 name.focus();
};
const simpleFolderForm=R.folderForm;
R.folderForm=id=>{
 simpleFolderForm(id);
 const form=document.querySelector('#folder-form');
 modalContent.querySelector('#modal-title').textContent=id?'Folder settings':'New folder';
 modalContent.querySelector('.modal-top .eyebrow').textContent='FOLDER';
 modalContent.querySelector('.modal-intro').textContent=id?'Update the name or location.':'A name is all you need.';
 const extras=form.querySelector('.folder-extras');extras.open=false;extras.querySelector('summary').innerHTML=`More options ${I('down')}`;
 const personality=form.querySelector('.folder-personality');extras.append(personality);
 form.querySelector('#folder-name').placeholder='Folder name';
};
R.folderCards=()=>!R.usesFolders()||!R.childFolders().length?'':`<section class="folder-section illustrated-folders"><div class="section-line"><h2>Folders</h2>${R.btn(`${I('plus')}New folder`,'new-folder','quiet-button')}</div><div class="folder-cards">${R.childFolders().map((f,index)=>`<article class="illustrated-folder folder-variant-${index%3}">${R.btn(I('settings'),'folder-options','folder-card-settings icon-button',`data-id="${E(f.id)}" aria-label="Folder settings: ${E(f.name)}"`)}<button class="illustrated-folder-open" data-folder="${E(f.id)}"><svg class="folder-art" aria-hidden="true" viewBox="0 0 120 86"><path class="folder-art-back" d="M19 27V17a5 5 0 0 1 5-5h26l10 10h35a5 5 0 0 1 5 5v42H19z"/><path class="folder-art-paper" d="M34 14h40l11 11v41H34z"/><path class="folder-art-line" d="M43 29h22m-22 9h30m-30 9h17"/><path class="folder-art-front" d="M17 35h86l-8 39H24z"/><path class="folder-art-stitch" d="M39 53h35"/></svg><h3>${E(f.name)}</h3><div><span>${R.folderCount(f.id)} ${R.folderCount(f.id)===1?'note':'notes'}</span>${I('arrow')}</div></button></article>`).join('')}</div></section>`;
const simpleSidebar=R.sidebar;
R.sidebar=()=>simpleSidebar().replace('Templates & settings','Settings').replace('Find a thought','Search notes').replace('A notebook without the filing.','').replace('Add folders whenever you like','Add folders').replace('data-action="organize">Add folders','data-action="new-folder">Add folders').replace(/<button class="side-add" data-action="new-folder">[\s\S]*?<\/button>/,'').replace('Organize folders','Manage folders');
const simpleStudio=R.studio;
R.studio=()=>simpleStudio().replace('<span class="eyebrow">A PLACE TO KEEP GOING</span>','').replace(`<div class="heading-art" aria-hidden="true">${R.illustration(R.mode)}</div>`,'').replace(R.btn('Make this space yours ↗','customize','quiet-button'),'').replace(R.btn(`${I('settings')}Organize`,'organize','button secondary'),R.btn(`${I('folder')}New folder`,'new-folder','button secondary')).replace('Make a little progress. Leave a little context.','');
R.collectionHeader=()=>`<div class="collection-header"><h2>Notes <small>${R.cards().length}</small></h2><div>${R.ui.folder?`<label class="nested-choice"><input type="checkbox" data-nested ${R.ui.includeNested?'checked':''}>Include subfolders</label>`:''}${R.viewPicker()}${R.view()==='board'?R.btn(I('settings'),'customize','icon-button','data-tab="board" aria-label="Board settings"'):''}</div></div>`;
R.browseFolders=()=>{
 R.showModal(`${R.modalTop('FOLDERS')}<h2 id="modal-title">Open a folder</h2><label class="picker-search">${I('search')}<input data-picker-search="folders" aria-label="Find a folder" placeholder="Find a folder…"></label><div class="simple-folder-picker">${R.btn(`${I('grid')}All notes`,'browse-root','picker-root')}${R.data.folders.filter(f=>f.project===R.ui.project).map(f=>`<button data-browse-folder="${E(f.id)}" data-picker-row="${E(R.folderLabel(f.id).toLowerCase())}">${I('folder')}<span>${E(f.name)}<small>${E(R.folder(f.parent)?.name||R.ui.project)}</small></span><small>${R.folderCount(f.id)}</small></button>`).join('')}</div><p class="picker-no-results" hidden>No folders found.</p><div class="picker-footer">${R.btn(`${I('plus')}New folder`,'new-folder','button secondary')}</div>`,'folders');document.querySelector('[data-picker-search]')?.focus();
};
R.render();

actions['browse-folders']=()=>R.browseFolders();

if(R.openLocation)actions['move-note']=button=>{const note=R.card(button.dataset.id);if(!note)return;relayLocationContext={kind:'note',id:note.id};returnToEditor=false;R.openLocation(note.project,note.folder);};

const quietNoteContents=R.noteContents;
R.noteContents=(note,...args)=>{let html=quietNoteContents(note,...args);if(!note.history.length)html=html.replace(/<details class="earlier-thoughts">[\s\S]*?<\/details>/,'');return html;};

const focusedStudio=R.studio;
R.studio=()=>{let html=focusedStudio();if(R.usesFolders()&&R.childFolders().length&&!R.ui.folder)html=html.replace(R.btn(`${I('folder')}New folder`,'new-folder','button secondary'),'');return html;};

// Destructive template controls also ask before applying a change.
let pendingSettingsDeletion=null;
for(const [action,title,description] of [['remove-field','Delete this field?','The field will be removed from this template. Existing answers will stay with your notes.']]){
 const apply=actions[action];
 actions[action]=button=>{pendingSettingsDeletion=()=>apply({dataset:{...button.dataset}});R.showModal(`${R.modalTop('CONFIRM DELETION').replace('data-action="close"','data-action="cancel-settings-delete"')}<div class="confirm-symbol">${I('trash')}</div><h2 id="modal-title">${title}</h2><p class="modal-intro">${description}</p><div class="dialog-actions">${R.btn('Cancel','cancel-settings-delete','button secondary')}${R.btn('Delete','confirm-settings-delete','button danger')}</div>`,'settings-delete');};
}
actions['cancel-settings-delete']=()=>{pendingSettingsDeletion=null;R.customize('templates');};
actions['confirm-settings-delete']=()=>{const apply=pendingSettingsDeletion;pendingSettingsDeletion=null;apply?.();};

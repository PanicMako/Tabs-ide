const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const modalContent = document.querySelector('#modal-content');
let modalKind = '', modalCard = '', organizeTab = 'project', editingId = null, dragId = '', toastTimeout;
R.toast = message => { const el=document.querySelector('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.remove('visible'),4300); };
R.showModal = (html,kind='info') => {modalKind=kind;modalContent.innerHTML=html;if(!modal.open)modal.showModal();modal.scrollTop=0;};
R.modalTop = label => `<div class="modal-top"><span class="eyebrow">${label}</span>${R.btn(I('close'),'close','icon-btn','aria-label="Close dialog"')}</div>`;
R.openReader = id => {const c=R.card(id);if(!c)return;modalCard=id;R.showModal(`${R.modalTop('YOUR CONTEXT, RIGHT HERE')}${R.detail(c)}`,'reader');};
R.refreshReader = () => {if(modal.open&&modalKind==='reader')R.openReader(modalCard);};
R.folderOptions = (project,selected='') => `<option value="">Unfiled — no folder needed</option>${R.data.folders.filter(f=>f.project===project).map(f=>`<option value="${E(f.id)}" ${selected===f.id?'selected':''}>${E(f.name)}</option>`).join('')}`;
R.openEditor = (id=null,newStatus='ready') => {
 const c=id?R.card(id):null;editingId=c?.id||null;
 const draftKey='relay-draft-v2:'+(editingId||'new');
 const draft=R.read(draftKey);const hasDraft=draft&&typeof draft.title==='string'&&typeof draft.next==='string';
 const values=hasDraft?draft:c?{...c,files:c.files.join('\n')}: {title:'',project:R.ui.project||R.data.projects[0],folder:R.ui.folder||'',type:R.ui.type==='all'?'Feature':R.ui.type,status:newStatus,tried:'',next:'',blocked:'',branch:'',files:'',links:''};
 if(!R.data.projects.includes(values.project))values.project=R.data.projects[0];
 if(!R.data.folders.some(f=>f.id===values.folder&&f.project===values.project))values.folder='';
 R.showModal(`${R.modalTop(c?'KEEP THE THREAD GOING':'A NOTE TO YOUR FUTURE SELF')}<h2 id="modal-title">${c?'Leave a checkpoint.':'Where should you pick up?'}</h2><p class="modal-intro">${c?'Your previous reasoning stays in the checkpoint history.':'The next action is enough. Add the rest when it helps.'}</p>${hasDraft?'<div class="draft-banner">Your unfinished draft is here. Keep going where you left off.</div>':''}<form id="handoff-form" data-draft-key="${draftKey}"><div class="template-row"><span>START WITH</span>${['Feature','Bug','Exploration'].map(t=>`<button type="button" data-template="${t}" class="${values.type===t?'active':''}">${t==='Bug'?'Bug investigation':t==='Feature'?'Feature handoff':'An open question'}</button>`).join('')}</div><label><span class="label-line">Working on <small>Give the thread a clear name</small></span><input name="title" required maxlength="180" placeholder="What were you in the middle of?" value="${E(values.title)}"></label><div class="form-grid"><label>Project<select name="project" data-editor-project>${R.projectOptions(values.project,false)}</select></label><label>Folder <span class="sr-only">optional</span><select name="folder" id="editor-folder">${R.folderOptions(values.project,values.folder)}</select></label></div><label><span class="label-line">Last thing tried <small>optional</small></span><textarea name="tried" rows="3" placeholder="What did you try? What did you learn or rule out?">${E(values.tried)}</textarea></label><label><span class="label-line">Next step <small>One concrete place to start</small></span><textarea name="next" rows="2" required placeholder="When I come back, the first thing I’ll do is…">${E(values.next)}</textarea></label><label><span class="label-line">Blocked by <small>optional</small></span><input name="blocked" placeholder="A question, a missing piece, or someone you’re waiting on" value="${E(values.blocked)}"></label><details class="form-disclosure" ${values.branch||values.files||values.links?'open':''}><summary>${I('link')}Add code context & links</summary><div><label>Branch reference<input name="branch" value="${E(values.branch)}" placeholder="feature/project-handoffs"></label><label>File references<small>One per line. Add :42 for a line number.</small><textarea name="files" rows="2" placeholder="src/components/Sidebar.tsx:42">${E(values.files)}</textarea></label><label>Useful links<small>One HTTP or HTTPS link per line.</small><textarea name="links" rows="2" placeholder="https://github.com/your-project/issues/42">${E(values.links)}</textarea></label></div></details><div class="form-grid"><label>Type<select name="type" data-editor-type>${['Feature','Bug','Exploration'].map(t=>`<option ${values.type===t?'selected':''}>${t}</option>`).join('')}</select></label><label>Status<select name="status">${Object.entries(R.statuses).map(([k,v])=>`<option value="${k}" ${values.status===k?'selected':''}>${v}</option>`).join('')}</select></label></div><div class="editor-footer"><span id="draft-status">Drafts save in this browser as you type.</span><div>${R.btn('Discard draft','discard-draft','text-btn','type="button"')}<button type="submit" class="btn primary">${c?'Save checkpoint':'Save handoff'} ${I('arrow')}</button></div></div></form>`,'editor');
};
R.saveDraft = form => {const values=Object.fromEntries(new FormData(form));const stored=R.storage(form.dataset.draftKey,values);const status=document.querySelector('#draft-status');if(status)status.textContent=stored?'Draft saved locally.':'Draft kept for this session only.';};
R.clearDraft = key => {try{localStorage.removeItem(key);}catch{}};
R.organize = (tab='project',renameId=null) => {
 organizeTab=tab;const project=R.ui.project||R.data.projects[0],folder=R.data.folders.find(f=>f.id===renameId);
 R.showModal(`${R.modalTop('JUST ENOUGH ORGANIZATION')}<h2 id="modal-title">A place for your thinking.</h2><p class="modal-intro">Projects hold the work. Optional folders keep related threads together.</p><div class="organize-tabs"><button data-organize-tab="project" class="${tab==='project'?'active':''}">New project</button><button data-organize-tab="folder" class="${tab==='folder'?'active':''}">New folder</button></div><form id="organize-form" data-tab="${tab}" ${folder?`data-rename="${E(folder.id)}"`:''}>${tab==='folder'?`<label>Project<select name="project" ${folder?'disabled':''}>${R.projectOptions(folder?.project||project,false)}</select></label>`:''}<label>${folder?'Rename folder':tab==='folder'?'Folder name':'Project name'}<input name="name" required maxlength="60" placeholder="${tab==='folder'?'e.g. Authentication, UI polish, Bug investigations':'e.g. Personal site'}" value="${E(folder?.name||'')}"></label><div class="editor-footer"><span>Folders are optional. Unfiled threads are always welcome.</span><button class="btn primary" type="submit">${folder?'Save name':tab==='folder'?'Create folder':'Create project'} ${I('arrow')}</button></div></form>${R.data.folders.length?`<div class="existing-folders"><span>EXISTING FOLDERS</span>${R.data.folders.map(f=>`<div>${I('folder')}<span>${E(f.project)} / ${E(f.name)}</span>${R.btn('Rename','rename-folder','text-btn',`data-id="${E(f.id)}"`)}</div>`).join('')}</div>`:''}`,'organize');
};
R.backup = () => R.showModal(`${R.modalTop('YOUR NOTES SHOULD BE YOURS')}<h2 id="modal-title">Take your context with you.</h2><p class="modal-intro">All five prototypes share the same browser data. Export a copy whenever you like.</p><div class="backup-options"><div class="backup-option">${I('export')}<div><strong>Workspace backup</strong><p>Projects, folders, handoffs, and checkpoint history as JSON.</p></div>${R.btn('Export JSON','export-json','btn primary')}</div><div class="backup-option">${I('file')}<div><strong>A readable notebook</strong><p>Every handoff and earlier checkpoint in one Markdown file.</p></div>${R.btn('Export Markdown','export-all-md','btn subtle')}</div><div class="backup-option">${I('restore')}<div><strong>Restore a Relay backup</strong><p>Review the file before replacing this browser’s workspace.</p></div>${R.btn('Choose a file','import-json','btn subtle')}</div></div><div class="research-copy"><p>Browser storage belongs to this browser and page origin. Clearing site data removes it. This prototype does not sync across devices.</p></div>`,'backup');
R.compare = () => R.showModal(`${R.modalTop('FIVE DIFFERENT WAYS IN')}<h2 id="modal-title">Find your way back.</h2><p class="modal-intro">One workspace, five interaction models. Your edits carry across all five.</p>${R.modes.map((m,i)=>`<button class="compare-option" data-mode="${i+1}"><span>0${i+1}</span><div><strong>${m.name}</strong><p>${['A project home built around your latest handoff. Best when you want a reassuring overview and a visible next step.','A three-pane tool: folder tree, searchable index, and reading pane. Best when you switch between many threads.','A spatial board with movable cards and explicit states. Best when your first question is “what’s moving or blocked?”','A chronological notebook with earlier reasoning and file references. Best when the sequence of attempts matters.','One selected handoff and a short return ritual. Best when the rest of your workspace feels too busy.'][i]}</p></div>${I('arrow')}</button>`).join('')}<div class="research-copy"><p>These are design hypotheses to compare, rather than five validated solutions. The numbered bar is an exploration control for this prototype.</p></div>`,'compare');
R.research = () => R.showModal(`${R.modalTop('RESEARCH → PRODUCT DECISIONS')}<h2 id="modal-title">Keep the why. Find the next step.</h2><p class="modal-intro">A small personal tool for returning to interrupted development work.</p><div class="research-copy"><p>The recurring need is to recover intent, previous attempts, and the next action alongside relevant code. Community examples range from a notes.txt per project to notebooks, TODO comments, and searchable task lists.</p><table class="research-table"><thead><tr><th>Need observed</th><th>Prototype decision</th></tr></thead><tbody><tr><td>“Why was I doing this?”</td><td>Four prompts that preserve reasoning, with the next action made prominent.</td></tr><tr><td>Notes scattered across projects</td><td>Project → optional folder → handoff. Global search includes paths and notes.</td></tr><tr><td>Forgetting what already failed</td><td>Saving a checkpoint preserves earlier attempts in a chronological history.</td></tr><tr><td>Finding the code again</td><td>Branch, file:line, and URL references. Actual editor navigation is future work.</td></tr><tr><td>Too much organization becomes work</td><td>Only the title and next step are required. Folders and other prompts stay optional.</td></tr><tr><td>Ownership and portability</td><td>Browser persistence, Markdown export, JSON backup and reviewed restore.</td></tr></tbody></table><h3>Where this comes from</h3><p>The <a href="https://www.reddit.com/r/vscode/comments/1pp05qq/anyone_else_lose_their_entire_mental_context/" target="_blank" rel="noopener noreferrer">original VS Code discussion</a> describes reasoning loss, scratchpads, TODO lists, and code-linked context. The <a href="https://news.ycombinator.com/item?id=9895713" target="_blank" rel="noopener noreferrer">Hacker News conversation</a> includes per-project logs, searchable text, and concern about over-structuring.</p><p>A <a href="https://www.reddit.com/r/webdev/comments/1e59w2a/just_me_how_do_you_remind_yourself_where_you_left/" target="_blank" rel="noopener noreferrer">webdev discussion</a> includes inline TODOs, project lists, and comment anchors. In a <a href="https://www.reddit.com/r/ExperiencedDevs/comments/1jzo7d3/" target="_blank" rel="noopener noreferrer">debugging discussion</a>, developers describe taking notes to track call paths and avoid repeating approaches.</p><p><a href="https://www.microsoft.com/en-us/research/publication/evaluating-cues-for-resuming-interrupted-programming-tasks/" target="_blank" rel="noopener noreferrer">Parnin and DeLine’s CHI study</a> supports pairing written notes with contextual cues and reports a preference for chronological code snippets. It does not validate Relay or establish an expected time saving.</p><h3>What I’d keep in the first product</h3><p>A very fast leave/resume loop, workspace identity, an optional folder, saved drafts, previous attempts, search, and open-file references. Let the user capture a next action without filling out a form first.</p><h3>What belongs after a design is chosen</h3><p>Host integration, automatic project and branch detection, opening files at a line, opt-in reminders, and the choice of private workspace storage versus intentionally shared files. This page does not connect to an editor or automatically inspect your code.</p><h3>What remains uncertain</h3><p>The best default layout, whether folders help in everyday use, capture frequency, and how often reminders become annoying. Comments provide qualitative examples, not a representative survey or proof of demand.</p><p>All initial handoffs describe fictional work. External fonts are optional; your notes stay in this browser unless you export them.</p></div>`,'research');
R.switchMode = mode => {
 const number=Number(mode);if(!Number.isInteger(number)||number<1||number>5)return;
 if(modal.open&&modalKind==='editor'){const form=document.querySelector('#handoff-form');if(form)R.saveDraft(form);}
 modal.close();R.mode=number;R.storage('relay-selected-prototype',number);R.ui.focusStarted=false;
 const url=new URL(location.href);url.searchParams.set('v',number);history.replaceState(null,'',url);R.render();window.scrollTo({top:0,behavior:'instant'});
};
R.setScope = (scope,clearProject=true) => {R.ui.scope=scope;if(clearProject){R.ui.project='';R.ui.folder='';}R.ui.selected='';R.ui.focusStarted=false;R.render();};
R.setProject = project => {R.ui.project=project;R.ui.folder='';R.ui.selected='';R.ui.focusStarted=false;R.ui.scope='all';R.render();};
R.setFolder = id => {const f=R.data.folders.find(f=>f.id===id);if(!f)return;R.ui.project=f.project;R.ui.folder=f.id;R.ui.scope='all';R.ui.selected='';R.ui.focusStarted=false;R.render();};
const actions = {
 home:()=>{R.ui={scope:'all',project:'',folder:'',query:'',type:'all',selected:'',focusStarted:false};R.render();},
 new:button=>R.openEditor(null,button.dataset.newStatus||'ready'),
 open:button=>R.openReader(button.dataset.id),
 edit:button=>R.openEditor(button.dataset.id),
 close:()=>modal.close(),
 organize:()=>R.organize(R.ui.project?'folder':'project'),
 'rename-folder':button=>R.organize('folder',button.dataset.id),
 research:R.research,compare:R.compare,backup:R.backup,
 'all-projects':()=>R.setProject(''),
 'clear-folder':()=>{R.ui.folder='';R.render();},
 'journal-all':()=>R.setScope('all',false),
 'journal-saved':()=>R.setScope('saved',false),
 'journal-archive':()=>R.setScope('archive',false),
 search:()=>document.querySelector('[data-search]')?.focus(),
 'start-focus':button=>{const c=R.card(button.dataset.id);if(c.archived){R.toast('Restore this archived thread before starting it.');return;}R.ui.focusStarted=true;R.ui.selected=c.id;if(c.status==='ready')R.mutate(c.id,{status:'in-progress'},'Started a work session');else R.render();},
 'discard-draft':()=>{const form=document.querySelector('#handoff-form');R.clearDraft(form.dataset.draftKey);modal.close();R.toast('Draft discarded. Saved handoffs are unchanged.');},
 'archive-card':button=>{const c=R.card(button.dataset.id);const archived=!c.archived;R.mutate(c.id,{archived},archived?'Archived thread':'Restored thread');modal.close();R.toast(archived?'Thread archived. Find it in Archive whenever you need it.':'Thread restored to your active workspace.');},
 'export-card':button=>{const c=R.card(button.dataset.id);R.download(R.markdown(c),'relay-'+c.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60)+'.md','text/markdown');},
 'export-json':()=>R.download(JSON.stringify(R.data,null,2),'relay-workspace-'+R.date(Date.now(),{year:'numeric',month:'2-digit',day:'2-digit'}).replaceAll('/','-')+'.json','application/json'),
 'export-all-md':()=>R.download('# Relay workspace\n\n'+R.all().map(c=>R.markdown(c)).join('\n\n---\n\n'),'relay-workspace.md','text/markdown'),
 'import-json':()=>{const input=document.querySelector('#backup-input');input.value='';input.click();},
 'copy-reference':async()=>{const path=document.querySelector('#reference-value').value;try{await navigator.clipboard.writeText(path);R.toast('File reference copied.');}catch{document.querySelector('#reference-value').select();R.toast('Reference selected. Press your copy shortcut.');}},
 'confirm-import':()=>{if(!R.pendingImport)return;R.data=R.normalize(R.pendingImport);R.pendingImport=null;R.ui={scope:'all',project:'',folder:'',query:'',type:'all',selected:'',focusStarted:false};const persisted=R.save();R.render();modal.close();if(persisted)R.toast('Workspace restored. All five prototypes now use these notes.');},
 'download-before-import':()=>actions['export-json']()
};
document.addEventListener('click', event => {
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.mode){R.switchMode(button.dataset.mode);return;}
 if(button.dataset.action){event.preventDefault();actions[button.dataset.action]?.(button);return;}
 if(button.dataset.scope){R.setScope(button.dataset.scope);return;}
 if(button.dataset.boardScope){R.setScope(button.dataset.boardScope,false);return;}
 if(button.dataset.project){R.setProject(button.dataset.project);return;}
 if(button.dataset.folder){R.setFolder(button.dataset.folder);return;}
 if(button.dataset.type){R.ui.type=button.dataset.type;R.ui.selected='';R.render();return;}
 if(button.dataset.open){R.openReader(button.dataset.open);return;}
 if(button.dataset.select){R.ui.selected=button.dataset.select;R.ui.focusStarted=false;R.render();if(R.mode===2&&innerWidth<=520)document.querySelector('.index-reader').scrollIntoView({behavior:'smooth',block:'start'});return;}
 if(button.dataset.bookmark){const c=R.card(button.dataset.bookmark);c.saved=!c.saved;R.save();R.render();R.refreshReader();return;}
 if(button.dataset.organizeTab){R.organize(button.dataset.organizeTab);return;}
 if(button.dataset.template){
  const type=button.dataset.template,form=document.querySelector('#handoff-form');form.elements.type.value=type;
  document.querySelectorAll('[data-template]').forEach(b=>b.classList.toggle('active',b.dataset.template===type));
  form.elements.title.placeholder=type==='Bug'?'What’s happening that shouldn’t?':type==='Exploration'?'What question are you exploring?':'What were you building?';
  form.elements.tried.placeholder=type==='Bug'?'What did you reproduce, try, or rule out?':type==='Exploration'?'What have you noticed? What are the tradeoffs?':'What did you try? What did you learn?';R.saveDraft(form);return;
 }
 if(button.dataset.reference){const path=button.dataset.reference;R.showModal(`${R.modalTop('SAVED CODE CONTEXT')}<h2 id="modal-title">A breadcrumb back to the code.</h2><div class="reference-path">${E(path)}</div><p class="modal-intro">This is a saved file reference. The HTML prototype cannot navigate your editor. Copy the path for now; opening files at a line is part of the later extension.</p><input id="reference-value" readonly aria-label="File reference" value="${E(path)}"><div class="modal-actions">${R.btn(`${I('copy')}Copy reference`,'copy-reference','btn primary')}</div>`,'reference');}
});
document.addEventListener('input',event=>{
 if(event.target.hasAttribute('data-search')){R.ui.query=event.target.value;R.ui.selected='';R.render();}
 const form=event.target.closest('#handoff-form');if(form)R.saveDraft(form);
});
document.addEventListener('change',event=>{
 const el=event.target;
 if(el.hasAttribute('data-project-select'))R.setProject(el.value);
 if(el.hasAttribute('data-folder-select')){if(el.value)R.setFolder(el.value);else{R.ui.folder='';R.render();}}
 if(el.hasAttribute('data-scope-select'))R.setScope(el.value,false);
 if(el.hasAttribute('data-type-select')){R.ui.type=el.value;R.ui.selected='';R.render();}
 if(el.hasAttribute('data-status-id')){R.mutate(el.dataset.statusId,{status:el.value},'Changed thread status');R.refreshReader();}
 if(el.hasAttribute('data-editor-project')){document.querySelector('#editor-folder').innerHTML=R.folderOptions(el.value);R.saveDraft(el.form);}
 if(el.hasAttribute('data-editor-type')){document.querySelectorAll('[data-template]').forEach(b=>b.classList.toggle('active',b.dataset.template===el.value));R.saveDraft(el.form);}
});
document.addEventListener('submit',event=>{
 if(event.target.id==='handoff-form'){
  event.preventDefault();const form=event.target,values=Object.fromEntries(new FormData(form));
  values.title=values.title.trim();values.next=values.next.trim();if(!values.title||!values.next){R.toast('Give the thread a title and one concrete next action.');return;}
  const links=values.links.split('\n').map(s=>s.trim()).filter(Boolean);const invalid=links.some(url=>{try{return!['https:','http:'].includes(new URL(url).protocol);}catch{return true;}});
  if(invalid){R.toast('Use a complete HTTP or HTTPS address for each useful link.');form.elements.links.focus();return;}
  values.links=links.join('\n');values.files=values.files.split(/[\n,]/).map(s=>s.trim()).filter(Boolean);values.tried=values.tried.trim();values.blocked=values.blocked.trim();values.branch=values.branch.trim();
  const previous=editingId?R.card(editingId):null;
  if(previous){R.snapshot(previous,'Saved a checkpoint');Object.assign(previous,values,{updated:Date.now()});}else{R.data.cards.unshift({...values,id:crypto.randomUUID(),created:Date.now(),updated:Date.now(),history:[],saved:false,archived:false});}
  R.clearDraft(form.dataset.draftKey);const persisted=R.save();R.ui.project=values.project;R.ui.folder='';R.ui.scope='all';R.ui.type='all';R.ui.query='';R.ui.selected=previous?.id||R.data.cards[0].id;R.ui.focusStarted=false;modal.close();R.render();if(persisted)R.toast(previous?'Checkpoint saved. Earlier reasoning is kept in the history.':'Handoff saved. You have a place to start next time.');
 }
 if(event.target.id==='organize-form'){
  event.preventDefault();const form=event.target,name=form.elements.name.value.trim();if(!name)return;
  if(form.dataset.tab==='project'){
   if(R.data.projects.some(p=>p.toLowerCase()===name.toLowerCase())){R.toast('There’s already a project with that name.');return;}R.data.projects.push(name);R.ui.project=name;R.ui.folder='';
  }else{
   const project=form.elements.project.value,rename=form.dataset.rename;
   if(R.data.folders.some(f=>f.project===project&&f.name.toLowerCase()===name.toLowerCase()&&f.id!==rename)){R.toast('That project already has a folder with this name.');return;}
   if(rename){const f=R.data.folders.find(f=>f.id===rename);f.name=name;}else{const id=crypto.randomUUID();R.data.folders.push({id,project,name});R.ui.project=project;R.ui.folder=id;}
  }
  const stored=R.save();R.ui.scope='all';R.ui.query='';R.ui.type='all';R.ui.selected='';R.render();modal.close();if(stored)R.toast(form.dataset.rename?'Folder renamed.':form.dataset.tab==='project'?'Project created. Leave its first handoff when you’re ready.':'Folder created. Add a handoff, or move one here in its editor.');
 }
});
modal.addEventListener('cancel',()=>{if(modalKind==='editor'){const form=document.querySelector('#handoff-form');if(form)R.saveDraft(form);}});
document.addEventListener('keydown',event=>{
 const typing=['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName)||event.target.isContentEditable;
 if(typing||event.metaKey||event.ctrlKey||event.altKey)return;
 if(modal.open)return;
 if(event.key==='/'){event.preventDefault();document.querySelector('[data-search]')?.focus();}
 if(event.key.toLowerCase()==='n'){event.preventDefault();R.openEditor();}
 if(/^[1-5]$/.test(event.key)){event.preventDefault();R.switchMode(event.key);}
});
document.addEventListener('dragstart',event=>{const card=event.target.closest('[data-drag-id]');if(!card)return;dragId=card.dataset.dragId;event.dataTransfer.setData('text/plain',dragId);event.dataTransfer.effectAllowed='move';card.classList.add('dragging');});
document.addEventListener('dragover',event=>{const lane=event.target.closest('[data-drop-status]');if(!lane||!dragId)return;event.preventDefault();event.dataTransfer.dropEffect='move';document.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over'));lane.classList.add('drag-over');});
document.addEventListener('drop',event=>{const lane=event.target.closest('[data-drop-status]');if(!lane||!dragId)return;event.preventDefault();const c=R.card(dragId);if(c&&c.status!==lane.dataset.dropStatus)R.mutate(c.id,{status:lane.dataset.dropStatus},'Moved on the board');dragId='';document.querySelectorAll('.drag-over,.dragging').forEach(el=>el.classList.remove('drag-over','dragging'));});
document.addEventListener('dragend',()=>{dragId='';document.querySelectorAll('.drag-over,.dragging').forEach(el=>el.classList.remove('drag-over','dragging'));});
document.querySelector('#backup-input').addEventListener('change',async event=>{
 const file=event.target.files[0];if(!file)return;
 if(file.size>10*1024*1024){R.toast('Choose a Relay JSON backup smaller than 10 MB.');return;}
 try{
  const data=JSON.parse(await file.text());if(!R.valid(data))throw Error('invalid');
  const duplicateIds=new Set(data.cards.map(c=>c.id));if(duplicateIds.size!==data.cards.length||new Set(data.projects).size!==data.projects.length)throw Error('duplicate');
  R.pendingImport=data;
  R.showModal(`${R.modalTop('REVIEW BEFORE RESTORING')}<h2 id="modal-title">Restore this workspace?</h2><p class="modal-intro">${E(file.name)}</p><div class="archive-confirm">${data.projects.length} projects · ${data.folders?.length||0} folders · ${data.cards.length} handoffs</div><div class="research-copy"><p>This replaces the workspace currently saved in this browser, including its history. Download your current backup first if you want to keep both.</p></div><div class="modal-actions">${R.btn('Download current backup','download-before-import','btn subtle')}${R.btn('Restore this backup','confirm-import','btn primary')}</div>`,'import');
 }catch{R.toast('That file isn’t a readable Relay workspace backup. Your current notes are unchanged.');}
});
R.render();

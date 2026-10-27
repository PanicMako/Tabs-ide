/* One location picker for placing drafts and moving saved notes. */
let relayLocationContext=null;
R.locationRows=(project,selected='')=>{
 const option=(folder,label,path)=>`<button class="location-option ${selected===folder?'selected':''}" data-action="location-choose" data-project="${E(project)}" data-folder="${E(folder)}" data-picker-row="${E((label+' '+path).toLowerCase())}">${I(folder?'folder':'file')}<span><strong>${E(label)}</strong><small>${E(path)}</small></span>${selected===folder?I('check'):''}</button>`;
 return option('','No folder','Notes in '+project)+R.data.folders.filter(f=>f.project===project).map(f=>option(f.id,f.name,R.trail(f.id).slice(0,-1).map(p=>p.name).join(' / ')||project)).join('');
};
R.openLocation=(project,folder='')=>{
 if(!R.data.projects.includes(project))return;
 R.showModal(`${R.modalTop('LOCATION').replace('data-action="close"','data-action="location-cancel"')}<h2 id="modal-title">Where should this note go?</h2><p class="location-help">Choose a project, then a folder if you need one.</p><div class="location-picker"><nav class="location-projects" aria-label="Projects">${R.data.projects.map(p=>R.btn(`${R.projectMark(p)}<span>${E(p)}</span>`,'location-project',p===project?'active':'',`data-project="${E(p)}" ${p===project?'aria-current="page"':''}`)).join('')}</nav><section class="location-folders" aria-label="Folders in ${E(project)}"><label class="picker-search">${I('search')}<input data-picker-search="location" aria-label="Find a folder" placeholder="Find a folder…" autocomplete="off"></label><div class="location-options">${R.locationRows(project,folder)}</div><p class="picker-no-results" hidden>No folders found.</p></section></div><div class="picker-footer">${R.btn('Cancel','location-cancel','button secondary')}</div>`,'location');
 document.querySelector('[data-picker-search]')?.focus();
};
actions['note-location']=()=>{R.saveDraft();if(!editorDraft)return;relayLocationContext={kind:'draft',id:editingId};returnToEditor=true;R.openLocation(editorDraft.project,editorDraft.folder);};
actions['location-project']=button=>R.openLocation(button.dataset.project,'');
actions['move-note']=button=>{const note=R.card(button.dataset.id);if(!note)return;relayLocationContext={kind:'note',id:note.id};returnToEditor=false;R.openLocation(note.project,note.folder);};
actions['location-choose']=button=>{
 const context=relayLocationContext,project=button.dataset.project,folder=button.dataset.folder||'';
 if(!context||!R.data.projects.includes(project)||(folder&&R.folder(folder)?.project!==project))return;
 if(context.kind==='draft'){
  const next={...editorDraft,project,folder};
  if(!R.storage('relay-studio-draft:'+(context.id||'new'),next)){R.toast('Could not save this location. Your draft is unchanged.');return;}
  editorDraft=next;returnToEditor=false;R.openEditor(context.id);
 }else{
  const note=R.card(context.id);if(!note)return;
  const before=structuredClone(R.data);R.snapshot(note,'Location changed');Object.assign(note,{project,folder,updated:Date.now()});
  if(!R.save()){R.data=before;R.toast('Could not move this note. Try again.');return;}
  R.ui.project=project;R.ui.folder=folder;R.ui.scope='all';modal.close();R.render();R.openReader(context.id);R.toast('Note moved');
 }
 relayLocationContext=null;
};

actions['location-cancel']=()=>{const context=relayLocationContext;relayLocationContext=null;returnToEditor=false;if(context?.kind==='draft')R.openEditor(context.id);else if(context?.kind==='note')R.openReader(context.id);else R.closeModal();};
modal.addEventListener('cancel',event=>{if(modalKind==='location'){event.preventDefault();actions['location-cancel']();}});

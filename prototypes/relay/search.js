/* Full-screen search uses the same local notes; nothing is sent off-device. */
let relaySearchScope='all',relaySearchReturnFocus=null;
R.findSearchNotes=(query,scope='all')=>{
 const words=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
 return R.all().filter(note=>scope==='archive'?note.archived:!note.archived&&(scope!=='project'||note.project===R.ui.project)).map(note=>{
  const title=note.title.toLowerCase(),text=[note.title,note.body,note.tried,note.next,note.blocked,note.branch,note.project,note.links,...note.files,...note.tags,...Object.values(note.values||{}),...(note.attachments||[]).map(file=>file.name),R.folderLabel(note.folder)].join(' ').toLowerCase();
  return {note,match:words.every(word=>text.includes(word)),rank:words.length&&words.every(word=>title.includes(word))?1:0};
 }).filter(result=>result.match).sort((a,b)=>b.rank-a.rank||b.note.updated-a.note.updated).map(result=>result.note);
};
R.search=()=>R.btn(`${I('search')}<span>Search notes…</span><kbd>⌘ K</kbd>`,'search','search-launcher','aria-label="Search Relay"');
R.searchResults=query=>{
 const results=document.querySelector('#global-search-results');if(!results)return;
 const notes=R.findSearchNotes(query,relaySearchScope),hasQuery=!!query.trim();
 document.querySelector('#search-result-count').textContent=hasQuery?`${notes.length} ${notes.length===1?'result':'results'}`:relaySearchScope==='archive'?'Archived notes':'Recently updated';
 results.innerHTML=notes.length?notes.slice(0,50).map((note,index)=>`<button data-search-result data-global-open="${E(note.id)}" id="relay-search-result-${index}">${I('file')}<div><strong>${E(note.title)}</strong><small>${E(note.project)}${note.folder?' / '+E(R.folderLabel(note.folder)):''}${note.archived?' · Archived':''}</small>${note.body?`<p>${E(R.noteExcerpt(note).slice(0,180))}</p>`:''}</div><time>${R.age(note.updated)}</time>${I('arrow')}</button>`).join(''):`<div class="search-empty">${I('search')}<h3>${hasQuery?'No matching notes':'No notes here yet'}</h3><p>${hasQuery?'Try a title, a word from your writing, a branch or a filename.':'Your notes will appear here as you write.'}</p></div>`;
 document.querySelector('#search-truncated').textContent=notes.length>50?'Showing the first 50 results. Add another word to narrow your search.':'';
};
R.openSearch=()=>{
 R.flushInline();relaySearchReturnFocus=document.activeElement;relaySearchScope='all';
 R.showModal(`<section class="search-screen"><header><div class="search-brand">${R.logo().replace('data-action="home"','data-action="close-search"').replace('aria-label="Relay home"','aria-label="Back to notebook"')}<span>Search</span></div>${R.btn(`${I('close')}<span>Close</span>`,'close-search','button secondary','aria-label="Close search"')}</header><div class="search-content"><h2 id="modal-title">Find where you left off.</h2><label class="search-canvas-input">${I('search')}<input data-global-search aria-label="Search all notes" aria-describedby="search-keyboard-hint" placeholder="Search notes, branches, files…" autocomplete="off">${R.btn(I('close'),'clear-search','icon-button','aria-label="Clear search"')}</label><div class="search-scopes" role="group" aria-label="Search scope">${[['all','All notes'],['project','This project'],['archive','Archive']].map(([value,label])=>R.btn(label,'search-scope',value==='all'?'active':'',`data-value="${value}" aria-pressed="${value==='all'}"`)).join('')}</div><div class="search-results-heading"><h3 id="search-result-count" role="status" aria-live="polite"></h3><span id="search-keyboard-hint">↓ ↑ to navigate · Enter to open · Esc to close</span></div><div id="global-search-results"></div><p id="search-truncated"></p></div><footer>Your notes stay on this device.</footer></section>`,'search');
 R.searchResults('');document.querySelector('[data-global-search]')?.focus();
};
actions['search-scope']=button=>{relaySearchScope=button.dataset.value;document.querySelectorAll('[data-action="search-scope"]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});const input=document.querySelector('[data-global-search]');input.setAttribute('aria-label',relaySearchScope==='project'?'Search this project':relaySearchScope==='archive'?'Search archived notes':'Search all notes');R.searchResults(input.value);input.focus();};
actions['clear-search']=()=>{const input=document.querySelector('[data-global-search]');input.value='';R.searchResults('');input.focus();};
actions['close-search']=()=>{R.closeModal();const launcher=document.querySelector('.search-launcher');if(relaySearchReturnFocus?.isConnected)relaySearchReturnFocus.focus();else launcher?.focus();};
document.addEventListener('keydown',event=>{
 if(modal.open&&modalKind==='search'){
  const input=document.querySelector('[data-global-search]'),buttons=[...document.querySelectorAll('[data-search-result]')],index=buttons.indexOf(document.activeElement);
  if(event.key==='ArrowDown'&&(document.activeElement===input||index>=0)){event.preventDefault();buttons[Math.min(index+1,buttons.length-1)]?.focus();}
  if(event.key==='ArrowUp'&&index>=0){event.preventDefault();if(index===0)input.focus();else buttons[index-1].focus();}
  if(event.key==='Enter'&&event.target===input&&buttons.length){event.preventDefault();buttons[0].click();}
  return;
 }
 const typing=event.target.matches('input,textarea,select,[contenteditable="true"]');if(!modal.open&&!typing&&event.key==='/'){event.preventDefault();R.openSearch();}
});

modal.addEventListener('cancel',event=>{if(modalKind==='search'){event.preventDefault();actions['close-search']();}});

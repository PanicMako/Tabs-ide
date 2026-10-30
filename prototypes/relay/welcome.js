/* A skippable introduction. Setup choices never create or remove notes. */
(() => {
  const key='relay-welcome-v1';
  let step=0, organization='notes', view='list';
  const priorStudio=R.studio,priorClose=R.closeModal;
  R.studio=()=>priorStudio().replace('<div class="workspace-end">','<div class="workspace-end">'+R.btn('A quick tour','relay-tour','quiet-button'));
  R.view=()=>R.ui.view||R.folder?.(R.ui.folder)?.view||(['list','gallery','board'].includes(R.data.prefs.startView)?R.data.prefs.startView:'list');
  if(['list','gallery','board'].includes(R.data.prefs.startView))R.ui.view=R.data.prefs.startView;
  function remember(){return R.storage(key,{seen:true,at:Date.now()});}
  function dismiss(){remember();modal.close();R.render();}
  function render(){
    const pages=[
      {label:'A LITTLE HELLO',title:'Leave yourself a place to begin.',copy:'Keep the thought behind the work. A sentence is enough; folders and structure can come later.',art:'↳',body:`<div class="welcome-choices" role="group" aria-label="How you like to organize">${[['notes','Just notes','A clear page. No filing needed.'],['folders','Notes + folders','A few places for different thoughts.']].map(([id,title,copy])=>`<button type="button" data-welcome-organization="${id}" aria-pressed="${organization===id}"><strong>${title}</strong><span>${copy}</span></button>`).join('')}</div><p class="welcome-hint">Existing notes and folders stay intact. You can change this anytime.</p>`},
      {label:'YOUR WAY OF SEEING',title:'A view that feels like you.',copy:'Start with a simple list, spread things out as cards, or move notes across a board. Same notes, different perspectives.',art:'▤',body:`<div class="welcome-views" role="group" aria-label="Your starting view">${[['list','List','≡'],['gallery','Cards','▦'],['board','Board','▥']].map(([id,title,icon])=>`<button type="button" data-welcome-view="${id}" aria-pressed="${view===id}"><span aria-hidden="true">${icon}</span><strong>${title}</strong></button>`).join('')}</div><p class="welcome-hint">Board columns are your own spaces. Rename them in Templates & settings.</p>`},
      {label:'A LITTLE CONTEXT GOES A LONG WAY',title:'Pick up the thread, later.',copy:'Write freely, or add a page layout with your own questions. Your next step can be a sentence, a link, or a detail only you understand.',art:'✳',body:'<div class="welcome-example"><small>A NOTE TO YOUR FUTURE SELF</small><strong>Try the smaller version first.</strong><p>The last attempt was too complicated. Next time, start with one useful screen.</p></div><p class="welcome-hint">Notes and attachments stay on this device, in your browser or assigned Tabs profile. Full backups are in Templates & settings.</p>'},
    ];
    const page=pages[step];
    R.showModal(`${R.modalTop('RELAY / MAKE YOURSELF AT HOME')}<div class="welcome-progress" aria-label="Step ${step+1} of ${pages.length}">${pages.map((_,i)=>`<span class="${i<=step?'is-filled':''}" aria-hidden="true"></span>`).join('')}<small>${step+1} / ${pages.length}</small></div><div class="welcome-art" aria-hidden="true"><span>${page.art}</span><small>A LITTLE ROOM TO KEEP GOING.</small></div><span class="eyebrow">${page.label}</span><h2 id="modal-title">${page.title}</h2><p class="modal-intro">${page.copy}</p>${page.body}<div class="welcome-footer">${R.btn('Skip for now','welcome-skip','quiet-button')}<div>${step?R.btn('Back','welcome-back','button secondary'):''}${R.btn(step===pages.length-1?'Make yourself at home ↗':'Next →','welcome-next','button primary')}</div></div>`,'welcome');
    document.querySelector('#modal-title').tabIndex=-1;document.querySelector('#modal-title').focus();
  }
  R.openWelcome=()=>{R.flushInline();step=0;organization=R.usesFolders()?'folders':'notes';view=R.view();render();};
  actions['relay-tour']=R.openWelcome;
  actions['welcome-skip']=dismiss;
  actions['welcome-back']=()=>{step=Math.max(0,step-1);render();};
  actions['welcome-next']=()=>{
    if(step<2){step++;render();return;}
    const previous=structuredClone(R.data.prefs);
    R.data.prefs.organization ||= {};R.data.prefs.organization[R.ui.project]=organization;R.data.prefs.startView=view;
    if(!R.save()){R.data.prefs=previous;R.toast('We couldn’t save your choices. Try again, or skip for now.');return;}
    R.ui.view=view;remember();modal.close();R.render();R.toast('Your space is ready. Catch a thought whenever you like.');
  };
  document.addEventListener('click',event=>{
    const choice=event.target.closest('[data-welcome-organization],[data-welcome-view]');if(!choice)return;
    if(choice.dataset.welcomeOrganization)organization=choice.dataset.welcomeOrganization;
    if(choice.dataset.welcomeView)view=choice.dataset.welcomeView;
    const group=choice.closest('[role="group"]');group.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===choice)));
  });
  R.closeModal=()=>modalKind==='welcome'?dismiss():priorClose();
  modal.addEventListener('cancel',event=>{if(modalKind==='welcome'){event.preventDefault();dismiss();}});
  R.render();
  setTimeout(()=>{if(!R.read(key)&&!modal.open)R.openWelcome();},0);
})();

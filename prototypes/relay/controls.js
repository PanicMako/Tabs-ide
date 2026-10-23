/* Relay controls retain the original form values without opening native menus. */
(() => {
  const controls = new Map();
  let sequence = 0;
  const button = (text, label) => { const b=document.createElement('button'); b.type='button'; b.textContent=text; if(label)b.setAttribute('aria-label',label); return b; };
  const labelFor = source => source.getAttribute('aria-label') || [...(source.labels||[])].map(l=>{const clone=l.cloneNode(true);clone.querySelectorAll('select,input,textarea,.relay-control').forEach(n=>n.remove());return clone.textContent.trim();}).join(' ') || source.name || 'Choose an option';
  const keyFor = s => s.id || [s.closest('form')?.id,s.name,...Object.entries(s.dataset).flat()].filter(Boolean).join('-') || 'control-'+(++sequence);
  const hash = text => [...text].reduce((n,c)=>(Math.imul(31,n)+c.charCodeAt(0))|0,0).toString(36).replace('-','n');
  function enhance(source) {
    const type=source.tagName==='SELECT'?'select':source.type;
    const key=keyFor(source), label=labelFor(source), lifetime=new AbortController(), opts={signal:lifetime.signal};
    const wrapper=document.createElement('div');wrapper.className='relay-control relay-control-'+type;
    const trigger=button('',label);trigger.className='relay-control-trigger';trigger.id='relay-control-'+hash(key);
    const panel=document.createElement('div');panel.className='relay-control-panel';panel.id=trigger.id+'-panel';panel.hidden=true;
    trigger.setAttribute('aria-controls',panel.id);trigger.setAttribute('aria-expanded','false');
    trigger.setAttribute('aria-haspopup',type==='select'?'listbox':'dialog');
    if(type==='select'){trigger.setAttribute('role','combobox');panel.setAttribute('role','listbox');}
    else {panel.setAttribute('role','dialog');panel.setAttribute('aria-label',label);}
    panel.setAttribute('aria-label',label);
    const description=source.getAttribute('aria-describedby');if(description)trigger.setAttribute('aria-describedby',description);
    const previous={hidden:source.hidden,type:source.type,tabindex:source.getAttribute('tabindex')};
    source.before(wrapper);wrapper.append(trigger,panel);source.hidden=true;source.tabIndex=-1;
    if(type!=='select')source.type='hidden';
    let active=0, month=new Date().getMonth(), year=new Date().getFullYear(), prefix='', typedAt=0;
    function close(){panel.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-activedescendant');}
    function sync(){
      trigger.disabled=source.matches(':disabled');
      if(type==='select') {
        const text=source.options[source.selectedIndex]?.textContent||'Choose an option';trigger.textContent=text;trigger.setAttribute('aria-label',label+': '+text);
      } else if(type==='color') {trigger.textContent='● '+source.value.toUpperCase();trigger.setAttribute('aria-label',label+': '+source.value);}
      else {trigger.textContent=source.value?new Date(source.value+'T12:00:00').toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):'Choose a date';trigger.setAttribute('aria-label',label+': '+trigger.textContent);}
      if(trigger.disabled)close();
    }
    function restoreFocus(){queueMicrotask(()=>{const next=document.getElementById(trigger.id),dialog=document.querySelector('dialog[open]');if(next&&(!dialog||dialog.contains(next))&&(document.activeElement===document.body||wrapper.contains(document.activeElement)))next.focus();});}
    function commit(value){source.value=value;close();sync();trigger.focus();source.dispatchEvent(new Event('input',{bubbles:true}));source.dispatchEvent(new Event('change',{bubbles:true}));restoreFocus();}
    function highlight(index){
      const items=[...panel.querySelectorAll('[role="option"]')];active=index;
      items.forEach((item,i)=>item.dataset.active=String(i===index));
      if(items[index]){trigger.setAttribute('aria-activedescendant',items[index].id);items[index].scrollIntoView({block:'nearest'});}
    }
    const available=i=>{const option=source.options[i];return option&&!option.disabled&&!(option.parentElement.tagName==='OPTGROUP'&&option.parentElement.disabled);};
    function renderOptions(){
      panel.replaceChildren();[...source.options].forEach((option,index)=>{const row=document.createElement('div');row.id=panel.id+'-'+index;row.className='relay-option';row.setAttribute('role','option');row.setAttribute('aria-selected',String(index===source.selectedIndex));row.setAttribute('aria-disabled',String(!available(index)));row.textContent=option.textContent;row.addEventListener('pointerdown',e=>e.preventDefault(),opts);row.addEventListener('click',e=>{e.stopPropagation();if(available(index))commit(option.value);},opts);panel.append(row);});active=Math.max(0,source.selectedIndex);highlight(active);
    }
    function colorRule(b,color){const cls='relay-color-'+color.slice(1);const sheet=document.querySelector('link[href$="controls.css"]')?.sheet;if(sheet&&!document.querySelector('.'+cls)){try{sheet.insertRule('.'+cls+'{background:'+color+'}',sheet.cssRules.length);}catch{}}b.classList.add(cls);}
    function renderColors(){
      panel.replaceChildren();const title=document.createElement('strong');title.textContent='Find your color.';panel.append(title);
      const palette=document.createElement('div');palette.className='relay-palette';
      ['#3259ed','#202b44','#6975c8','#a16ca5','#c55b78','#dc8756','#c79e42','#669387','#7a96b8','#9097a6','#b5c99e','#ffffff'].forEach(color=>{const b=button(source.value===color?'✓':'','Use '+color);b.className='relay-color-choice';b.setAttribute('aria-pressed',String(source.value===color));colorRule(b,color);b.addEventListener('click',()=>commit(color),opts);palette.append(b);});panel.append(palette);
      const hex=document.createElement('input');hex.type='text';hex.value=source.value;hex.maxLength=7;hex.setAttribute('aria-label','Hex color');hex.className='relay-hex';
      const apply=button('Use this color');apply.className='button secondary';const error=document.createElement('p');error.className='relay-control-error';error.setAttribute('role','status');
      apply.addEventListener('click',()=>{if(/^#[a-f\d]{6}$/i.test(hex.value.trim()))commit(hex.value.trim().toLowerCase());else{error.textContent='Use six hex digits, for example #3259ed.';hex.focus();}},opts);
      panel.append(hex,apply,error);
    }
    function renderCalendar(){
      panel.replaceChildren();const header=document.createElement('div');header.className='relay-calendar-heading';const prev=button('←','Previous month'),next=button('→','Next month'),title=document.createElement('strong');title.textContent=new Date(year,month,1).toLocaleDateString(undefined,{month:'long',year:'numeric'});header.append(prev,title,next);panel.append(header);
      const shift=delta=>{const d=new Date(year,month+delta,1);month=d.getMonth();year=d.getFullYear();renderCalendar();panel.querySelectorAll('.relay-calendar-heading button')[delta<0?0:1].focus();};prev.addEventListener('click',()=>shift(-1),opts);next.addEventListener('click',()=>shift(1),opts);
      const grid=document.createElement('div');grid.className='relay-calendar';['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(day=>{const s=document.createElement('span');s.textContent=day;s.setAttribute('aria-hidden','true');grid.append(s);});
      const offset=new Date(year,month,1).getDay(),count=new Date(year,month+1,0).getDate();for(let i=0;i<offset;i++)grid.append(document.createElement('span'));
      for(let day=1;day<=count;day++){const value=String(year).padStart(4,'0')+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');const b=button(String(day),new Date(year,month,day).toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'}));b.setAttribute('aria-pressed',String(source.value===value));b.addEventListener('click',()=>commit(value),opts);b.addEventListener('keydown',e=>{const moves={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};if(!(e.key in moves))return;e.preventDefault();e.stopPropagation();const cells=[...grid.querySelectorAll('button')],index=cells.indexOf(b);cells[Math.max(0,Math.min(cells.length-1,index+moves[e.key]))].focus();},opts);grid.append(b);}panel.append(grid);
      const clear=button('Leave the date open');clear.className='quiet-button';clear.addEventListener('click',()=>commit(''),opts);panel.append(clear);
    }
    function open(){if(trigger.disabled)return;document.dispatchEvent(new CustomEvent('relay:close-controls'));trigger.setAttribute('aria-expanded','true');panel.hidden=false;if(type==='select')renderOptions();else if(type==='color'){renderColors();panel.querySelector('button')?.focus();}else{const d=source.value?new Date(source.value+'T12:00:00'):new Date();month=d.getMonth();year=d.getFullYear();renderCalendar();panel.querySelector('button')?.focus();}}
    trigger.addEventListener('click',e=>{e.stopPropagation();panel.hidden?open():close();},opts);
    panel.addEventListener('click',e=>e.stopPropagation(),opts);
    wrapper.addEventListener('keydown',e=>{
      if(e.ctrlKey||e.metaKey||e.altKey)return;
      if(e.key==='Escape'&&!panel.hidden){e.preventDefault();e.stopPropagation();close();trigger.focus();return;}
      if(type!=='select'){if(e.key==='Enter'&&e.target.tagName==='INPUT'){e.preventDefault();panel.querySelector('.button')?.click();}return;}
      if(e.key==='Tab'){close();return;}
      if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();if(panel.hidden){open();return;}if(e.key==='Enter'||e.key===' '){if(available(active))commit(source.options[active].value);return;}let candidate=e.key==='Home'?0:e.key==='End'?source.options.length-1:active+(e.key==='ArrowUp'?-1:1);const delta=e.key==='ArrowUp'||e.key==='End'?-1:1;while(candidate>=0&&candidate<source.options.length&&!available(candidate))candidate+=delta;if(candidate>=0&&candidate<source.options.length)highlight(candidate);}
      else if(e.key.length===1){e.stopPropagation();if(panel.hidden)open();prefix=Date.now()-typedAt>600?'':prefix;prefix+=e.key.toLowerCase();typedAt=Date.now();const index=[...source.options].findIndex((o,i)=>available(i)&&o.textContent.trim().toLowerCase().startsWith(prefix));if(index>=0)highlight(index);}
    },opts);
    wrapper.addEventListener('focusout',()=>queueMicrotask(()=>{if(!wrapper.contains(document.activeElement))close();}),opts);
    document.addEventListener('pointerdown',e=>{if(!wrapper.contains(e.target))close();},opts);
    document.addEventListener('relay:close-controls',close,opts);
    source.addEventListener('change',sync,opts);
    source.addEventListener('invalid',e=>{e.preventDefault();trigger.setAttribute('aria-invalid','true');trigger.focus();R.toast('Choose '+label.toLowerCase()+' before continuing.');},opts);
    source.form?.addEventListener('reset',()=>queueMicrotask(sync),opts);
    const observer=new MutationObserver(sync);observer.observe(source,{childList:true,subtree:true,attributes:true});for(const fs of source.closest('form')?.querySelectorAll('fieldset')||[])observer.observe(fs,{attributes:true,attributeFilter:['disabled']});
    sync();return()=>{lifetime.abort();observer.disconnect();wrapper.remove();source.hidden=previous.hidden;if(type!=='select')source.type=previous.type;previous.tabindex===null?source.removeAttribute('tabindex'):source.setAttribute('tabindex',previous.tabindex);};
  }
  function reconcile(){for(const [source,clean]of controls)if(!source.isConnected){clean();controls.delete(source);}document.querySelectorAll('select,input[type="color"],input[type="date"]').forEach(source=>{if(!controls.has(source)&&!(source.tagName==='SELECT'&&(source.multiple||source.size>1)))controls.set(source,enhance(source));});}
  const observer=new MutationObserver(reconcile);reconcile();observer.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('pagehide',()=>{observer.disconnect();for(const clean of controls.values())clean();controls.clear();});
  window.addEventListener('pageshow',event=>{if(event.persisted){reconcile();observer.observe(document.body,{childList:true,subtree:true});}});
})();

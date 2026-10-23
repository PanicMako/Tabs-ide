/* Rich answers remain strings/booleans, preserving existing notes and backups. */
const relayBaseCustomField=R.customField;
R.customField=(field,note)=>{
 const value=R.value(note,field.id),id='prompt-'+field.id,options=(field.options||'').split(',').map(x=>x.trim()).filter(Boolean);
 const label=`<label for="${E(id)}">${E(field.label)}<small>Optional</small></label>`;
 if(['checklist','choice'].includes(field.type)){
  const selected=new Set(String(value||'').split('\n'));
  return `<fieldset class="optional-prompt rich-choices" data-rich-group="${E(field.id)}" data-rich-type="${field.type}"><legend>${E(field.label)} <small>Optional · ${field.type==='checklist'?'choose any':'choose one'}</small></legend><input type="hidden" id="${E(id)}" data-custom-field="${E(field.id)}" value="${E(value)}">${options.map((option,index)=>`<label class="rich-choice"><input type="${field.type==='checklist'?'checkbox':'radio'}" name="rich-${E(field.id)}" data-rich-choice value="${E(option)}" ${selected.has(option)?'checked':''}><span>${E(option)}</span></label>`).join('')}${field.type==='choice'?R.btn('Clear selection','clear-rich-choice','quiet-button',`type="button" data-field="${E(field.id)}"`):''}</fieldset>`;
 }
 if(field.type==='rating')return `<div class="optional-prompt rich-rating" data-rich-group="${E(field.id)}">${label}<input type="hidden" id="${E(id)}" data-custom-field="${E(field.id)}" value="${E(value)}"><div role="group" aria-label="${E(field.label)}">${[1,2,3,4,5].map(number=>`<button type="button" data-rating-value="${number}" aria-label="${number} out of 5" aria-pressed="${String(value)===String(number)}" class="${Number(value)>=number?'active':''}">★</button>`).join('')}${R.btn('Clear','clear-rich-choice','quiet-button',`type="button" data-field="${E(field.id)}"`)}</div></div>`;
 if(field.type==='number')return `<div class="optional-prompt">${label}<div class="rich-number">${R.btn('−','step-rich-number','icon-button',`type="button" data-step="-1" aria-label="Decrease ${E(field.label)}"`)}<input type="text" id="${E(id)}" data-custom-field="${E(field.id)}" value="${E(value)}" inputmode="decimal" placeholder="0">${R.btn('+','step-rich-number','icon-button',`type="button" data-step="1" aria-label="Increase ${E(field.label)}"`)}</div></div>`;
 if(['email','time','code'].includes(field.type)){
  const control=field.type==='code'?`<textarea id="${E(id)}" data-custom-field="${E(field.id)}" class="rich-code" rows="4" placeholder="Paste a snippet…" spellcheck="false">${E(value)}</textarea>`:`<input id="${E(id)}" data-custom-field="${E(field.id)}" value="${E(value)}" inputmode="${field.type==='number'?'decimal':field.type==='email'?'email':'text'}" placeholder="${{number:'e.g. 12.5',email:'you@example.com',time:'HH:MM'}[field.type]}">`;
  return `<div class="optional-prompt">${label}${control}</div>`;
 }
 return relayBaseCustomField(field,note);
};
R.updateRichAnswer=group=>{
 const input=group.querySelector('[data-custom-field]');
 if(group.dataset.richType)input.value=[...group.querySelectorAll('[data-rich-choice]:checked')].map(choice=>choice.value).join('\n');
 input.dispatchEvent(new Event('input',{bubbles:true}));
};
document.addEventListener('change',event=>{if(event.target.hasAttribute('data-rich-choice'))R.updateRichAnswer(event.target.closest('[data-rich-group]'));});
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-rating-value]');if(!button)return;const group=button.closest('[data-rich-group]'),value=button.dataset.ratingValue;group.querySelector('[data-custom-field]').value=value;
 group.querySelectorAll('[data-rating-value]').forEach(item=>{item.classList.toggle('active',Number(item.dataset.ratingValue)<=Number(value));item.setAttribute('aria-pressed',String(item===button));});R.updateRichAnswer(group);
});
actions['clear-rich-choice']=button=>{const group=button.closest('[data-rich-group]');group.querySelector('[data-custom-field]').value='';group.querySelectorAll('[data-rich-choice]').forEach(input=>input.checked=false);group.querySelectorAll('[data-rating-value]').forEach(item=>{item.classList.remove('active');item.setAttribute('aria-pressed','false');});R.updateRichAnswer(group);};

actions['step-rich-number']=button=>{const input=button.closest('.rich-number').querySelector('input'),current=Number(input.value||0);if(!Number.isFinite(current)){input.focus();return;}input.value=String(Math.round((current+Number(button.dataset.step))*1000000)/1000000);input.dispatchEvent(new Event('input',{bubbles:true}));};

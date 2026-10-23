/* A template is a writing page plus any optional fields the author adds. */
let relayActiveTemplateField='';
const relayTemplateTypes=[['short','Short answer','A line of text','lines'],['long','Paragraph','Room for more context','file'],['check','Checkbox','One item to tick off','check'],['checklist','Checklist','Choose multiple items','check'],['choice','Multiple choice','Choose one answer','grid'],['select','Dropdown','A list of choices','down'],['rating','Rating','A five-star scale','spark'],['number','Number','Counts or estimates','plus'],['date','Date','A date to remember','clock'],['time','Time','A time of day','clock'],['email','Email','An email address','link'],['link','Link','A useful web address','link'],['code','Code snippet','Keep a piece of code','file']];
const relayTemplatePreviewValues=new Map();
R.templatePreviewMarkup=template=>{
 const values=relayTemplatePreviewValues.get(template.id)||{};
 return `<article class="builder-note-preview" aria-label="Interactive note preview"><span class="builder-preview-kicker">TRY YOUR TEMPLATE · PREVIEW ONLY</span><input class="preview-title-input" aria-label="Preview note title" placeholder="Untitled note" data-preview-base="title" value="${E(values.__title||'')}"><textarea class="preview-body-input" aria-label="Preview writing space" data-preview-base="body" rows="4" placeholder="Start writing…">${E(values.__body||'')}</textarea>${template.fields.map(field=>`<section class="builder-preview-field" data-template-drop="${E(field.id)}"><button type="button" class="template-drag-handle preview-drag-handle" draggable="false" data-template-drag="${E(field.id)}" aria-label="Drag ${E(field.label)} to reorder" title="Drag to reorder · Alt + arrow keys">⠿</button>${R.customField(field,{values})}</section>`).join('')}<div class="builder-preview-footer">${I('check')}Try the controls here. Preview answers aren’t saved as notes.</div></article>`;
};

R.templateEditorSettings=()=>{
 const template=R.template(selectedTemplate);selectedTemplate=template.id;
 if(relayActiveTemplateField!=='__none__'&&!template.fields.some(field=>field.id===relayActiveTemplateField))relayActiveTemplateField=template.fields[0]?.id||'';
 const fields=template.fields.map((field,index)=>{
  const active=field.id===relayActiveTemplateField,type=relayTemplateTypes.find(([id])=>id===field.type)||relayTemplateTypes[0];
  return `<article class="template-field-block ${active?'active':''}" data-template-drop="${E(field.id)}"><div class="template-field-bar"><button type="button" class="template-drag-handle" draggable="false" data-template-drag="${E(field.id)}" aria-label="Drag ${E(field.label)} to reorder" title="Drag to reorder · Alt + arrow keys">⠿</button><button data-action="template-edit-field" data-id="${E(field.id)}" aria-expanded="${active}"><span class="template-field-number">${index+1}</span>${I(type[3])}<span>${E(field.label||type[1])}</span><small>${type[1]}</small></button><div>${R.btn(I('up'),'field-up','icon-button',`data-id="${E(field.id)}" ${index===0?'disabled':''} aria-label="Move ${E(field.label)} up"`)}${R.btn(I('down'),'field-down','icon-button',`data-id="${E(field.id)}" ${index===template.fields.length-1?'disabled':''} aria-label="Move ${E(field.label)} down"`)}</div></div>${active?`<div class="template-field-properties"><label>Field label<input data-field-label="${E(field.id)}" value="${E(field.label)}" placeholder="e.g. What’s the next step?" aria-label="Field label"></label><label>Answer type<select data-field-type="${E(field.id)}" aria-label="Answer type">${relayTemplateTypes.map(([id,name])=>`<option value="${id}" ${field.type===id?'selected':''}>${name}</option>`).join('')}</select></label>${['select','checklist','choice'].includes(field.type)?`<div class="builder-options"><span>Choices</span>${(field.options?field.options.split(','):['']).map((option,choice)=>`<div><input data-choice-field="${E(field.id)}" data-choice-index="${choice}" value="${E(option.trim())}" aria-label="Choice ${choice+1}" placeholder="Option ${choice+1}">${R.btn(I('close'),'remove-choice','icon-button',`data-id="${E(field.id)}" data-index="${choice}" aria-label="Remove choice ${choice+1}"`)}</div>`).join('')}${R.btn(`${I('plus')}Add choice`,'add-choice','quiet-button',`data-id="${E(field.id)}"`)}</div>`:field.type==='check'?`<label>Checkbox text<input data-field-options="${E(field.id)}" value="${E(field.options||'')}" placeholder="e.g. Ready to continue" aria-label="Checkbox text"></label>`:''}<footer><span>Optional · no required answers</span><div>${R.btn('Duplicate','duplicate-field','quiet-button',`data-id="${E(field.id)}"`)}${R.btn(`${I('trash')}Delete`,'remove-field','quiet-button',`data-id="${E(field.id)}"`)}</div></footer></div>`:''}</article>`;
 }).join('');
 return `<div class="template-workbench">${R.btn(`${I('back')}All templates`,'template-library','quiet-button template-back')}<div class="template-workbench-toolbar"><label class="template-selector-label"><span class="sr-only">Template</span><select data-builder-template aria-label="Choose template">${R.data.templates.map(item=>`<option value="${E(item.id)}" ${item.id===template.id?'selected':''}>${E(item.name)}${R.data.prefs.template===item.id?' · Default':''}</option>`).join('')}</select></label><div class="template-toolbar-actions">${R.btn(`${I('plus')}Add field`,'template-jump-fields','button secondary')}${R.btn('New template','add-template','quiet-button')}</div></div><div class="template-workbench-layout"><section class="template-build-pane" aria-label="Build your template"><div class="template-name-line"><label>Template name<input data-template-name="${E(template.id)}" value="${E(template.name)}" aria-label="Template name"></label><div>${R.btn(R.data.prefs.template===template.id?`${I('check')}Default`:'Use by default','default-template','quiet-button',`data-id="${E(template.id)}"`)}${R.btn('Duplicate','duplicate-template','quiet-button',`data-id="${E(template.id)}"`)}${R.btn(`${I('trash')}Delete template`,'remove-template','quiet-button template-delete',`data-id="${E(template.id)}"`)}</div></div><div class="template-base-block"><span class="template-base-symbol">${I('file')}</span><div><strong>Title & writing space</strong><p>Always included. Write as much or as little as you want.</p></div><span class="template-included">Included</span></div><div class="template-field-list">${fields}</div><section class="template-add-palette" aria-label="Add an optional field"><div><h4>${template.fields.length?'Add another field':'Add a field, if it helps'}</h4><p>Choose what you’d like to keep alongside your writing.</p></div><div class="template-field-types">${relayTemplateTypes.map(([id,name,description,icon])=>R.btn(`${I(icon)}<span>${name}<small>${description}</small></span>`,'template-add-field','',`data-type="${id}" aria-label="Add ${name.toLowerCase()}"`)).join('')}</div></section><p class="template-builder-note">${I('check')}Changes save automatically. Existing answers stay with their notes when you remove a field.</p></section><details class="template-preview-pane" open><summary>Note preview <small>Updates as you edit</small></summary><div id="template-live-preview">${R.templatePreviewMarkup(template)}</div></details></div></div>`;
};
actions['template-add-field']=button=>{
 const type=button.dataset.type,definition=relayTemplateTypes.find(([id])=>id===type);if(!definition)return;
 const template=R.template(selectedTemplate),field={id:crypto.randomUUID(),type,label:definition[1],options:['select','choice'].includes(type)?'Option 1,Option 2':type==='checklist'?'First item,Second item,Third item':''};
 const result=R.commitChange(()=>template.fields.push(field));if(!result)return;
 relayActiveTemplateField=field.id;R.customize('templates');document.querySelector('[data-field-label]')?.focus();
};
actions['template-edit-field']=button=>{relayActiveTemplateField=relayActiveTemplateField===button.dataset.id?'__none__':button.dataset.id;R.customize('templates');if(relayActiveTemplateField!=='__none__')document.querySelector('[data-field-label]')?.focus();};
actions['template-jump-fields']=()=>{const palette=document.querySelector('.template-add-palette');palette?.scrollIntoView({block:'center'});palette?.querySelector('button')?.focus();};
document.addEventListener('change',event=>{if(event.target.hasAttribute('data-builder-template')){selectedTemplate=event.target.value;relayActiveTemplateField='';R.customize('templates');}});
document.addEventListener('input',event=>{
 const input=event.target;if(!input.matches('[data-template-name],[data-field-label],[data-field-options],[data-choice-field]'))return;
 const preview=document.querySelector('#template-live-preview');if(preview)preview.innerHTML=R.templatePreviewMarkup(R.template(selectedTemplate));
 if(input.hasAttribute('data-field-label')){const block=input.closest('.template-field-block'),label=block?.querySelector('.template-field-bar>button>span:not(.template-field-number)');if(label)label.textContent=input.value||'Untitled field';}
});

document.addEventListener('input',event=>{
 const field=event.target.closest('#template-live-preview [data-custom-field]'),base=event.target.closest('#template-live-preview [data-preview-base]');if(!field&&!base)return;
 const values=relayTemplatePreviewValues.get(selectedTemplate)||{};if(field)values[field.dataset.customField]=field.type==='checkbox'?field.checked:field.value;if(base)values['__'+base.dataset.previewBase]=base.value;relayTemplatePreviewValues.set(selectedTemplate,values);
});
document.addEventListener('change',event=>{const field=event.target.closest('#template-live-preview [data-custom-field]');if(field)field.dispatchEvent(new Event('input',{bubbles:true}));});

// Start with a library: choose a template before working on its fields.
let relayTemplateLibraryOpen=true;
let relayTemplatePendingDelete='';
R.templateSettings=()=>relayTemplateLibraryOpen?`<div class="template-library"><div class="template-library-heading"><div><h4>Your templates <span>${R.data.templates.length}</span></h4><p>Choose a layout to edit. Use it whenever you start a note.</p></div>${R.btn(`${I('plus')}New template`,'add-template','button')}</div><div class="template-library-list">${R.data.templates.map(template=>`<article class="template-library-row"><span class="template-library-icon">${I('file')}</span><div class="template-library-info"><h4>${E(template.name)}${R.data.prefs.template===template.id?'<span class="template-default-badge">Default</span>':''}</h4><p>${template.fields.length?`${template.fields.length} optional ${template.fields.length===1?'field':'fields'}`:'Writing space only'} · Title & writing included</p></div><div class="template-library-actions">${R.btn(`${I('edit')}Edit`,'template-open','button secondary',`data-id="${E(template.id)}" aria-label="Edit ${E(template.name)}"`)}${R.btn('Duplicate','duplicate-template','quiet-button',`data-id="${E(template.id)}" aria-label="Duplicate ${E(template.name)}"`)}${R.btn(`${I('trash')}Delete`,'remove-template','quiet-button template-delete',`data-id="${E(template.id)}" aria-label="Delete ${E(template.name)}"`)}</div></article>`).join('')}</div><p class="template-library-help">${I('check')}The default is selected for new notes. You can choose a different template in any note.</p></div>`:R.templateEditorSettings();
actions['template-library']=()=>{relayTemplateLibraryOpen=true;R.customize('templates');};
actions['template-open']=button=>{selectedTemplate=button.dataset.id;relayTemplateLibraryOpen=false;relayActiveTemplateField='';R.customize('templates');document.querySelector('[data-template-name]')?.focus();};
R.openTemplateName=sourceId=>{
 const source=R.data.templates.find(template=>template.id===sourceId);
 R.showModal(`${R.modalTop('TEMPLATES').replace('data-action="close"','data-action="template-cancel"')}<h2 id="modal-title">${source?'Duplicate template':'New template'}</h2><p class="modal-intro">${source?'Give your copy a name. The original stays as it is.':'Start with a name. Add optional fields whenever you need them.'}</p><form id="template-name-form" data-source="${E(source?.id||'')}"><label class="template-create-label">Template name<input name="templateName" aria-label="Template name" placeholder="e.g. Project handoff" value="${E(source?source.name+' copy':'')}" maxlength="100" aria-required="true" autocomplete="off"></label><p class="template-name-error" role="alert"></p><div class="dialog-actions">${R.btn('Cancel','template-cancel','button secondary')}<button type="submit" class="button">${source?'Create copy':'Create template'}</button></div></form>`,'template-name');
 const input=document.querySelector('#template-name-form input');input?.focus();input?.select();
};
actions['add-template']=()=>R.openTemplateName();
actions['duplicate-template']=button=>R.openTemplateName(button?.dataset.id||selectedTemplate);
actions['template-cancel']=()=>{relayTemplatePendingDelete='';R.customize('templates');};
document.addEventListener('submit',event=>{
 if(event.target.id!=='template-name-form')return;event.preventDefault();
 const form=event.target,name=form.elements.templateName.value.trim();
 if(!name){form.querySelector('[role="alert"]').textContent='Give your template a name to continue.';form.elements.templateName.focus();return;}
 const source=R.data.templates.find(template=>template.id===form.dataset.source);
 const template={id:crypto.randomUUID(),name,fields:source?structuredClone(source.fields).map(field=>({...field,id:crypto.randomUUID()})):[]};
 if(!R.commitChange(()=>R.data.templates.push(template)))return;
 selectedTemplate=template.id;relayActiveTemplateField='';relayTemplateLibraryOpen=false;R.customize('templates');R.toast('Template created. Add fields, or leave it as a writing page.');
});
actions['default-template']=button=>{if(!R.commitChange(()=>{R.data.prefs.template=button.dataset.id;}))return;R.customize('templates');R.toast('Default template updated.');};
actions['remove-template']=button=>{
 const template=R.data.templates.find(item=>item.id===button.dataset.id);if(!template)return;relayTemplatePendingDelete=template.id;
 const fallback=R.data.templates.find(item=>item.id!==template.id),count=R.data.cards.filter(note=>note.template===template.id).length;
 R.showModal(`${R.modalTop('TEMPLATES').replace('data-action="close"','data-action="template-cancel"')}<div class="confirm-symbol">${I('trash')}</div><h2 id="modal-title">Delete “${E(template.name)}”?</h2><p class="modal-intro">Your notes and saved answers will stay. ${count?`${count} ${count===1?'note uses':'notes use'} this template. `:''}${fallback?`Notes using it will switch to “${E(fallback.name)}”.`:'A blank writing template will replace this last template.'}</p><div class="dialog-actions">${R.btn('Cancel','template-cancel','button secondary')}${R.btn('Delete template','template-confirm-delete','button danger')}</div>`,'template-delete');
 document.querySelector('.dialog-actions [data-action="template-cancel"]')?.focus();
};
actions['template-confirm-delete']=()=>{
 const template=R.data.templates.find(item=>item.id===relayTemplatePendingDelete);if(!template)return;
 const outcome=R.commitChange(()=>{
  R.data.retiredFields ||= {};template.fields.forEach(field=>{R.data.retiredFields[field.id]={label:field.label,type:field.type};});
  R.data.templates=R.data.templates.filter(item=>item.id!==template.id);
  if(!R.data.templates.length)R.data.templates.push({id:crypto.randomUUID(),name:'Blank note',fields:[]});
  const fallback=R.data.templates[0].id;
  R.data.cards.forEach(note=>{if(note.template===template.id)note.template=fallback;});
  R.data.folders.forEach(folder=>{if(folder.template===template.id)folder.template='';});
  if(R.data.prefs.template===template.id)R.data.prefs.template=fallback;
 });if(!outcome)return;
 relayTemplatePreviewValues.delete(template.id);relayTemplatePendingDelete='';relayTemplateLibraryOpen=true;R.customize('templates');R.toast('Template deleted. Your notes and answers are safe.');
};

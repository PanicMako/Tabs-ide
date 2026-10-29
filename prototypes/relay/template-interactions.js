/* The preview and the builder reorder the same field IDs, never their answers. */
let relayDraggedTemplateField='',relayTemplateDrop=null;
R.moveTemplateField=(sourceId,targetId,after=false)=>{
 const template=R.template(selectedTemplate),source=template.fields.find(field=>field.id===sourceId);
 if(!source||sourceId===targetId||!template.fields.some(field=>field.id===targetId))return false;
 const result=R.commitChange(()=>{const remaining=template.fields.filter(field=>field.id!==sourceId),target=remaining.findIndex(field=>field.id===targetId);remaining.splice(target+(after?1:0),0,source);template.fields=remaining;});
 if(!result)return false;R.customize('templates');R.toast('Field order updated');return true;
};
const clearTemplateDrag=()=>{document.querySelectorAll('.template-drop-before,.template-drop-after,.template-being-dragged').forEach(el=>el.classList.remove('template-drop-before','template-drop-after','template-being-dragged'));relayDraggedTemplateField='';relayTemplateDrop=null;};
const showTemplateDrop=(target,y)=>{document.querySelectorAll('.template-drop-before,.template-drop-after').forEach(el=>el.classList.remove('template-drop-before','template-drop-after'));if(!target||target.dataset.templateDrop===relayDraggedTemplateField){relayTemplateDrop=null;return;}const box=target.getBoundingClientRect(),after=y>box.top+box.height/2;target.classList.add(after?'template-drop-after':'template-drop-before');relayTemplateDrop={id:target.dataset.templateDrop,after};};
document.addEventListener('dragstart',event=>{const handle=event.target.closest('[data-template-drag]');if(!handle)return;relayDraggedTemplateField=handle.dataset.templateDrag;event.dataTransfer.setData('application/x-relay-template-field',relayDraggedTemplateField);event.dataTransfer.effectAllowed='move';handle.closest('[data-template-drop]')?.classList.add('template-being-dragged');});
document.addEventListener('dragover',event=>{if(!relayDraggedTemplateField)return;const target=event.target.closest('[data-template-drop]');if(!target)return;event.preventDefault();event.dataTransfer.dropEffect='move';showTemplateDrop(target,event.clientY);});
document.addEventListener('drop',event=>{if(!relayDraggedTemplateField)return;event.preventDefault();const source=relayDraggedTemplateField,target=relayTemplateDrop;clearTemplateDrag();if(target)R.moveTemplateField(source,target.id,target.after);});
document.addEventListener('dragend',clearTemplateDrag);
document.addEventListener('keydown',event=>{const handle=event.target.closest('[data-template-drag]');if(!handle||!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const fields=R.template(selectedTemplate).fields,index=fields.findIndex(field=>field.id===handle.dataset.templateDrag),target=fields[index+(event.key==='ArrowUp'?-1:1)];if(target)R.moveTemplateField(handle.dataset.templateDrag,target.id,event.key==='ArrowDown');});
let relayTouchHandle=null;
document.addEventListener('pointerdown',event=>{const handle=event.target.closest('[data-template-drag]');if(!handle||event.button!==0)return;event.preventDefault();handle.focus({preventScroll:true});handle.closest('[data-template-drop]')?.classList.add('template-being-dragged');relayTouchHandle=handle;relayDraggedTemplateField=handle.dataset.templateDrag;handle.setPointerCapture(event.pointerId);});
document.addEventListener('pointermove',event=>{if(!relayTouchHandle)return;event.preventDefault();showTemplateDrop(document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-template-drop]'),event.clientY);});
document.addEventListener('pointerup',()=>{if(!relayTouchHandle)return;const source=relayDraggedTemplateField,target=relayTemplateDrop;relayTouchHandle=null;clearTemplateDrag();if(target)R.moveTemplateField(source,target.id,target.after);});
document.addEventListener('pointercancel',()=>{relayTouchHandle=null;clearTemplateDrag();});
actions['new-subfolder']=button=>{
 const parent=button.dataset.id||R.ui.folder,folder=R.folder(parent);if(!folder||folder.project!==R.ui.project)return;
 R.folderForm();const form=document.querySelector('#folder-form');form.elements.parent.value=parent;form.elements.parent.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#modal-title').textContent='New subfolder';const intro=document.querySelector('.modal-intro');if(intro)intro.textContent='Inside '+R.folderLabel(parent);form.querySelector('[name="name"]')?.focus();
};
const subfolderForm=R.folderForm;
R.folderForm=id=>{subfolderForm(id);if(!id)return;const management=document.querySelector('.folder-management');management?.insertAdjacentHTML('afterbegin',R.btn(`${I('plus')}New subfolder`,'new-subfolder','quiet-button',`type="button" data-id="${E(id)}"`));};

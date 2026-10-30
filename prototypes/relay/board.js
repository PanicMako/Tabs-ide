/* Board edits are deliberate: opening a form never mutates a column. */
let relayBoardReturn=false;
R.columnEditor=(id=null)=>{
 const column=id?R.data.columns.find(c=>c.id===id):null;if(id&&!column)return;
 if(modalKind!=='column-edit'&&modalKind!=='column-delete')relayBoardReturn=modal.open&&modalKind==='settings';
 R.showModal(`<div class="column-dialog">${R.modalTop('BOARD COLUMN').replace('data-action="close"','data-action="column-cancel"')}<h2 id="modal-title">${column?'Edit column':'New column'}</h2><p class="modal-intro">${column?'Make your changes, then save when you’re ready.':'Give this part of your board a name.'}</p><form id="column-form" data-id="${E(id||'')}" class="simple-form"><label>Column name<input name="name" required maxlength="80" value="${E(column?.name||'')}" placeholder="e.g. In progress" autocomplete="off"></label><label>Color<input type="color" name="color" value="${E(column?.color||'#3259ed')}" aria-label="Column color"></label><div class="column-dialog-actions">${column?R.btn(`${I('trash')}Delete column`,'remove-column','danger-link',`type="button" data-id="${E(id)}" ${R.data.columns.length===1?'disabled':''}`):''}<div>${R.btn('Cancel','column-cancel','button secondary','type="button"')}<button type="submit" class="button primary">${column?'Save changes':'Create column'}</button></div></div></form></div>`,'column-edit');document.querySelector('#column-form input[name="name"]')?.focus();
};
R.finishColumnEdit=()=>{if(relayBoardReturn)R.customize('board');else{modal.close();R.render();}};
actions['edit-column']=button=>R.columnEditor(button.dataset.id);
actions['add-column']=()=>R.columnEditor();
actions['column-cancel']=R.finishColumnEdit;
actions['remove-column']=button=>{
 const id=button.dataset.id,column=R.data.columns.find(c=>c.id===id);if(!column||R.data.columns.length<2)return;
 if(modalKind==='settings')relayBoardReturn=true;
 const target=R.data.columns.find(c=>c.id!==id),count=R.data.cards.filter(note=>note.status===id).length;
 R.showModal(`${R.modalTop('DELETE COLUMN').replace('data-action="close"','data-action="column-cancel"')}<div class="confirm-symbol">${I('trash')}</div><h2 id="modal-title">Delete “${E(column.name)}”?</h2><p class="modal-intro">${count?`${count} ${count===1?'note will':'notes will'} move to <strong>${E(target.name)}</strong>.`:'This column is empty.'} Your notes will be kept.</p><div class="dialog-actions">${R.btn('Cancel','column-cancel','button secondary')}${R.btn('Delete column','confirm-column-delete','button danger',`data-id="${E(id)}"`)}</div>`,'column-delete');
};
actions['confirm-column-delete']=button=>{
 const id=button.dataset.id;if(R.data.columns.length<2||!R.data.columns.some(c=>c.id===id))return;
 const result=R.commitChange(()=>{R.data.columns=R.data.columns.filter(c=>c.id!==id);for(const note of R.data.cards)if(note.status===id)note.status=R.data.columns[0].id;R.refreshStatuses();});
 if(result){R.finishColumnEdit();R.toast('Column deleted. Notes kept.');}
};
document.addEventListener('submit',event=>{
 const form=event.target;if(form.id!=='column-form')return;event.preventDefault();const name=form.elements.name.value.trim(),color=form.elements.color.value,id=form.dataset.id;if(!name||!/^#[a-f\d]{6}$/i.test(color))return;
 const result=R.commitChange(()=>{if(id){const column=R.data.columns.find(c=>c.id===id);if(!column)throw Error('This column is no longer available.');Object.assign(column,{name,color});}else R.data.columns.push({id:crypto.randomUUID(),name,color});R.refreshStatuses();});
 if(result){R.finishColumnEdit();R.toast(id?'Column updated':'Column created');}
});
modal.addEventListener('cancel',event=>{if(['column-edit','column-delete'].includes(modalKind)){event.preventDefault();R.finishColumnEdit();}});
R.boardSettings=()=>`<div class="settings-section-intro"><span>${I('board')}</span><div><h4>A workflow that fits you</h4><p>Columns are shared across projects. Open a column to edit its name or color.</p></div></div><div class="board-settings-list">${R.data.columns.map((column,index)=>`<div class="board-setting-row"><span class="column-number">${String(index+1).padStart(2,'0')}</span><strong>${E(column.name)}</strong><div>${R.btn(I('up'),'column-up','icon-button',`data-id="${E(column.id)}" ${index===0?'disabled':''} aria-label="Move ${E(column.name)} left"`)}${R.btn(I('down'),'column-down','icon-button',`data-id="${E(column.id)}" ${index===R.data.columns.length-1?'disabled':''} aria-label="Move ${E(column.name)} right"`)}${R.btn('Edit','edit-column','button secondary',`data-id="${E(column.id)}"`)}</div></div>`).join('')}</div>${R.btn(`${I('plus')}New column`,'add-column','button secondary')}`;

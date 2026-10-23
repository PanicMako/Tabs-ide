import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { Window } from '../../../tabs-app/apps/exchange/node_modules/happy-dom/lib/index.js';
const run=(w,code)=>new Function('scope','with (scope) { '+code+' }')(new Proxy(w,{has:(target,key)=>Reflect.has(target,key)&&Reflect.get(target,key)!==undefined}));
const controls = await readFile(new URL('../../../prototypes/relay/controls.js', import.meta.url), 'utf8');
const welcome = await readFile(new URL('../../../prototypes/relay/welcome.js', import.meta.url), 'utf8');
async function setup(html){const w=new Window({url:'http://localhost'});w.document.body.innerHTML=html;w.R={toast:()=>{}};w.HTMLElement.prototype.scrollIntoView=()=>{};run(w,controls);return w;}

test('custom selection supports keyboard, updates the original form, and handles new fields', async()=>{
 const w=await setup('<form id="example"><label for="view">View</label><select id="view" name="view"><option value="list">List</option><option value="board">Board</option></select></form>');
 try{const d=w.document,source=d.querySelector('select'),trigger=d.querySelector('[role="combobox"]');let changes=0;source.addEventListener('change',()=>changes++);
 expect(source.hidden).toBe(true);trigger.click();trigger.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));trigger.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 expect(source.value).toBe('board');expect(changes).toBe(1);expect(new w.FormData(d.querySelector('form')).get('view')).toBe('board');expect(trigger.getAttribute('aria-expanded')).toBe('false');
 d.querySelector('form').insertAdjacentHTML('beforeend','<select id="later"><option>Later</option></select>');await w.happyDOM.whenAsyncComplete();expect(d.querySelectorAll('[role="combobox"]').length).toBe(2);
 }finally{await w.happyDOM.close();}
});
test('color and date use custom panels while preserving form values',async()=>{
 const w=await setup('<form id="settings"><label>Accent<input name="accent" type="color" value="#3259ed"></label><label>Date<input name="date" type="date" value="2026-10-18"></label></form>');
 try{const d=w.document;expect(d.querySelectorAll('input[type="color"],input[type="date"]').length).toBe(0);
 d.querySelector('.relay-control-color button').click();d.querySelector('button[aria-label="Use #202b44"]').click();expect(new w.FormData(d.querySelector('form')).get('accent')).toBe('#202b44');
 d.querySelector('.relay-control-date button').click();const day=[...d.querySelectorAll('.relay-calendar button')].find(b=>b.textContent==='20');day.click();expect(new w.FormData(d.querySelector('form')).get('date')).toBe('2026-10-20');
 d.querySelector('.relay-control-date button').click();d.querySelector('.relay-control-date button').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(d.querySelector('.relay-control-date button').getAttribute('aria-expanded')).toBe('false');
 }finally{await w.happyDOM.close();}
});
function setupWelcome(){const w=new Window({url:'http://localhost'});w.document.body.innerHTML='<div id="app"></div><dialog id="modal"><div id="modal-content"></div></dialog>';w.modal=w.document.querySelector('dialog');w.modal.showModal=()=>{w.modal.open=true;};w.modal.close=()=>{w.modal.open=false;};w.modalKind='';w.actions={};w.R={data:{prefs:{organization:{}},cards:[{id:'keep-me'}],folders:[{id:'also-keep'}]},ui:{project:'Example',view:''},studio:()=>'<div class="workspace-end"></div>',render:()=>{},btn:(label,action)=>`<button type="button" data-action="${action}">${label}</button>`,modalTop:()=>'',flushInline:()=>{},usesFolders:()=>false,view:()=> 'list',storage:(key,value)=>{w.localStorage.setItem(key,JSON.stringify(value));return true;},read:key=>JSON.parse(w.localStorage.getItem(key)||'null'),save:()=>true,toast:()=>{},showModal:(html,kind)=>{w.modalKind=kind;w.document.querySelector('#modal-content').innerHTML=html;w.modal.open=true;}};run(w,welcome);return w;}
test('welcome choices apply only on finish and preserve notes and folders',async()=>{
 const w=setupWelcome();try{w.R.openWelcome();w.document.querySelector('[data-welcome-organization="folders"]').click();expect(w.R.data.prefs.organization.Example).toBeUndefined();w.actions['welcome-next']();w.document.querySelector('[data-welcome-view="board"]').click();w.actions['welcome-next']();w.actions['welcome-next']();expect(w.R.data.prefs.organization.Example).toBe('folders');expect(w.R.ui.view).toBe('board');expect(w.R.data.cards[0].id).toBe('keep-me');expect(w.R.data.folders[0].id).toBe('also-keep');expect(JSON.parse(w.localStorage.getItem('relay-welcome-v1')).seen).toBe(true);}finally{await w.happyDOM.close();}
});
test('skipping welcome leaves organization and views unchanged',async()=>{const w=setupWelcome();try{w.R.openWelcome();w.document.querySelector('[data-welcome-organization="folders"]').click();w.actions['welcome-skip']();expect(w.R.data.prefs.organization.Example).toBeUndefined();expect(w.R.ui.view).toBe('');expect(w.modal.open).toBe(false);}finally{await w.happyDOM.close();}});

test('appearance follows device, persists manual choice, and board arrows preserve notes',async()=>{
 const w=new Window({url:'http://localhost'});try{
 w.document.body.innerHTML='<div class="header-tools"></div>';let deviceDark=true,listener;w.matchMedia=()=>({get matches(){return deviceDark;},addEventListener:(_,fn)=>listener=fn});w.actions={};w.R={data:{prefs:{},columns:[{id:'one'},{id:'two'}],cards:[{id:'note',status:'one'}]},applyAppearance:()=>{},render:()=>{},feelSettings:()=>'',header:()=>'<div class="header-tools"></div>',btn:()=>'',save:()=>true,refreshStatuses:()=>{},toast:()=>{},reorder:(items,id,delta)=>{const i=items.findIndex(x=>x.id===id);const [item]=items.splice(i,1);items.splice(i+delta,0,item);}};
 run(w,await readFile(new URL('../../../prototypes/relay/ux.js',import.meta.url),'utf8'));
 expect(w.document.body.dataset.appearance).toBe('dark');deviceDark=false;listener();expect(w.document.body.dataset.appearance).toBe('light');w.actions['toggle-appearance']();expect(w.R.data.prefs.appearance).toBe('dark');deviceDark=false;listener();expect(w.document.body.dataset.appearance).toBe('dark');
 w.actions['board-right']({dataset:{id:'one'}});expect(w.R.data.columns.map(c=>c.id)).toEqual(['two','one']);expect(w.R.data.cards).toEqual([{id:'note',status:'one'}]);
 }finally{await w.happyDOM.close();}
});

test('installed Relay follows Tabs live and ignores an older manual theme preference',async()=>{
 const w=new Window({url:'http://localhost'});try{
 let dark=false,onChange;w.E=String;w.I=()=>'';w.tabsExtension={};w.matchMedia=()=>({get matches(){return dark;},addEventListener:(_,fn)=>onChange=fn});w.actions={};w.R={data:{prefs:{appearance:'dark'}},ui:{project:'Example',folder:''},projectMark:()=>'',trail:()=>[],search:()=>'',render:()=>{},feelSettings:()=>'',header:()=>'<div class="header-tools"></div>',btn:()=>'',save:()=>true};
 run(w,await readFile(new URL('../../../prototypes/relay/ux.js',import.meta.url),'utf8'));
 expect(w.document.body.dataset.appearance).toBe('light');expect(w.document.body.dataset.appearanceSource).toBe('tabs');dark=true;onChange();expect(w.document.body.dataset.appearance).toBe('dark');dark=false;onChange();expect(w.document.body.dataset.appearance).toBe('light');expect(w.R.feelSettings()).toContain('Following Tabs');expect(w.R.feelSettings()).not.toContain('data-pref="appearance"');expect(w.R.header()).not.toContain('toggle-appearance');w.actions['toggle-appearance']();expect(w.document.body.dataset.appearance).toBe('light');
 }finally{await w.happyDOM.close();}
});

test('location picker preserves draft contents, validates destinations, and handles storage failure',async()=>{
 const w=new Window({url:'http://localhost'});try{
 w.document.body.innerHTML='<div id="modal-content"></div>';w.modalContent=w.document.querySelector('#modal-content');w.modal=w.document.createElement('dialog');w.modalKind='';w.actions={};w.editingId=null;w.returnToEditor=false;w.editorDraft={id:'draft',project:'One',folder:'',body:'Keep this writing',tags:['important'],values:{next:'Continue here'}};
 let allowSave=true,stored=null,opened=null;w.E=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');w.I=()=>'';
 w.R={data:{projects:['One','Two'],folders:[{id:'folder',name:'Reference',project:'Two',parent:''}]},folder:id=>w.R.data.folders.find(f=>f.id===id),trail:()=>[],projectMark:()=>'',btn:label=>`<button>${label}</button>`,modalTop:()=>'',showModal:html=>{w.modalContent.innerHTML=html;},saveDraft:()=>{},storage:(_,value)=>{if(allowSave)stored=structuredClone(value);return allowSave;},openEditor:id=>{opened=id;},toast:()=>{}};
 run(w,await readFile(new URL('../../../prototypes/relay/location.js',import.meta.url),'utf8'));
 w.actions['note-location']();expect(w.returnToEditor).toBe(true);expect(w.modalContent.textContent).toContain('No folder');
 w.actions['location-choose']({dataset:{project:'One',folder:'folder'}});expect(stored).toBeNull();
 allowSave=false;w.actions['location-choose']({dataset:{project:'Two',folder:'folder'}});expect(w.editorDraft.project).toBe('One');expect(stored).toBeNull();
 allowSave=true;w.actions['location-choose']({dataset:{project:'Two',folder:'folder'}});expect(stored.project).toBe('Two');expect(stored.folder).toBe('folder');expect(stored.body).toBe('Keep this writing');expect(stored.tags).toEqual(['important']);expect(stored.values).toEqual({next:'Continue here'});expect(opened).toBeNull();expect(w.returnToEditor).toBe(false);
 }finally{await w.happyDOM.close();}
});

test('full search matches all words across context and scopes archives and projects',async()=>{
 const w=new Window({url:'http://localhost'});try{
 w.actions={};w.modal=w.document.createElement('dialog');w.R={ui:{project:'One'},search:()=>'',folderLabel:id=>id==='ref'?'References':'',all:()=>[
 {id:'active',title:'Sidebar notes',body:'remember selection',project:'One',folder:'ref',branch:'feature/sidebar',files:['src/picker.ts'],tags:[],values:{},attachments:[{name:'layout.png'}],updated:1,archived:false},
 {id:'other',title:'Selection',body:'sidebar research',project:'Two',folder:'',files:[],tags:[],updated:2,archived:false},
 {id:'old',title:'Sidebar archive',body:'selection',project:'One',folder:'',files:[],tags:[],updated:3,archived:true}
 ]};run(w,await readFile(new URL('../../../prototypes/relay/search.js',import.meta.url),'utf8'));
 expect(w.R.findSearchNotes('sidebar selection').map(n=>n.id)).toEqual(['other','active']);expect(w.R.findSearchNotes('sidebar','project').map(n=>n.id)).toEqual(['active']);expect(w.R.findSearchNotes('sidebar','archive').map(n=>n.id)).toEqual(['old']);expect(w.R.findSearchNotes('picker.ts layout.png').map(n=>n.id)).toEqual(['active']);expect(w.R.findSearchNotes('References feature/sidebar').map(n=>n.id)).toEqual(['active']);expect(w.R.findSearchNotes('missing')).toEqual([]);
 }finally{await w.happyDOM.close();}
});

test('column edits require Save and deleting a column requires confirmation while keeping notes',async()=>{
 const w=new Window({url:'http://localhost'});try{
 w.document.body.innerHTML='<dialog id="modal"><div id="modal-content"></div></dialog>';w.modal=w.document.querySelector('dialog');w.modal.close=()=>{w.modal.open=false;};w.modalKind='';w.E=String;w.I=()=>'';w.actions={};let commits=0;
 w.R={data:{columns:[{id:'one',name:'First',color:'#3259ed'},{id:'two',name:'Second',color:'#3259ed'}],cards:[{id:'note',status:'one'}]},btn:(label,action,cls='',extra='')=>`<button data-action="${action}" ${extra}>${label}</button>`,modalTop:()=>'',showModal:(html,kind)=>{w.modalKind=kind;w.modal.open=true;w.document.querySelector('#modal-content').innerHTML=html;},render:()=>{},toast:()=>{},refreshStatuses:()=>{},customize:()=>{},commitChange:fn=>{commits++;fn();return {result:true};}};
 run(w,await readFile(new URL('../../../prototypes/relay/board.js',import.meta.url),'utf8'));
 w.actions['edit-column']({dataset:{id:'one'}});let form=w.document.querySelector('#column-form');form.elements.name.value='Renamed';expect(w.R.data.columns[0].name).toBe('First');w.actions['column-cancel']();expect(commits).toBe(0);
 w.actions['edit-column']({dataset:{id:'one'}});form=w.document.querySelector('#column-form');form.elements.name.value='Renamed';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));expect(w.R.data.columns[0].name).toBe('Renamed');expect(commits).toBe(1);
 w.actions['remove-column']({dataset:{id:'one'}});expect(w.document.querySelector('#modal-content').textContent).toContain('Delete “Renamed”?');expect(w.R.data.columns.length).toBe(2);w.actions['column-cancel']();expect(w.R.data.cards[0].status).toBe('one');
 w.actions['remove-column']({dataset:{id:'one'}});w.actions['confirm-column-delete']({dataset:{id:'one'}});expect(w.R.data.columns.map(c=>c.id)).toEqual(['two']);expect(w.R.data.cards).toEqual([{id:'note',status:'two'}]);
 }finally{await w.happyDOM.close();}
});

test('template builder includes writing space and adds typed optional fields without creating notes',async()=>{
 const w=new Window({url:'http://localhost'});try{
 w.actions={};w.selectedTemplate='blank';w.E=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');w.I=()=>'';w.R={data:{prefs:{template:'blank'},templates:[{id:'blank',name:'My template',fields:[]}],cards:[{id:'existing',body:'Keep this note'}]},template:id=>w.R.data.templates.find(t=>t.id===id)||w.R.data.templates[0],customField:field=>`<label>${w.E(field.label)}</label><input>`,btn:(label,action,cls='',extra='')=>`<button data-action="${action}" ${extra}>${label}</button>`,customize:()=>{},commitChange:fn=>{fn();return {result:true};}};
 run(w,await readFile(new URL('../../../prototypes/relay/template-builder.js',import.meta.url),'utf8'));
 expect(w.R.templateSettings()).toContain('Your templates');w.actions['template-open']({dataset:{id:'blank'}});expect(w.R.templateSettings()).toContain('Title & writing space');expect(w.R.templateSettings()).toContain('Start writing…');
 w.actions['template-add-field']({dataset:{type:'long'}});w.actions['template-add-field']({dataset:{type:'select'}});expect(w.R.data.templates[0].fields.map(f=>f.type)).toEqual(['long','select']);expect(w.R.data.templates[0].fields[1].options).toBe('Option 1,Option 2');expect(w.R.data.cards).toEqual([{id:'existing',body:'Keep this note'}]);expect(w.R.templatePreviewMarkup(w.R.data.templates[0])).toContain('data-template-drag');
 w.R.data.templates[0].fields[0].label='<script>unsafe</script>';expect(w.R.templatePreviewMarkup(w.R.data.templates[0])).not.toContain('<script>');expect(w.R.templatePreviewMarkup(w.R.data.templates[0])).toContain('&lt;script>');
 w.actions['template-add-field']({dataset:{type:'unsupported'}});expect(w.R.data.templates[0].fields.length).toBe(2);
 }finally{await w.happyDOM.close();}
});

test('checklist supports multiple saved choices and ratings can be clicked and cleared',async()=>{
 const w=new Window({url:'http://localhost'});try{
 w.E=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');w.I=()=>'';w.actions={};w.R={customField:()=>'',value:(note,id)=>note.values?.[id]||'',btn:(label,action,cls='',extra='')=>`<button data-action="${action}" ${extra}>${label}</button>`};run(w,await readFile(new URL('../../../prototypes/relay/rich-fields.js',import.meta.url),'utf8'));
 const field={id:'tasks',label:'Tasks',type:'checklist',options:'Write,Review,Ship'};w.document.body.innerHTML=w.R.customField(field,{values:{}});const boxes=w.document.querySelectorAll('[data-rich-choice]');boxes[0].click();boxes[2].click();const saved=w.document.querySelector('[data-custom-field]').value;expect(saved).toBe('Write\nShip');w.document.body.innerHTML=w.R.customField(field,{values:{tasks:saved}});expect([...w.document.querySelectorAll('[data-rich-choice]:checked')].map(el=>el.value)).toEqual(['Write','Ship']);
 w.document.body.innerHTML=w.R.customField({id:'score',label:'Confidence',type:'rating'},{values:{}});w.document.querySelector('[data-rating-value="4"]').click();expect(w.document.querySelector('[data-custom-field]').value).toBe('4');w.actions['clear-rich-choice'](w.document.querySelector('[data-action="clear-rich-choice"]'));expect(w.document.querySelector('[data-custom-field]').value).toBe('');
 }finally{await w.happyDOM.close();}
});

test('drag reorder keeps stable field IDs and saved answers',async()=>{
 const w=new Window({url:'http://localhost'});try{
 w.actions={};w.selectedTemplate='template';w.R={data:{templates:[{id:'template',fields:[{id:'a'},{id:'b'},{id:'c'}]}],cards:[{values:{a:'First answer',b:'Second answer'}}]},template:()=>w.R.data.templates[0],commitChange:fn=>{fn();return {result:true};},customize:()=>{},toast:()=>{},folderForm:()=>{}};
 run(w,await readFile(new URL('../../../prototypes/relay/template-interactions.js',import.meta.url),'utf8'));
 expect(w.R.moveTemplateField('c','a')).toBe(true);expect(w.R.template().fields.map(f=>f.id)).toEqual(['c','a','b']);expect(w.R.moveTemplateField('c','b',true)).toBe(true);expect(w.R.template().fields.map(f=>f.id)).toEqual(['a','b','c']);expect(w.R.data.cards[0].values).toEqual({a:'First answer',b:'Second answer'});expect(w.R.moveTemplateField('missing','a')).toBe(false);
 }finally{await w.happyDOM.close();}
});

test('template library names before creation, duplicates safely, and deletion preserves existing answers',async()=>{
 const w=new Window({url:'http://localhost'});try{
 w.document.body.innerHTML='<div id="modal-content"></div>';w.selectedTemplate='original';w.actions={};w.E=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');w.I=()=>'';
 let allowSave=true;
 w.R={data:{prefs:{template:'original'},templates:[{id:'original',name:'Project handoff',fields:[{id:'branch',label:'Branch',type:'short'}]}],cards:[{id:'note',template:'original',body:'Keep my writing',values:{branch:'main'}}],folders:[{template:'original'}]},template:id=>w.R.data.templates.find(t=>t.id===id)||w.R.data.templates[0],customField:()=>'',btn:(label,action,cls='',extra='')=>`<button type="button" data-action="${action}" ${extra}>${label}</button>`,modalTop:()=>'',showModal:html=>{w.document.querySelector('#modal-content').innerHTML=html;},customize:()=>{},toast:()=>{},commitChange:fn=>{const before=structuredClone(w.R.data);fn();if(!allowSave){w.R.data=before;return null;}return {result:true};}};
 run(w,await readFile(new URL('../../../prototypes/relay/template-builder.js',import.meta.url),'utf8'));
 expect(w.R.templateSettings()).toContain('Edit Project handoff');expect(w.R.templateSettings()).toContain('Delete Project handoff');expect(w.R.templateSettings()).toContain('Default');
 w.actions['add-template']();expect(w.R.data.templates.length).toBe(1);expect(w.document.querySelector('input').value).toBe('');w.actions['template-cancel']();expect(w.R.data.templates.length).toBe(1);
 const submit=()=>w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 w.actions['add-template']();w.document.querySelector('input').value='  ';submit();expect(w.R.data.templates.length).toBe(1);expect(w.document.querySelector('[role="alert"]').textContent).toContain('name');
 w.document.querySelector('input').value='Weekly review';allowSave=false;submit();expect(w.R.data.templates.length).toBe(1);allowSave=true;submit();expect(w.R.data.templates[1].name).toBe('Weekly review');expect(w.R.data.templates[1].fields).toEqual([]);
 w.actions['duplicate-template']({dataset:{id:'original'}});w.document.querySelector('input').value='Handoff copy';submit();const copy=w.R.data.templates[2];expect(copy.name).toBe('Handoff copy');expect(copy.fields[0].id).not.toBe('branch');expect(copy.fields[0].label).toBe('Branch');
 w.actions['remove-template']({dataset:{id:'original'}});expect(w.R.data.templates.length).toBe(3);expect(w.document.body.textContent).toContain('Delete “Project handoff”');w.actions['template-cancel']();expect(w.R.data.templates.length).toBe(3);
 w.actions['remove-template']({dataset:{id:'original'}});allowSave=false;w.actions['template-confirm-delete']();expect(w.R.data.templates.length).toBe(3);allowSave=true;w.actions['template-confirm-delete']();expect(w.R.data.templates.length).toBe(2);expect(w.R.data.cards[0].values.branch).toBe('main');expect(w.R.data.cards[0].body).toBe('Keep my writing');expect(w.R.data.retiredFields.branch.label).toBe('Branch');expect(w.R.data.folders[0].template).toBe('');expect(w.R.data.prefs.template).toBe(w.R.data.templates[0].id);
 for(const template of [...w.R.data.templates]){w.actions['remove-template']({dataset:{id:template.id}});w.actions['template-confirm-delete']();}
 expect(w.R.data.templates.length).toBe(1);expect(w.R.data.templates[0].name).toBe('Blank note');expect(w.R.data.cards[0].values.branch).toBe('main');
 }finally{await w.happyDOM.close();}
});

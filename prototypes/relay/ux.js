/* Appearance follows the device unless the reader chooses otherwise. */
const relayDarkQuery=window.matchMedia('(prefers-color-scheme: dark)');
const relayRunsInTabs=!!window.tabsExtension;
R.applyAppearance=()=>{const preference=relayRunsInTabs?'system':R.data.prefs.appearance||'system';document.body.dataset.appearance=preference==='system'?(relayDarkQuery.matches?'dark':'light'):preference;document.body.dataset.appearanceSource=relayRunsInTabs?'tabs':preference==='system'?'device':'preview';};
relayDarkQuery.addEventListener('change',R.applyAppearance);
const relayRenderAppearance=R.render;
R.render=()=>{R.applyAppearance();relayRenderAppearance();};
const relayFeelSettings=R.feelSettings;
R.feelSettings=()=>relayRunsInTabs?`<div class="preference-line"><div><strong>Theme</strong><p>Follows Tabs automatically. Change your theme in Tabs Settings.</p></div><span class="theme-follow-label">Following Tabs</span></div>${relayFeelSettings()}`:`<div class="preference-line"><div><strong>Preview theme</strong><p>In the installed extension, Relay follows Tabs automatically.</p></div><select data-pref="appearance" aria-label="Appearance">${[['system','Use device setting'],['light','Light'],['dark','Dark']].map(([value,label])=>`<option value="${value}" ${(R.data.prefs.appearance||'system')===value?'selected':''}>${label}</option>`).join('')}</select></div>${relayFeelSettings()}`;
R.header=()=>`<header class="workspace-header balanced-header"><div class="header-path">${R.btn(I('menu'),'toggle-sidebar','icon-button mobile-only','aria-label="Open navigation"')}<button class="header-project" data-action="project-switcher" aria-label="Switch project: ${E(R.ui.project)}">${R.projectMark(R.ui.project)}<span>${E(R.ui.project)}</span>${I('down')}</button>${R.trail(R.ui.folder).map(f=>`<span>/</span><button data-folder="${E(f.id)}">${E(f.name)}</button>`).join('')}</div><div class="header-search">${R.search()}</div><div class="header-tools">${R.btn(I('settings'),'customize','icon-button','aria-label="Settings"')}${!relayRunsInTabs?R.btn(I(document.body.dataset.appearance==='dark'?'sun':'moon'),'toggle-appearance','icon-button',`aria-label="Switch to ${document.body.dataset.appearance==='dark'?'light':'dark'} mode"`):''}</div></header>`;
R.paths ||= {};
R.paths.sun='M12 3V1m0 22v-2M3 12H1m22 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0';
actions['toggle-appearance']=()=>{if(relayRunsInTabs)return;R.data.prefs.appearance=document.body.dataset.appearance==='dark'?'light':'dark';R.save();R.render();};
for(const [action,delta] of [['board-left',-1],['board-right',1]])actions[action]=b=>{R.reorder(R.data.columns,b.dataset.id,delta);R.refreshStatuses();R.save();R.render();document.querySelector(`.lane-name[data-column-name="${b.dataset.id}"]`)?.focus();R.toast('Column moved');};
document.addEventListener('change',event=>{const el=event.target;if(el.matches('.lane-name')){const column=R.data.columns.find(c=>c.id===el.dataset.columnName);if(column){column.name=el.value.trim()||'Untitled column';el.value=column.name;R.refreshStatuses();R.save();}}});
document.addEventListener('keydown',event=>{if(event.target.matches('.lane-name')&&event.key==='Enter'){event.preventDefault();event.target.blur();}if((event.metaKey||event.ctrlKey)&&event.key==='Enter'&&modal.open&&modalKind==='editor'){event.preventDefault();document.querySelector('#note-form')?.requestSubmit();}});
R.applyAppearance();
R.render();

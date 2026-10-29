// Native extension presentation; browser profile storage is intentionally used
// instead of requesting workspace, network, credentials, or AI permissions.
R.date = (time, options={day:'numeric',month:'long'}) => new Intl.DateTimeFormat(undefined,options).format(time);
const localSidebar = R.sidebar;
R.sidebar = () => localSidebar().replace('Yours, in this browser.', 'Local to your Tabs profile.');
const localDataSettings = R.dataSettings;
R.dataSettings = () => localDataSettings().replaceAll('in this browser','in your Tabs profile').replace('there is no account or cloud sync in this prototype','there is no cloud sync');
// Tabs does not expose a file-save broker. Offer a reliable text export that
// remains usable when the host blocks blob downloads or clipboard permission.
R.download = (text, name) => {
  const html=`${R.modalTop('TAKE YOUR WORDS WITH YOU')}<h2 id="modal-title">${E(name)}</h2><p class="modal-intro">Select and copy this export into a file on your computer. For backups, keep the .json filename so Relay can restore it later.</p><textarea id="relay-export-text" class="backup-text" readonly aria-label="Export contents">${E(text)}</textarea><div class="dialog-actions">${R.btn('Copy export','copy-relay-export','button primary')}${R.btn('Select all','select-relay-export','button secondary')}</div><p class="settings-help">Tabs does not currently provide extensions with a native file-save API. Copying keeps this export available without extra permissions.</p>`;
  R.showModal(html,'export');
};
actions['select-relay-export']=()=>{const input=document.querySelector('#relay-export-text');input.focus();input.select();R.toast('Selected. Press your copy shortcut, then save to a file.');};
actions['copy-relay-export']=async()=>{const input=document.querySelector('#relay-export-text');try{await navigator.clipboard.writeText(input.value);R.toast('Export copied. Save it to a file on your computer.');}catch{input.focus();input.select();R.toast('Press your copy shortcut to copy the selected export.');}};
// Clear feedback for non-image attachment downloads unsupported by the host.
const showAttachment=actions['open-attachment'];
actions['open-attachment']=async button=>{await R.filesReady;const file=await R.getFile(button.dataset.fileId);if(file&&!/^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,/i.test(file.src)){if(modalKind==='editor')R.saveDraft();R.showModal(`${R.modalTop('KEPT WITH YOUR NOTE')}<h2 id="modal-title">${E(file.name)}</h2><p class="modal-intro">This file is stored with your note and included in full backups. This version of Tabs does not provide an extension file-save API.</p>`,'attachment');return;}return showAttachment(button);};
R.research=()=>R.showModal(`${R.modalTop('RELAY · 0.1.0')}<h2 id="modal-title">A place to keep going.</h2><p class="modal-intro">Keep the thought behind your work: what you tried, what comes next, and anything you want to remember.</p><p class="settings-help">Notes, logos, attachments, and Trash stay in this extension’s browser storage in your assigned Tabs profile. A shared profile shares its notebook across Tabs projects; choose a project-isolated profile in Tabs to keep them apart. Relay has no remote service, telemetry, or editor/file access.</p>`,'about');
actions.research=R.research;
R.render();

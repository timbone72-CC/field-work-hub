/* Presentation state only. Server RLS and existing dispatch RPCs own authority. */
const JobViewRules = {
  normalize(value = {}) {
    return { size: value.size === 50 ? 50 : 25,
      sort: ['created_at.desc', 'due_date.asc', 'due_date.desc'].includes(value.sort) ? value.sort : 'created_at.desc',
      status: ['ASSIGNED', 'IN_PROGRESS', 'FIELD_COMPLETE', 'CANCELLED'].includes(value.status) ? value.status : '' };
  },
  parameters(state) {
    const prefs = this.normalize(state);
    const offset = Number(state.offset);
    const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const query = new URLSearchParams({ limit: String(prefs.size), offset: String(safeOffset),
      order: `${prefs.sort}.nullslast,id.asc` });
    if (prefs.status) query.set('field_status', `eq.${prefs.status}`);
    // Optional filters are server-side, from fixed columns and bounded values.
    const contractor=String(state.contractor || '');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contractor))
      query.set('assigned_user_id',`eq.${contractor}`);
    const due=String(state.dueDate || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      const parsed = new Date(due+'T00:00:00Z');
      // Date.parse normalizes impossible dates (for example February 31).
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10) === due)
        query.set('due_date',`eq.${due}`);
    }
    // Escape PostgREST pattern metacharacters; column and operator are never user supplied.
    const text = String(state.search || '').trim().slice(0, 160);
    if (text) query.set(state.searchField === 'wo_number' ? 'wo_number' : 'property_address',
      `ilike.*${text.replace(/[\\%_*]/g, '\\$&')}*`);
    return query;
  },
  total(header) {
    const match = /^(?:\d+-\d+|\*)\/(\d+)$/.exec(header || '');
    const count = match ? Number(match[1]) : NaN;
    return Number.isSafeInteger(count) ? count : null;
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports = JobViewRules;


// Phase 6A: conservative operational state from fields actually returned by
// the current server page. Unknown private-photo/review/delivery facts never
// become a fabricated "Ready", "Completed" or "Awaiting review" status.
const JobOperationalFacts = {
  project(row) {
    if (!row || typeof row !== 'object') return {label:'Status unavailable',next:'Open details',panel:'details'};
    if (row.pending_assignee_user_id) return {
      label:'Reassignment pending',next:'View assignment',panel:'assignment'};
    switch (row.field_status) {
      case 'ASSIGNED':
        if (!row.assigned_user_id) return {label:'Needs assignment',next:'Assign',panel:'assignment'};
        return row.assignment_received_at
          ? {label:'Assignment downloaded — human Accept not established',next:'View assignment',panel:'assignment'}
          : {label:'Awaiting delivery receipt',next:'View assignment',panel:'assignment'};
      case 'IN_PROGRESS': return {label:'In progress',next:'Open details',panel:'details'};
      case 'FIELD_COMPLETE': return {label:'Field complete — review and delivery status not loaded',
        next:'Check photos',panel:'photos'};
      case 'CANCELLED': return {label:'Cancelled',next:'Open details',panel:'details'};
      default: return {label:'Status unavailable',next:'Open details',panel:'details'};
    }
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports.JobOperationalFacts = JobOperationalFacts;

// Exact address grouping is only navigation within an already-authorized page.
// It never joins different companies, guesses unit equivalence, or expands RLS.
const JobAddressContext = {
  siblings(rows, selected) {
    if (!Array.isArray(rows) || !selected?.organization_id || !selected?.client_company_id
      || typeof selected.property_address!=='string') return [];
    const address=selected.property_address.trim().replace(/\s+/g,' ').toLowerCase();
    if (!address) return [];
    return rows.filter(row=>row?.organization_id===selected.organization_id
      && row.client_company_id===selected.client_company_id
      && typeof row.property_address==='string'
      && row.property_address.trim().replace(/\s+/g,' ').toLowerCase()===address
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id||''));
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports.JobAddressContext=JobAddressContext;

/* Phase 6A: bounded next/previous within the selected server result set.
 * Unknown totals do not authorize speculative next-page selection. */
const JobResultNavigation = {
  step(rows, id, delta, pageSize = 25) {
    if (!Array.isArray(rows) || !id || ![-1,1].includes(delta)) return null;
    const index=rows.findIndex(row=>row?.id===id);
    if(index<0)return null;
    const adjacent=rows[index+delta];
    if(adjacent?.id)return {kind:'job',id:adjacent.id};
    const offset=rows.page?.offset, total=rows.page?.total;
    if(!Number.isSafeInteger(offset)||offset<0||![25,50].includes(pageSize))return null;
    if(delta<0 && index===0 && offset>0)
      return {kind:'page',offset:Math.max(0,offset-pageSize),delta};
    if(delta>0 && index===rows.length-1 && Number.isSafeInteger(total)
      && total>offset+rows.length && rows.length===pageSize)
      return {kind:'page',offset:offset+pageSize,delta};
    return null;
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports.JobResultNavigation=JobResultNavigation;

const JobWorkspace = (() => {
  let account = '', state = { ...JobViewRules.normalize(), offset: 0, search: '', searchField: 'property_address',contractor:'',dueDate:'' };
  let revision = 0, selection = 0, baseline = null, pending = null, selectedRow = null, needsReload = false;
  let returnFocusId = null, addressLookupEpoch=0, addressRows=[], addressTotal=null, addressOffset=0;
  const el = id => document.getElementById(id);
  const JOB_VIEW_STORAGE_KEY = () => `fwh.jobView.${account}`;
  function ensureAccount(user) {
    const key = `${user?.app_metadata?.organization_id || ''}.${user?.id || ''}`;
    if (account === key) return;
    reset(); account = key;
    try { state = { ...state, ...JobViewRules.normalize(JSON.parse(localStorage.getItem(JOB_VIEW_STORAGE_KEY()) || '{}')) }; } catch { /* Optional preference. */ }
    controls();
  }
  function controls() {
    el('job-page-size').value = state.size; el('job-sort').value = state.sort;
    el('job-status').value = state.status; el('job-search').value = state.search;
    el('job-search-field').value = state.searchField;
    el('job-contractor').value=state.contractor || '';
    el('job-due-date').value=state.dueDate || '';
  }
  function populateContractors(users=[]) {
    const select=el('job-contractor');
    const previous=state.contractor || '';
    select.replaceChildren(new Option('All contractors',''));
    for (const user of users) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user?.user_id||''))
        select.add(new Option(String(user.email||'Contractor'),user.user_id));
    }
    if (previous && ![...select.options].some(option=>option.value===previous)) {
      // A revoked/removed contractor must not remain a silently active filter.
      state.contractor='';
    }
    select.value=state.contractor;
  }
  function fingerprint() {
    return JSON.stringify([['edit-wo-number', 'edit-property-address', 'edit-work-type', 'edit-instructions',
      'edit-due-date', 'edit-assignee'].map(id => el(id).value), editPhotos.value]);
  }
  function detailsDirty() { return baseline !== null && fingerprint() !== baseline; }
  function dirty() { return detailsDirty() || !!ClientRelease.dirty() || !!CorrectionDraft.dirty(); }
  function reset() {
    PrivateReview.reset(); ClientRelease.reset(); CorrectionDraft.reset(); FollowupManagement.reset(); ReleaseHistory.reset();
    revision++; selection++; account = ''; baseline = null; pending = null; selectedRow = null; needsReload = false;
    returnFocusId = null; addressLookupEpoch++; addressRows=[]; addressTotal=null; addressOffset=0;
    state = { ...JobViewRules.normalize(), offset: 0, search: '', searchField: 'property_address', contractor:'',dueDate:'' };
  }
  function request() { return { ...state, revision }; }
  function accept(page) {
    if (page?.revision !== undefined && page.revision !== revision) throw new Error('The job view changed.');
  }
  function page(rows) {
    accept(rows.page);
    const info = rows.page || { offset: state.offset, total: null };
    el('job-page-info').textContent = rows.length
      ? `${info.offset + 1}–${info.offset + rows.length}${info.total === null ? ' (total unavailable)' : ` of ${info.total}`} jobs`
      : `No jobs on this page${info.total ? ` (${info.total} match; choose Previous)` : ''}.`;
    el('job-page-previous').disabled = state.offset === 0;
    el('job-page-next').disabled = info.total === null ? rows.length < state.size : state.offset + rows.length >= info.total;
    el('job-list-status').textContent = '';
    navigation();
  }
  async function change(offset, keepResultFilters=false) {
    if (adminWritesPending || saveEditButton.disabled) return false;
    const previous=state;
    state = keepResultFilters ? {...state,offset} :
      { ...state, size: Number(el('job-page-size').value), sort: el('job-sort').value,
        status: el('job-status').value, search: el('job-search').value.trim(), searchField: el('job-search-field').value,
        contractor:el('job-contractor').value,dueDate:el('job-due-date').value, offset };
    revision++;
    try { localStorage.setItem(JOB_VIEW_STORAGE_KEY(), JSON.stringify(JobViewRules.normalize(state))); } catch { /* Optional preference. */ }
    const ownRevision = revision;
    el('job-list-status').textContent = 'Loading jobs…';
    el('job-page-previous').disabled = true; el('job-page-next').disabled = true;
    try {
      await refreshWorkOrders();
      return ownRevision===revision;
    } catch (error) {
      if (ownRevision===revision && accessToken) {
        // A failed page read cannot silently change the active result-set
        // offset while the selected job still belongs to the old page.
        state=previous;revision++;
        el('job-list-status').textContent = `${error.message} Showing the last received page. Apply to retry.`;
        navigation();
      }
      return false;
    }
  }
  function guard(action) {
    if (saveEditButton.disabled) return;
    if (!dirty()) { action(); return; }
    pending = action; el('job-unsaved').hidden = false; el('job-stay').focus();
  }
  async function choose(id) {
    if (!selectedRow) returnFocusId=id;
    guard(() => load(id));
  }
  async function load(id) {
    const ownSelection = ++selection;
    const startingEdit = fingerprint();
    el('job-list-status').textContent = 'Opening job…';
    try {
      const row = await fetchWorkOrder(id);
      if (ownSelection !== selection || !accessToken) return;
      if (saveEditButton.disabled) return;
      const open = () => { if (ownSelection === selection && accessToken) openEditor(id, row); };
      if (fingerprint() !== startingEdit) guard(open); else open();
      el('job-list-status').textContent = '';
    } catch (error) {
      if (ownSelection === selection && accessToken) el('job-list-status').textContent = error.message;
    }
  }
  function addressContext() {
    const list=el('job-address-work-orders');
    list.replaceChildren();
    const matches=JobAddressContext.siblings(addressRows,selectedRow);
    el('job-address-context').hidden=!selectedRow;
    el('job-address-status').textContent=addressTotal===null ? 'Load this address to see matching jobs.' : `${addressTotal} exact-address jobs (showing ${matches.length} on this page)`;
    el('job-address-next').disabled=addressTotal===null || addressOffset+50>=addressTotal;
    el('job-address-previous').disabled=addressOffset===0;
    for (const item of matches) {
      const button=document.createElement('button');
      button.type='button'; button.className='secondary';
      button.textContent=String(item.wo_number||'Work order');
      button.setAttribute('aria-label',`Open work order ${item.wo_number}`);
      button.setAttribute('aria-current',String(item.id===selectedRow.id));
      button.disabled=item.id===selectedRow.id;
      button.addEventListener('click',()=>choose(item.id));
      list.append(button);
    }
  }
  async function loadAddressContext(offset=0) {
    if (!selectedRow || !accessToken) return;
    const row=selectedRow, epoch=++addressLookupEpoch;
    el('job-address-status').textContent='Loading exact-address work orders…';
    try {
      const result=await fetchAddressWorkOrders(row,offset);
      if (epoch!==addressLookupEpoch || !accessToken || selectedRow?.id!==row.id) return;
      addressRows=result.rows; addressTotal=result.total; addressOffset=offset;
      addressContext();
    } catch (error) {
      if (epoch===addressLookupEpoch && selectedRow?.id===row.id)
        el('job-address-status').textContent=error.message;
    }
  }
  function navigation() {
    const index = workOrderRows.findIndex(row => row.id === selectedRow?.id);
    const previous=JobResultNavigation.step(workOrderRows,selectedRow?.id,-1,state.size);
    const next=JobResultNavigation.step(workOrderRows,selectedRow?.id,1,state.size);
    el('job-previous').disabled = !previous;
    el('job-next').disabled = !next;
    const offset = workOrderRows.page?.offset ?? state.offset;
    const total = workOrderRows.page?.total;
    let context = '';
    if (selectedRow && index < 0) {
      context = 'This job is outside the current page or filter. Your workspace remains open.';
    } else if (index >= 0 && index === workOrderRows.length - 1) {
      context = total !== null && total !== undefined && offset + workOrderRows.length >= total
        ? 'End of current results.'
        : next ? 'Next opens the following result page.' :
          'End of this page. Use Next page in the job list for more results.';
    } else if (index === 0 && offset > 0) {
      context = 'Previous opens the preceding result page.';
    }
    el('job-context').textContent = context;
    addressContext();
  }
  function opened(row) {
    selectedRow = row; needsReload = false; pending = null; baseline = fingerprint();
    addressLookupEpoch++; addressRows=[];addressTotal=null;addressOffset=0;
    el('job-unsaved').hidden = true;
    el('edit-heading').textContent = row.wo_number;
    el('job-address').textContent = row.property_address;
    el('job-facts').textContent = `${row.work_type} · ${row.field_status.replaceAll('_', ' ')} · Due ${row.due_date}`;
    const operational = JobOperationalFacts.project(row);
    el('job-next-action').textContent = operational.label + ' · ' + operational.next;
    el('job-next-action-open').textContent = operational.next;
    el('job-next-action-open').dataset.panel = operational.panel;
    el('job-receipt').textContent = row.assignment_received_at
      ? `Assignment received ${formatTimestamp(row.assignment_received_at)}` : 'Assignment not yet received';
    el('job-reload').hidden = true;
    PrivateReview.reset(); ClientRelease.reset(); CorrectionDraft.reset(); FollowupManagement.reset(); ReleaseHistory.reset();
    tab('details');
    if (!editSection.open) editSection.showModal();
    navigation();
  }
  function tab(name) {
    document.querySelectorAll('[data-job-panel]').forEach(panel => { panel.hidden = panel.dataset.jobPanel !== name; });
    saveEditButton.hidden = name === 'photos' || name === 'delivery' || name === 'history';
    if (name === 'photos' && selectedRow?.id) {
      PrivateReview.open(selectedRow.id,selectedRow.current_run_id);
      ClientRelease.open(selectedRow.id,name);
      CorrectionDraft.open(selectedRow.id, selectedRow.field_status, selectedRow.client_company_id);
      FollowupManagement.open(selectedRow.id, selectedRow.field_status);
    }
    if (name === 'delivery' && selectedRow?.id) ClientRelease.open(selectedRow.id, name);
    if (name === 'history' && selectedRow?.id) ReleaseHistory.open(selectedRow.id);
    document.querySelectorAll('[data-job-tab]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.jobTab === name));
    });
  }
  function closed() {
    PrivateReview.reset(); ClientRelease.reset(); CorrectionDraft.reset(); FollowupManagement.reset(); ReleaseHistory.reset();
    selection++; baseline = null; selectedRow = null; pending = null; needsReload = false;
    addressLookupEpoch++;addressRows=[];addressTotal=null;addressOffset=0;
    el('job-unsaved').hidden = true;
    if (editSection.open) editSection.close();
    const id=returnFocusId;
    returnFocusId=null;
    if (id) {
      const button=[...document.querySelectorAll('[data-job-open-id]')].find(node=>node.dataset.jobOpenId===id);
      if (button && button.isConnected) button.focus();
      else el('job-search').focus();
    }
  }
  function saved() { baseline = fingerprint(); needsReload = true; el('job-reload').hidden = false; }
  async function reconcileSaved(id) {
    const destination = pending;
    const row = await fetchWorkOrder(id);
    openEditor(id, row);
    return destination;
  }
  function refreshed(rows) {
    page(rows);
    const row = rows.find(item => item.id === selectedRow?.id);
    if (row && JSON.stringify(row) !== JSON.stringify(selectedRow)) {
      setEditStatus('This job changed on the server. Your edits were kept. Reload before making further changes.', false);
      needsReload = true;
      el('job-reload').hidden = false;
    }
  }

  function move(delta) {
    const target=JobResultNavigation.step(workOrderRows,selectedRow?.id,delta,state.size);
    if(!target)return;
    if(target.kind==='job'){choose(target.id);return;}
    // Use the same unsaved-change decision as ordinary WO navigation.
    guard(async()=>{
      const actor=currentUser?.id,org=currentUser?.app_metadata?.organization_id;
      const token=accessToken,selected=selectedRow?.id;
      if(!token||!actor||!org||!selected)return;
      const success=await change(target.offset,true);
      if(!success||!accessToken||accessToken!==token||currentUser?.id!==actor
        ||currentUser?.app_metadata?.organization_id!==org ||selectedRow?.id!==selected)return;
      if(workOrderRows.page?.offset!==target.offset)return;
      const candidate=target.delta>0?workOrderRows[0]:workOrderRows.at(-1);
      if(candidate?.id)await choose(candidate.id);
      else el('job-list-status').textContent='No further matching jobs on this page.';
    });
  }
  function init() {
    CorrectionDraft.init(); FollowupManagement.init(); PrivateReview.init(); ClientRelease.init(); ReleaseHistory.init();
    el('job-address-load').addEventListener('click',()=>loadAddressContext(0));
    el('job-address-next').addEventListener('click',()=>loadAddressContext(addressOffset+50));
    el('job-address-previous').addEventListener('click',()=>loadAddressContext(Math.max(0,addressOffset-50)));
    el('job-filters').addEventListener('submit', event => { event.preventDefault(); change(0); });
    el('job-clear-filters').addEventListener('click', () => {
      if (adminWritesPending || saveEditButton.disabled) return;
      el('job-search').value='';
      el('job-search-field').value='property_address';
      el('job-status').value='';
      el('job-contractor').value='';
      el('job-due-date').value='';
      el('job-sort').value='created_at.desc';
      el('job-page-size').value=25;
      change(0);
    });
    el('job-page-previous').addEventListener('click', () => change(Math.max(0, state.offset - state.size)));
    el('job-page-next').addEventListener('click', () => change(state.offset + state.size));
    for (const [id, delta] of [['job-previous', -1], ['job-next', 1]])
      el(id).addEventListener('click', () => move(delta));
    document.querySelectorAll('[data-job-tab]').forEach(button => button.addEventListener('click', () => tab(button.dataset.jobTab)));
    el('job-next-action-open').addEventListener('click', () => tab(el('job-next-action-open').dataset.panel || 'details'));
    editSection.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
    el('job-stay').addEventListener('click', () => { pending = null; el('job-unsaved').hidden = true; });
    el('job-discard').addEventListener('click', () => { const action = pending; pending = null; el('job-unsaved').hidden = true; if (action) action(); });
    el('job-save-continue').addEventListener('click', async () => {
      if (CorrectionDraft.dirty()) {
        const saved=await CorrectionDraft.save();
        if (!saved) { setEditStatus('Correction draft is not saved. Stay on this job to resolve.',true);return; }
        if (!dirty() && pending) {
          const action=pending;pending=null;el('job-unsaved').hidden=true;action();
        } else setEditStatus('Correction saved. Save other changes before leaving this job.',false);
      } else if (ClientRelease.dirty()) {
        const result=await ClientRelease.saveDraft();
        if (result && !dirty() && pending) {
          const action=pending;pending=null;el('job-unsaved').hidden=true;action();
        } else if (!result) setEditStatus('Package changes were not saved; remain on this job to resolve.',true);
      } else editForm.requestSubmit();
    });
    el('job-reload').addEventListener('click', () => guard(() => load(editWorkOrderIdInput.value)));
    editForm.addEventListener('invalid', event => {
      const panel = event.target.closest('[data-job-panel]'); if (panel) tab(panel.dataset.jobPanel);
    }, true);
    window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
  }
  return { init, ensureAccount, request, accept, page, choose, guard, opened, closed, reset, dirty, saved,
    reconcileSaved, refreshed, populateContractors, detailsDirty, dirty, needsReload: () => needsReload };
})();

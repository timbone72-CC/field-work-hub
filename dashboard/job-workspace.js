/* Presentation state only. Server RLS and existing dispatch RPCs own authority. */
const JobViewRules = {
  normalize(value = {}) {
    return { size: value.size === 50 ? 50 : 25,
      sort: ['created_at.desc', 'due_date.asc'].includes(value.sort) ? value.sort : 'created_at.desc',
      status: ['ASSIGNED', 'IN_PROGRESS', 'FIELD_COMPLETE', 'CANCELLED'].includes(value.status) ? value.status : '' };
  },
  parameters(state) {
    const prefs = this.normalize(state);
    const query = new URLSearchParams({ limit: String(prefs.size), offset: String(state.offset || 0),
      order: `${prefs.sort}.nullslast,id.asc` });
    if (prefs.status) query.set('field_status', `eq.${prefs.status}`);
    // Escape PostgREST pattern metacharacters; column and operator are never user supplied.
    const text = String(state.search || '').trim().slice(0, 160);
    if (text) query.set(state.searchField === 'wo_number' ? 'wo_number' : 'property_address',
      `ilike.*${text.replace(/[\\%_*]/g, '\\$&')}*`);
    return query;
  },
  total(header) {
    const match = /^(?:\d+-\d+|\*)\/(\d+)$/.exec(header || '');
    return match ? Number(match[1]) : null;
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports = JobViewRules;

const JobWorkspace = (() => {
  let account = '', state = { ...JobViewRules.normalize(), offset: 0, search: '', searchField: 'property_address' };
  let revision = 0, selection = 0, baseline = null, pending = null, selectedRow = null, needsReload = false;
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
  }
  function fingerprint() {
    return JSON.stringify([['edit-wo-number', 'edit-property-address', 'edit-work-type', 'edit-instructions',
      'edit-due-date', 'edit-assignee'].map(id => el(id).value), editPhotos.value]);
  }
  function dirty() { return baseline !== null && fingerprint() !== baseline; }
  function reset() {
    PrivateReview.reset();
    revision++; selection++; account = ''; baseline = null; pending = null; selectedRow = null; needsReload = false;
    state = { ...JobViewRules.normalize(), offset: 0, search: '', searchField: 'property_address' };
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
  async function change(offset) {
    if (adminWritesPending || saveEditButton.disabled) return;
    state = { ...state, size: Number(el('job-page-size').value), sort: el('job-sort').value,
      status: el('job-status').value, search: el('job-search').value.trim(), searchField: el('job-search-field').value, offset };
    revision++;
    try { localStorage.setItem(JOB_VIEW_STORAGE_KEY(), JSON.stringify(JobViewRules.normalize(state))); } catch { /* Optional preference. */ }
    const ownRevision = revision;
    el('job-list-status').textContent = 'Loading jobs…';
    el('job-page-previous').disabled = true; el('job-page-next').disabled = true;
    try { await refreshWorkOrders(); }
    catch (error) {
      if (ownRevision === revision && accessToken) el('job-list-status').textContent = `${error.message} Showing the last received page. Apply to retry.`;
    }
  }
  function guard(action) {
    if (saveEditButton.disabled) return;
    if (!dirty()) { action(); return; }
    pending = action; el('job-unsaved').hidden = false; el('job-stay').focus();
  }
  async function choose(id) {
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
  function navigation() {
    const index = workOrderRows.findIndex(row => row.id === selectedRow?.id);
    el('job-previous').disabled = index <= 0;
    el('job-next').disabled = index < 0 || index >= workOrderRows.length - 1;
    el('job-context').textContent = selectedRow && index < 0 ? 'This job is outside the current page or filter. Your workspace remains open.' : '';
  }
  function opened(row) {
    selectedRow = row; needsReload = false; pending = null; baseline = fingerprint();
    el('job-unsaved').hidden = true;
    el('edit-heading').textContent = row.wo_number;
    el('job-address').textContent = row.property_address;
    el('job-facts').textContent = `${row.work_type} · ${row.field_status.replaceAll('_', ' ')} · Due ${row.due_date}`;
    el('job-receipt').textContent = row.assignment_received_at
      ? `Assignment received ${formatTimestamp(row.assignment_received_at)}` : 'Assignment not yet received';
    el('job-reload').hidden = true;
    PrivateReview.reset();
    tab('details');
    if (!editSection.open) editSection.showModal();
    navigation();
  }
  function tab(name) {
    document.querySelectorAll('[data-job-panel]').forEach(panel => { panel.hidden = panel.dataset.jobPanel !== name; });
    saveEditButton.hidden = name === 'photos';
    if (name === 'photos' && selectedRow?.id) PrivateReview.open(selectedRow.id);
    document.querySelectorAll('[data-job-tab]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.jobTab === name));
    });
  }
  function closed() {
    PrivateReview.reset();
    selection++; baseline = null; selectedRow = null; pending = null; needsReload = false;
    el('job-unsaved').hidden = true;
    if (editSection.open) editSection.close();
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
  function init() {
    PrivateReview.init();
    el('job-filters').addEventListener('submit', event => { event.preventDefault(); change(0); });
    el('job-page-previous').addEventListener('click', () => change(Math.max(0, state.offset - state.size)));
    el('job-page-next').addEventListener('click', () => change(state.offset + state.size));
    for (const [id, delta] of [['job-previous', -1], ['job-next', 1]]) el(id).addEventListener('click', () => {
      const index = workOrderRows.findIndex(row => row.id === selectedRow?.id);
      if (index >= 0 && workOrderRows[index + delta]) choose(workOrderRows[index + delta].id);
    });
    document.querySelectorAll('[data-job-tab]').forEach(button => button.addEventListener('click', () => tab(button.dataset.jobTab)));
    editSection.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
    el('job-stay').addEventListener('click', () => { pending = null; el('job-unsaved').hidden = true; });
    el('job-discard').addEventListener('click', () => { const action = pending; pending = null; el('job-unsaved').hidden = true; if (action) action(); });
    el('job-save-continue').addEventListener('click', () => editForm.requestSubmit());
    el('job-reload').addEventListener('click', () => guard(() => load(editWorkOrderIdInput.value)));
    editForm.addEventListener('invalid', event => {
      const panel = event.target.closest('[data-job-panel]'); if (panel) tab(panel.dataset.jobPanel);
    }, true);
    window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
  }
  return { init, ensureAccount, request, accept, page, choose, guard, opened, closed, reset, dirty, saved,
    reconcileSaved, refreshed, needsReload: () => needsReload };
})();

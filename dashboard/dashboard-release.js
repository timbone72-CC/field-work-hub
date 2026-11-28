// Release discovery is independent of work-data polling and never changes Auth.
const DashboardRelease = (() => {
  const revision = document.querySelector('meta[name="fwh-dashboard-build"]')?.content || '';
  const validRevision = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
  const status = document.getElementById('dashboard-release-status');
  const reload = document.getElementById('dashboard-release-reload');
  const help = document.getElementById('dashboard-release-help');
  const interval = 60_000;
  let target = null, timer = null, flight = null;
  const online = () => !document.hidden && navigator.onLine !== false;
  const short = value => value.slice(0, 8);
  function show(message = '') {
    const build = validRevision(revision) ? 'Dashboard build ' + short(revision) : 'Dashboard source build';
    status.textContent = build + (message ? ' — ' + message : '');
    reload.hidden = !target;
    help.hidden = !target;
  }
  function schedule(delay = interval) {
    clearTimeout(timer);
    timer = null;
    if (online() && validRevision(revision)) timer = setTimeout(check, delay);
  }
  async function check() {
    clearTimeout(timer);
    timer = null;
    if (!online() || !validRevision(revision)) return;
    if (flight) return flight;
    flight = (async () => {
      try {
        const url = new URL('dashboard-release.json', document.baseURI);
        if (url.origin !== window.location.origin) throw Error('Unexpected release origin');
        url.searchParams.set('check', String(Date.now()));
        const response = await fetch(url.href, {
          cache: 'no-store', credentials: 'omit', redirect: 'error',
          signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok) throw Error('Release check failed');
        const release = await response.json();
        if (!validRevision(release?.revision)) throw Error('Invalid release metadata');
        target = release.revision === revision ? null : release.revision;
        show(target ? 'Update available (' + short(target) + ')' : 'Up to date');
      } catch {
        show(target ? 'Update available; latest check unavailable' : 'Update check unavailable; current build remains open');
      }
    })();
    try { await flight; }
    finally { flight = null; schedule(); }
  }
  function blocker() {
    if ((typeof JobWorkspace !== 'undefined' && JobWorkspace.dirty()) ||
        (typeof CreateJobDrafts !== 'undefined' && CreateJobDrafts.dirty())) {
      return 'Save or discard unsaved job changes before reloading.';
    }
    if ((typeof adminWritesPending !== 'undefined' && adminWritesPending) ||
        (typeof adminRefreshPromise !== 'undefined' && adminRefreshPromise) ||
        (typeof JobDrafts !== 'undefined' && JobDrafts.busy()) ||
        (typeof CreateJobDrafts !== 'undefined' && CreateJobDrafts.busy()) ||
        (typeof ownerConsoleBusy !== 'undefined' && ownerConsoleBusy) ||
        (typeof ownerInviteBusy !== 'undefined' && ownerInviteBusy) ||
        (typeof ownerSupervisorInviteBusy !== 'undefined' && ownerSupervisorInviteBusy) ||
        (typeof staffingBusy !== 'undefined' && staffingBusy) ||
        (typeof staffingRosterBusy !== 'undefined' && staffingRosterBusy) ||
        (typeof staffingWorkBusy !== 'undefined' && staffingWorkBusy) ||
        (typeof staffingWorkEditBusy !== 'undefined' && staffingWorkEditBusy) ||
        (typeof staffingHandoffBusy !== 'undefined' && staffingHandoffBusy)) {
      return 'Finish the current operation before reloading.';
    }
    if ((typeof ownerInvitePending !== 'undefined' && ownerInvitePending) ||
        (typeof ownerSupervisorInvitePending !== 'undefined' && ownerSupervisorInvitePending) ||
        (typeof ownerEnrollmentPending !== 'undefined' && ownerEnrollmentPending) ||
        (typeof ownerRosterPending !== 'undefined' && ownerRosterPending)) {
      return 'Resolve the pending office access request before reloading.';
    }
    return '';
  }
  function apply() {
    if (!target || !online()) { show('Reconnect before reloading'); return; }
    const reason = blocker();
    if (reason) { show(reason); return; }
    // Some staff forms and one-time setup links are intentionally not persisted.
    // Explicit user confirmation plus existing beforeunload guards protect them;
    // no software update ever navigates automatically.
    if (!window.confirm('Reload the dashboard now? Finish any open operations, save unfinished forms and copy any setup links first. Your saved drafts and existing tab session will be retained.')) return;
    const url = new URL(window.location.href);
    url.searchParams.set('fwh_build', target);
    url.searchParams.set('fwh_reload', String(Date.now()));
    window.location.replace(url.href);
  }
  function init() {
    if (!status || !reload || !help) return;
    show();
    reload.addEventListener('click', apply);
    if (!validRevision(revision)) return;
    document.addEventListener('visibilitychange', () => schedule(0));
    window.addEventListener('focus', () => schedule(0));
    window.addEventListener('online', () => schedule(0));
    window.addEventListener('offline', () => { schedule(); show('Offline; current build remains open'); });
    schedule(0);
  }
  return {init};
})();
DashboardRelease.init();

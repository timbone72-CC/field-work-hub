/* Presentation-only dashboard destinations; never mutates work, auth, or review state. */
(() => {
  'use strict';
  const root = document.getElementById('results-card');
  if (!root) return;
  const views = new Set(['home', 'work', 'create', 'alerts', 'team']);
  const links = Array.from(root.querySelectorAll('[data-fwh-go]'));
  const teamLinks = links.filter(button => button.dataset.fwhGo === 'team');
  const create = document.getElementById('create-wo-details');
  const alerts = document.getElementById('notification-center');

  function ownerConsole() { return document.getElementById('owner-office-console'); }
  function syncTeam() {
    const available = Boolean(ownerConsole());
    for (const button of teamLinks) button.hidden = !available;
    if (!available && root.dataset.fwhView === 'team') select('home', false);
  }
  function select(view, scroll = true) {
    if (!views.has(view) || (view === 'team' && !ownerConsole())) return;
    root.dataset.fwhView = view;
    for (const button of links) {
      if (button.dataset.fwhGo === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    // The existing native details own their content/loading and remain mounted.
    if (view === 'alerts') alerts.open = true;
    if (view === 'create') create.open = true;
    if (view === 'team') ownerConsole().open = true;
    if (scroll) root.querySelector('#fwh-primary-nav')?.scrollIntoView({ block: 'start' });
  }

  for (const button of links) {
    button.addEventListener('click', () => select(button.dataset.fwhGo));
  }
  // Existing "Prepare repeat/custom work" opens Create programmatically after
  // its own guarded work-order read; route to the revealed draft without replacing it.
  create.addEventListener('toggle', () => {
    if (create.open && root.dataset.fwhView !== 'create') select('create', false);
  });
  document.getElementById('sign-out').addEventListener('click', () => select('home', false));

  // Product Owner controls are inserted/removed by the existing authorized owner
  // module. Navigation only observes their presence; it never grants access.
  new MutationObserver(syncTeam).observe(root, { childList: true });
  syncTeam();
  select('home', false);
})();

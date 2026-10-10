/* Phase 5C: one office-authorized review pane, no browser-owned credentials or URLs. */
const PrivateReview = (() => {
  let current = '', generation = 0, next = null, entries = [];
  const el = id => document.getElementById(id);
  const UUID = /^[a-f0-9-]{36}$/i;

  function reset() {
    generation++; current = ''; next = null; entries = [];
    const list = el('private-review-list');
    if (list) list.replaceChildren();
    const status = el('private-review-status'); if (status) status.textContent = '';
    const more = el('private-review-more'); if (more) more.hidden = true;
  }
  function active(gen, wo, token) {
    return gen === generation && current === wo && accessToken && accessToken === token
      && editWorkOrderIdInput.value === wo;
  }
  function status(message, error = false) {
    const node = el('private-review-status'); node.textContent = message;
    node.classList.toggle('error', error);
  }
  async function rpc(name, payload, token) {
    if (!token) throw new Error('Sign in before reviewing private photos.');
    const response = await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await readableError(response, 'Private review is unavailable. No photos were changed.'));
    return response.json();
  }
  async function viewer(payload, token) {
    const response = await adminFetch(`${SUPABASE_URL}/functions/v1/admin-private-photo`, {
      method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('Private image preview is unavailable. Review has not been changed.');
    return response.json();
  }
  function actionButton(label, action, disabled = true) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'secondary'; button.textContent = label;
    button.disabled = disabled; button.addEventListener('click', action); return button;
  }
  function render() {
    const list = el('private-review-list'); list.replaceChildren();
    if (entries.length === 0) { status('No verified private photos available for review yet. Transfer receipts may still be pending.'); return; }
    status('Only privately verified photos are listed here. Nothing is sent to a client from this screen.');
    for (const item of entries) {
      const row = document.createElement('article'); row.className = 'private-review-photo';
      const heading = document.createElement('strong');
      heading.textContent = `Photo ${item.photo_id.slice(0,8)} · ${item.decision}`;
      const detail = document.createElement('p'); detail.className = 'muted';
      detail.textContent = `Taken ${formatTimestamp(item.captured_at)} · Receipt ${formatTimestamp(item.verified_at)}`;
      const preview = document.createElement('div'); preview.className = 'private-review-preview';
      const controls = document.createElement('div'); controls.className = 'workspace-navigation';
      const explanation = document.createElement('input');
      explanation.type = 'text'; explanation.maxLength = 1000;
      explanation.placeholder = 'Reason for rejecting this photo';
      explanation.setAttribute('aria-label', 'Photo rejection reason');
      const review = async decision => {
        const gen = generation, wo = current, token = accessToken;
        if (!active(gen,wo,token)) return;
        const reason = decision === 'REJECTED' ? explanation.value.trim() : '';
        if (decision === 'REJECTED' && !reason) {
          status('Enter a reason before rejecting a photo.', true); explanation.focus(); return;
        }
        approval.disabled = true; rejection.disabled = true;
        status('Saving photo review…');
        try {
          await rpc('admin_review_photo', { p_action: crypto.randomUUID(), p_work_order: wo,
            p_photo: item.photo_id, p_transfer_version: item.transfer_version,
            p_expected_revision: item.decision_revision, p_decision: decision, p_reason: reason }, token);
          if (active(gen,wo,token)) await load(false);
        } catch (error) {
          if (active(gen,wo,token)) {
            status('Review not saved: ' + error.message + ' Reload verified photos before retrying.', true);
            approval.disabled = true; rejection.disabled = true;
          }
        }
      };
      const approval = actionButton('Approve', () => review('APPROVED'));
      const rejection = actionButton('Reject', () => review('REJECTED'));
      const show = actionButton('Preview photo', async () => {
        const gen = generation, wo = current, token = accessToken;
        show.disabled = true; approval.disabled = true; rejection.disabled = true;
        preview.replaceChildren(); status('Loading verified photo preview…');
        try {
          const signed = await viewer({ photo_id: item.photo_id, transfer_version: item.transfer_version }, token);
          if (!active(gen,wo,token)) return;
          if (signed.photo_id !== item.photo_id || signed.transfer_version !== item.transfer_version
            || !Number.isInteger(signed.expires_in) || signed.expires_in < 1 || signed.expires_in > 300
            || typeof signed.url !== 'string') throw new Error('Untrusted preview response.');
          const expected = [currentUser?.app_metadata?.organization_id, wo, item.run_id, item.photo_id + '.jpg'];
          if (expected.some(part => typeof part !== 'string' || !part)) throw new Error('Photo identity is unavailable.');
          const expectedPath = '/storage/v1/object/sign/fwh-review-private/' + expected.map(encodeURIComponent).join('/');
          const url = new URL(signed.url);
          if (url.protocol !== 'https:' || url.origin !== SUPABASE_URL
            || url.pathname !== expectedPath || url.searchParams.size !== 1
            || !url.searchParams.get('token')) throw new Error('Untrusted private preview URL.');
          const img = document.createElement('img'); img.alt = 'Privately verified work photo';
          img.referrerPolicy = 'no-referrer'; img.loading = 'eager';
          img.addEventListener('load', () => {
            if (!active(gen,wo,token)) return;
            approval.disabled = false; rejection.disabled = false;
            status('Photo preview loaded. Review the image before deciding.');
          }, { once: true });
          img.addEventListener('error', () => {
            if (active(gen,wo,token)) status('Could not load the verified image. No review decision is available.', true);
          }, { once: true });
          preview.replaceChildren(img); img.src = url.toString();
        } catch (error) {
          if (active(gen,wo,token)) status(error.message || 'Private photo preview unavailable.', true);
        } finally { if (active(gen,wo,token)) show.disabled = false; }
      }, false);
      controls.append(show, approval, rejection);
      row.append(heading, detail, preview, controls, explanation);
      list.append(row);
    }
  }
  async function load(append = false) {
    const wo = current, token = accessToken, gen = generation;
    if (!wo || !token) return;
    status('Loading verified private photos…');
    const cursor = append ? next : null;
    if (!append) { next = null; entries = []; }
    try {
      const data = await rpc('admin_list_private_review_photos',
        { p_work_order: wo, p_limit: 25, p_after_photo: cursor }, token);
      if (!active(gen,wo,token)) return;
      if (data.work_order_id !== wo || !Array.isArray(data.photos) || data.photos.length > 25
        || data.photos.some(p => !UUID.test(p.photo_id) || !UUID.test(p.transfer_version))) {
        throw new Error('Private photo list identity mismatch.');
      }
      entries = append ? [...entries, ...data.photos] : data.photos;
      next = data.next_photo;
      el('private-review-more').hidden = !next;
      render();
    } catch (error) {
      if (active(gen,wo,token)) {
        el('private-review-more').hidden = true;
        status('Private review unavailable. No action taken. ' + error.message, true);
      }
    }
  }
  function open(wo) {
    if (!wo) return;
    if (current !== wo) { reset(); current = wo; }
    load(false);
  }
  function init() { el('private-review-more').addEventListener('click', () => load(true)); }
  return { init, open, reset };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PrivateReview;

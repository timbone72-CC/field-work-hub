// Recovery-only cloud viewer. Never grants work access or changes photo/WO state.
const RecoveryGallery = (() => {
  const card = document.createElement('section');
  card.id = 'recovery-card';
  card.className = 'card hidden';
  const heading = document.createElement('h2');
  heading.textContent = 'Recover my photos';
  const explanation = document.createElement('p');
  explanation.textContent = 'Work access is turned off. Previously authorized, privately received photos may still be available here. These are prepared JPEG copies, not protected full-resolution phone originals or client deliveries.';
  const status = document.createElement('p');
  status.className = 'status';
  status.setAttribute('role', 'status');
  const rows = document.createElement('div');
  const preview = document.createElement('img');
  preview.alt = 'Selected recovered photo';
  preview.hidden = true;
  preview.style.maxWidth = '100%';
  const controls = document.createElement('div');
  controls.className = 'workspace-navigation';
  const more = document.createElement('button');
  more.type = 'button'; more.className = 'secondary'; more.textContent = 'Load more';
  more.hidden = true;
  const download = document.createElement('button');
  download.type = 'button'; download.className = 'secondary';
  download.textContent = 'Download selected JPEG'; download.disabled = true;
  const signOut = document.createElement('button');
  signOut.type = 'button'; signOut.className = 'secondary'; signOut.textContent = 'Sign Out';
  signOut.addEventListener('click', () => signOutButton.click());
  controls.append(more, download, signOut);
  card.append(heading, explanation, status, rows, preview, controls);
  document.querySelector('main.shell').append(card);

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let generation = 0, identity = null, next = null, selected = null, busy = false;
  const matches = (g) => generation === g && !!accessToken && identity === currentUser?.id;
  const message = (value, error = false) => {
    status.textContent = value; status.classList.toggle('error', error);
  };
  function reset() {
    generation++; identity = null; next = null; selected = null; busy = false;
    rows.replaceChildren(); preview.removeAttribute('src'); preview.hidden = true;
    download.disabled = true; more.hidden = true; more.disabled = false;
    card.classList.add('hidden'); message('');
  }
  async function readPage(after, g) {
    if (!matches(g)) throw Error('Your recovery session changed.');
    const response = await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/photo_recovery_page`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({p_after_photo: after, p_limit: 25})
    });
    if (!response.ok) throw Error(await readableError(response, 'Recovery access unavailable. Sign in again.'));
    const result = await response.json();
    if (!matches(g) || !Array.isArray(result?.photos) || result.photos.length > 25
      || (result.next_photo !== null && result.next_photo !== undefined && !UUID.test(result.next_photo))
      || result.photos.some(p => !UUID.test(p.photo_id || '') || !UUID.test(p.transfer_version || '')
        || (after && p.photo_id <= after)
        || !Number.isSafeInteger(p.prepared_size) || p.prepared_size < 4
        || p.prepared_size > 33554432
        || !/^[0-9a-f]{64}$/.test(p.prepared_sha256 || '')))
      throw Error('Recovery page is stale or invalid.');
    return result;
  }
  async function appendPage(after, g) {
    if (busy) return;
    busy = true; more.disabled = true; message('Checking previously authorized photos…');
    try {
      const result = await readPage(after, g);
      if (!matches(g)) return;
      for (const photo of result.photos) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'secondary';
        button.textContent = `Photo ${photo.photo_id.slice(0, 8)} · ${photo.captured_at || 'Capture date unavailable'}`;
        button.addEventListener('click', () => { void inspect(photo); });
        rows.append(button);
      }
      next = result.next_photo || null;
      more.hidden = !next;
      message(rows.childElementCount ? 'Select a photo to inspect or download its private prepared copy.' :
        'No privately verified recovery copies are available yet. Unsynchronized original photos may still be on the original phone.');
    } catch (error) { if (matches(g)) message(error.message, true); }
    finally { busy = false; more.disabled = false; }
  }
  async function signedUrl(photo, g) {
    if (!matches(g)) throw Error('Your recovery session changed.');
    const response = await adminFetch(`${SUPABASE_URL}/functions/v1/recovery-private-photo`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({photo_id: photo.photo_id, transfer_version: photo.transfer_version})
    });
    if (!response.ok) throw Error('This exact private photo cannot be retrieved with the current session.');
    const answer = await response.json();
    const url = new URL(answer?.url || '', SUPABASE_URL);
    if (!matches(g) || answer.photo_id !== photo.photo_id
      || answer.transfer_version !== photo.transfer_version
      || url.origin !== new URL(SUPABASE_URL).origin
      || !url.pathname.startsWith('/storage/v1/object/sign/fwh-review-private/')
      || !url.searchParams.get('token') || Number(answer.expires_in) > 300)
      throw Error('Photo authorization response is invalid.');
    return url.href;
  }
  async function inspect(photo) {
    if (busy || !identity) return;
    const g = generation; selected = null; download.disabled = true;
    preview.removeAttribute('src'); preview.hidden = true;
    busy = true; message('Requesting an exact private photo…');
    try {
      const url = await signedUrl(photo, g);
      if (!matches(g)) return;
      preview.src = url; preview.hidden = false;
      selected = photo; download.disabled = false;
      message('Verified photo selected. Download is an evidence copy, not client delivery.');
    } catch (error) { if (matches(g)) message(error.message, true); }
    finally { busy = false; }
  }
  async function savePhoto() {
    if (!selected || busy) return;
    const g = generation, photo = selected;
    busy = true; download.disabled = true; message('Downloading the authorized prepared copy…');
    try {
      const url = await signedUrl(photo, g);
      const response = await fetch(url, {cache: 'no-store', redirect: 'error'});
      if (!response.ok) throw Error('Private photo download failed. No photo status changed.');
      const bytes = await response.blob();
      if (!matches(g) || bytes.size !== photo.prepared_size
        || bytes.type.toLowerCase() !== 'image/jpeg')
        throw Error('The downloaded photo does not match its verified private receipt.');
      const file = new Uint8Array(await bytes.arrayBuffer());
      if (!matches(g) || file[0] !== 255 || file[1] !== 216
        || file[2] !== 255 || file[file.length-2] !== 255 || file[file.length-1] !== 217)
        throw Error('The downloaded photo is not a complete prepared JPEG.');
      const digest = await crypto.subtle.digest('SHA-256', file);
      const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
      if (!matches(g) || actual !== photo.prepared_sha256)
        throw Error('The downloaded photo failed its private checksum verification.');
      const local = URL.createObjectURL(bytes);
      try {
        const link = document.createElement('a');
        link.href = local; link.download = `fwh-recovered-${photo.photo_id}.jpg`;
        card.append(link); link.click(); link.remove();
      } finally { setTimeout(() => URL.revokeObjectURL(local), 1000); }
      message('Prepared photo copy offered for download. Original evidence and work state are unchanged.');
    } catch (error) { if (matches(g)) message(error.message, true); }
    finally { if (matches(g)) download.disabled = !selected; busy = false; }
  }
  more.addEventListener('click', () => { if (next && !busy) void appendPage(next, generation); });
  download.addEventListener('click', () => { void savePhoto(); });
  async function show() {
    if (!accessToken || !currentUser?.id) throw Error('Verified sign-in required for photo recovery.');
    reset();
    identity = currentUser.id;
    const g = generation;
    const result = await readPage(null, g); // Server authority before showing recovery mode.
    if (!matches(g)) throw Error('Your recovery session changed.');
    loginCard.classList.add('hidden'); resultsCard.classList.add('hidden');
    document.getElementById('staffing-card')?.classList.add('hidden');
    card.classList.remove('hidden');
    for (const photo of result.photos) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'secondary';
      button.textContent = `Photo ${photo.photo_id.slice(0, 8)} · ${photo.captured_at || 'Capture date unavailable'}`;
      button.addEventListener('click', () => { void inspect(photo); });
      rows.append(button);
    }
    next = result.next_photo || null;
    more.hidden = !next;
    message(rows.childElementCount ? 'Select a photo to inspect or download a prepared copy.' :
      'No verified cloud photos currently available. Protected unsynchronized originals may remain on the original phone.');
  }
  return {show, reset};
})();

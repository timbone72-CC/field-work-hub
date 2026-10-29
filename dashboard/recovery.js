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
  const addToExport = document.createElement('button');
  addToExport.type = 'button'; addToExport.className = 'secondary';
  addToExport.textContent = 'Add selected photo to export'; addToExport.disabled = true;
  const exportZip = document.createElement('button');
  exportZip.type = 'button'; exportZip.className = 'secondary';
  exportZip.textContent = 'Export selected ZIP (0/8)'; exportZip.disabled = true;
  controls.append(more, download, addToExport, exportZip, signOut);
  card.append(heading, explanation, status, rows, preview, controls);
  document.querySelector('main.shell').append(card);

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MAX_EXPORT_PHOTOS = 8, MAX_EXPORT_BYTES = 64 * 1024 * 1024;
  let generation = 0, identity = null, sessionToken = null, next = null, selected = null, busy = false;
  let exportPhotos = [];
  // A new Auth session for the same user must not inherit an old recovery read.
  const matches = (g) => generation === g && !!sessionToken && accessToken === sessionToken
    && identity === currentUser?.id;
  const message = (value, error = false) => {
    status.textContent = value; status.classList.toggle('error', error);
  };
  function updateExportControls() {
    addToExport.disabled = busy || !selected || exportPhotos.length >= MAX_EXPORT_PHOTOS
      || exportPhotos.some(p => p.photo_id === selected.photo_id);
    exportZip.disabled = busy || exportPhotos.length === 0;
    exportZip.textContent = `Export selected ZIP (${exportPhotos.length}/${MAX_EXPORT_PHOTOS})`;
  }
  function reset() {
    generation++; identity = null; sessionToken = null; next = null; selected = null; busy = false;
    exportPhotos = []; updateExportControls();
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
    const photos = result?.photos;
    const hasNext = result?.next_photo !== null && result?.next_photo !== undefined;
    // The server returns a strictly increasing 25-row UUID page and only
    // returns a cursor when another row exists. Never render duplicate pages.
    if (!matches(g) || !Array.isArray(photos) || photos.length > 25
      || (hasNext && (photos.length !== 25 || !UUID.test(result.next_photo)
        || result.next_photo !== photos[photos.length - 1]?.photo_id))
      || photos.some((p, i) => !p || !UUID.test(p.photo_id || '')
        || p.photo_id !== p.photo_id.toLowerCase()
        || !UUID.test(p.transfer_version || '')
        || p.photo_id <= (i ? photos[i - 1]?.photo_id : (after || ''))
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
    finally { if (matches(g)) { busy = false; more.disabled = false; updateExportControls(); } }
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
      || url.username || url.password || url.hash
      || url.searchParams.size !== 1 || !url.searchParams.get('token')
      || !Number.isSafeInteger(answer.expires_in)
      || answer.expires_in < 1 || answer.expires_in > 300)
      throw Error('Photo authorization response is invalid.');
    return url.href;
  }
  async function inspect(photo) {
    if (busy || !identity) return;
    const g = generation; selected = null; download.disabled = true;
    preview.removeAttribute('src'); preview.hidden = true;
    busy = true; updateExportControls(); message('Requesting an exact private photo…');
    try {
      const url = await signedUrl(photo, g);
      if (!matches(g)) return;
      preview.src = url; preview.hidden = false;
      selected = photo; download.disabled = false;
      message('Verified photo selected. Download is an evidence copy, not client delivery.');
    } catch (error) { if (matches(g)) message(error.message, true); }
    finally { if (matches(g)) { busy = false; updateExportControls(); } }
  }
  function addSelectedToExport() {
    if (busy || !selected || exportPhotos.length >= MAX_EXPORT_PHOTOS ||
      exportPhotos.some(p => p.photo_id === selected.photo_id)) return;
    exportPhotos.push(selected);
    updateExportControls();
    message(`${exportPhotos.length} verified receipt(s) selected. Export checks each JPEG again before saving.`);
  }
  async function readVerifiedJPEG(photo, g) {
    const url = await signedUrl(photo, g);
    if (!matches(g)) throw Error('Your recovery session changed.');
    const response = await fetch(url, {cache: 'no-store', redirect: 'error', credentials: 'omit'});
    if (!response.ok) throw Error('Private photo download failed. No photo status changed.');
    const bytes = await response.blob();
    if (!matches(g) || bytes.size !== photo.prepared_size ||
      bytes.type.toLowerCase() !== 'image/jpeg')
      throw Error('The downloaded photo does not match its verified private receipt.');
    const file = new Uint8Array(await bytes.arrayBuffer());
    if (!matches(g) || file.length < 4 || file[0] !== 255 || file[1] !== 216 ||
      file[2] !== 255 || file[file.length-2] !== 255 || file[file.length-1] !== 217)
      throw Error('The downloaded photo is not a complete prepared JPEG.');
    const digest = await crypto.subtle.digest('SHA-256', file);
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
    if (!matches(g) || actual !== photo.prepared_sha256)
      throw Error('The downloaded photo failed its private checksum verification.');
    return {bytes, file};
  }
  async function savePhoto() {
    if (!selected || busy) return;
    const g = generation, photo = selected;
    busy = true; download.disabled = true; updateExportControls();
    message('Downloading the authorized prepared copy…');
    try {
      const {bytes} = await readVerifiedJPEG(photo, g);
      if (!matches(g)) return;
      const local = URL.createObjectURL(bytes);
      try {
        const link = document.createElement('a');
        link.href = local; link.download = `fwh-recovered-${photo.photo_id}.jpg`;
        card.append(link); link.click(); link.remove();
      } finally { setTimeout(() => URL.revokeObjectURL(local), 1000); }
      message('Prepared photo copy offered for download. Original evidence and work state are unchanged.');
    } catch (error) { if (matches(g)) message(error.message, true); }
    finally { if (matches(g)) { download.disabled = !selected; busy = false; updateExportControls(); } }
  }
  // A bounded, uncompressed ZIP: only opaque photo UUID filenames and bytes
  // already verified against the exact private receipt. No remote ZIP or new API.
  function crc32(bytes) {
    let crc = -1;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ -1) >>> 0;
  }
  function zipEntries(entries) {
    const parts = [], directory = [];
    let offset = 0, centralBytes = 0;
    const put16 = (v, n, value) => v.setUint16(n, value, true);
    const put32 = (v, n, value) => v.setUint32(n, value, true);
    for (const {photo, file} of entries) {
      const name = new TextEncoder().encode(`fwh-recovered-${photo.photo_id}.jpg`);
      const crc = crc32(file), size = file.byteLength;
      const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
      put32(h,0,0x04034b50); put16(h,4,20); put16(h,6,0); put16(h,8,0);
      put16(h,10,0); put16(h,12,33); put32(h,14,crc);
      put32(h,18,size); put32(h,22,size); put16(h,26,name.length);
      header.set(name,30);
      parts.push(header,file);
      const entry = new Uint8Array(46 + name.length), d = new DataView(entry.buffer);
      put32(d,0,0x02014b50); put16(d,4,20); put16(d,6,20);
      put16(d,8,0); put16(d,10,0); put16(d,12,0); put16(d,14,33);
      put32(d,16,crc); put32(d,20,size); put32(d,24,size);
      put16(d,28,name.length); put32(d,42,offset); entry.set(name,46);
      directory.push(entry); centralBytes += entry.length;
      offset += header.length + size;
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    put32(e,0,0x06054b50); put16(e,8,entries.length); put16(e,10,entries.length);
    put32(e,12,centralBytes); put32(e,16,offset);
    return new Blob([...parts,...directory,end], {type:'application/zip'});
  }
  async function saveExport() {
    if (busy || !exportPhotos.length) return;
    const g = generation, photos = [...exportPhotos];
    if (photos.length > MAX_EXPORT_PHOTOS ||
      photos.reduce((sum,p)=>sum + p.prepared_size,0) > MAX_EXPORT_BYTES) {
      message('This export exceeds the 8-photo/64 MiB safety bound. Select a smaller batch.', true);
      return;
    }
    busy = true; updateExportControls();
    message('Verifying each authorized JPEG for the private export…');
    try {
      const entries = [];
      for (const photo of photos) {
        const {file} = await readVerifiedJPEG(photo, g);
        if (!matches(g)) return;
        entries.push({photo,file});
      }
      if (!matches(g)) return;
      const local = URL.createObjectURL(zipEntries(entries));
      try {
        const link = document.createElement('a');
        link.href = local; link.download = 'fwh-recovered-evidence.zip';
        card.append(link); link.click(); link.remove();
      } finally { setTimeout(() => URL.revokeObjectURL(local), 1000); }
      message('Verified prepared JPEG archive offered for download. This is not client delivery.');
    } catch (error) { if (matches(g)) message(error.message, true); }
    finally { if (matches(g)) { busy = false; updateExportControls(); } }
  }
  addToExport.addEventListener('click', addSelectedToExport);
  exportZip.addEventListener('click', () => { void saveExport(); });
  more.addEventListener('click', () => { if (next && !busy) void appendPage(next, generation); });
  download.addEventListener('click', () => { void savePhoto(); });
  async function show() {
    if (!accessToken || !currentUser?.id) throw Error('Verified sign-in required for photo recovery.');
    reset();
    identity = currentUser.id; sessionToken = accessToken;
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
    updateExportControls();
    message(rows.childElementCount ? 'Select a photo to inspect or download a prepared copy.' :
      'No verified cloud photos currently available. Protected unsynchronized originals may remain on the original phone.');
  }
  return {show, reset};
})();

// Review-only short signed-photo access. Caller cannot choose bucket, key or identity.
// Trusted Auth session and current scoped-office grants are checked on EVERY request.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ORIGIN = 'https://timbone72-cc.github.io';
const SECONDS = 120;

function respond(status, data) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store, private',
    'Access-Control-Allow-Origin': ORIGIN, 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  } });
}
function fail(status, code) { const error = new Error(code); error.status = status; throw error; }
async function readBoundedJson(response, limit) {
  if (!response.body) fail(400, 'INVALID_RESPONSE');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > limit) fail(413, 'REQUEST_TOO_LARGE');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createPrivatePhotoViewer({ url, anonKey, serviceKey, fetcher = fetch }) {
  if (!anonKey || !serviceKey) throw new Error('Private photo viewer credentials unavailable');
  const base = new URL(url);
  if (base.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(base.hostname)
    || base.username || base.password || base.port || base.search || base.hash
    || (base.pathname !== '' && base.pathname !== '/')) throw new Error('Untrusted Supabase origin');
  const call = (path, options) => fetcher(new URL(path, base), { ...options, redirect: 'error' });
  return async function handle(request) {
    if (request.method === 'OPTIONS') return respond(200, { ok: true });
    if (request.method !== 'POST') return respond(405, { error: 'POST_REQUIRED' });
    if (request.headers.get('Origin') && request.headers.get('Origin') !== ORIGIN)
      return respond(403, { error: 'ORIGIN_DENIED' });
    const bearer = request.headers.get('Authorization') || '';
    if (!/^Bearer [a-zA-Z0-9_.-]{1,8192}$/.test(bearer))
      return respond(401, { error: 'SIGN_IN_REQUIRED' });
    try {
      if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
        fail(400, 'JSON_REQUIRED');
      let data;
      try { data = await readBoundedJson(request, 1024); }
      catch { fail(400, 'INVALID_REQUEST'); }
      if (!data || Array.isArray(data) || Object.keys(data).sort().join(',') !== 'photo_id,transfer_version'
        || !UUID.test(data.photo_id) || !UUID.test(data.transfer_version)) fail(400, 'EXACT_PHOTO_REQUIRED');
      const photo = data.photo_id.toLowerCase(), version = data.transfer_version.toLowerCase();
      const userResponse = await call('/auth/v1/user', { headers: { apikey: anonKey, Authorization: bearer } });
      if (!userResponse.ok) fail(userResponse.status >= 500 ? 503 : 401, 'SIGN_IN_REQUIRED');
      const user = await readBoundedJson(userResponse, 8192);
      let claims;
      try { claims = JSON.parse(atob(bearer.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); }
      catch { fail(401, 'SIGN_IN_REQUIRED'); }
      if (!UUID.test(user.id || '') || user.id !== claims.sub
        || !UUID.test(claims.session_id || '') || user.is_anonymous) fail(401, 'SIGN_IN_REQUIRED');
      const targetResponse = await call('/rest/v1/rpc/admin_private_photo_target_for_session', {
        method: 'POST', headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_photo: photo, p_transfer_version: version, p_actor: user.id,
          p_session: claims.session_id })
      });
      if (!targetResponse.ok) { await targetResponse.body?.cancel(); fail(targetResponse.status >= 500 ? 503 : 403, 'PHOTO_ACCESS_DENIED'); }
      const target = await readBoundedJson(targetResponse, 2048);
      const parts = typeof target?.object_key === 'string' ? target.object_key.split('/') : [];
      if (target.photo_id !== photo || target.transfer_version !== version
        || target.bucket !== 'fwh-review-private' || parts.length !== 4
        || !parts.slice(0,3).every(x => UUID.test(x)) || parts[3] !== photo + '.jpg'
        || !UUID.test(target.object_id || '') || !String(target.object_version || '').length)
        fail(409, 'PRIVATE_PHOTO_UNAVAILABLE');
      const fixedPath = '/storage/v1/object/sign/fwh-review-private/' + parts.map(encodeURIComponent).join('/');
      const signed = await call(fixedPath, { method: 'POST',
        headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: SECONDS })
      });
      if (!signed.ok) { await signed.body?.cancel(); fail(signed.status >= 500 ? 503 : 409, 'PRIVATE_PHOTO_UNAVAILABLE'); }
      const result = await readBoundedJson(signed, 4096);
      const location = result?.signedURL ?? result?.signedUrl ?? '';
      if (typeof location !== 'string' || location.length > 3500) fail(503, 'SIGNATURE_UNAVAILABLE');
      const raw = location.startsWith('/object/sign/') ? '/storage/v1' + location : location;
      const signedUrl = new URL(raw, base);
      const allowedPath = fixedPath;
      if (signedUrl.origin !== base.origin || signedUrl.pathname !== allowedPath
        || signedUrl.username || signedUrl.password || signedUrl.hash
        || signedUrl.searchParams.size !== 1 || !signedUrl.searchParams.get('token'))
        fail(503, 'SIGNATURE_UNAVAILABLE');
      return respond(200, { photo_id: photo, transfer_version: version,
        url: signedUrl.toString(), expires_in: SECONDS });
    } catch (error) {
      return respond(error?.status || 503, { error: error?.status ? error.message : 'PRIVATE_PHOTO_UNAVAILABLE' });
    }
  };
}

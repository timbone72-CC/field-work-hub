// One authenticated original-owner request, one immutable prepared derivative.
// No client URL/path/hash/size is accepted; no file is deleted or rewritten here.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_VERIFICATION_BYTES = 32 * 1024 * 1024;
const ORIGIN = 'https://timbone72-cc.github.io';

class Problem extends Error {
  constructor(status, code, retryAfter) { super(code); this.status = status; this.code = code; this.retryAfter = retryAfter; }
}

async function boundedBytes(response, limit, exact = false, signal) {
  if (!response.body) throw new Problem(409, 'OBJECT_INCOMPLETE');
  const reader = response.body.getReader();
  const bytes = new Uint8Array(limit);
  let offset = 0;
  const abort = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new Problem(503, 'VERIFICATION_UNAVAILABLE');
      const { value, done } = await reader.read();
      if (signal?.aborted) throw new Problem(503, 'VERIFICATION_UNAVAILABLE');
      if (done) break;
      if (offset + value.length > limit) throw new Problem(409, 'CONTENT_SIZE_MISMATCH');
      bytes.set(value, offset); offset += value.length;
    }
    if (exact && offset !== limit) throw new Problem(409, 'CONTENT_SIZE_MISMATCH');
    return bytes.subarray(0, offset);
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function smallJson(response, signal) {
  const bytes = await boundedBytes(response, 16 * 1024, false, signal);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function resultResponse(status, code, receipt, retryAfter) {
  const headers = {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': ORIGIN, 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (status === 429 || status === 503) headers['Retry-After'] = retryAfter ?? '30';
  return new Response(JSON.stringify(receipt ?? { error: code }), { status, headers });
}

function retryHint(response) {
  const value = response.headers.get('Retry-After') ?? '';
  if (/^\d{1,9}$/.test(value)) return value;
  const date = Date.parse(value);
  return Number.isFinite(date) ? String(Math.max(0, Math.ceil((date - Date.now()) / 1000))) : undefined;
}

function minimalReceipt(receipt, photo, version) {
  if (!receipt || receipt.photo_id !== photo || receipt.transfer_version !== version
    || receipt.state !== 'RECEIVED' || !UUID.test(receipt.receipt_id ?? '')) {
    throw new Problem(503, 'VERIFICATION_UNAVAILABLE');
  }
  return { photo_id: photo, transfer_version: version, receipt_id: receipt.receipt_id, state: 'RECEIVED' };
}

export function createPhotoVerifier({ url, anonKey, serviceKey, fetcher = fetch, deadlineMs = 45000 }) {
  // Trusted deployment configuration only. Redirects never receive credentials.
  if (!anonKey || !serviceKey) throw new Error('Supabase credentials unavailable');
  const project = new URL(url);
  if (project.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(project.hostname)
    || project.username || project.password || project.port || project.search || project.hash
    || (project.pathname !== '/' && project.pathname !== '')) throw new Error('Invalid Supabase project origin');
  let inFlight = 0;
  return async function handle(request) {
    if (request.method === 'OPTIONS') return resultResponse(200, 'OK');
    if (request.method !== 'POST') return resultResponse(405, 'POST_REQUIRED');
    const origin = request.headers.get('Origin');
    if (origin && origin !== ORIGIN) return resultResponse(403, 'ORIGIN_DENIED');
    const authorization = request.headers.get('Authorization') ?? '';
    if (!/^Bearer [A-Za-z0-9_.-]{1,8192}$/.test(authorization)) return resultResponse(401, 'SIGN_IN_REQUIRED');
    if (inFlight >= 2) return resultResponse(429, 'VERIFIER_BUSY');
    inFlight += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    try {
      if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new Problem(400, 'JSON_REQUIRED');
      }
      let body;
      try { body = JSON.parse(new TextDecoder().decode(await boundedBytes(request, 1024, false, controller.signal))); }
      catch { throw new Problem(controller.signal.aborted ? 503 : 400, controller.signal.aborted ? 'VERIFICATION_UNAVAILABLE' : 'INVALID_REQUEST'); }
      if (!body || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'action_id,photo_id,transfer_version'
        || ![body.action_id, body.photo_id, body.transfer_version].every(x => typeof x === 'string' && UUID.test(x))) {
        throw new Problem(400, 'EXACT_TRANSFER_REQUIRED');
      }
      const action = body.action_id.toLowerCase(), photo = body.photo_id.toLowerCase(), version = body.transfer_version.toLowerCase();
      const call = (path, options) => fetcher(new URL(path, project), {
        ...options, redirect: 'error', signal: controller.signal,
      });
      const auth = await call('/auth/v1/user', { headers: { apikey: anonKey, Authorization: authorization } });
      if (!auth.ok) throw new Problem(auth.status === 429 ? 429 : auth.status === 408 || auth.status >= 500 ? 503 : 401, 'SIGN_IN_REQUIRED', retryHint(auth));
      const user = await smallJson(auth, controller.signal);
      // Decode claims only after this exact JWT was validated by trusted Auth.
      let claims;
      try {
        const payload = authorization.slice(7).split('.')[1];
        claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      } catch { throw new Problem(401, 'SIGN_IN_REQUIRED'); }
      if (!UUID.test(user.id ?? '') || claims.sub !== user.id || !UUID.test(claims.session_id ?? '') || user.is_anonymous) {
        throw new Problem(401, 'SIGN_IN_REQUIRED');
      }
      const rpc = async (name, args) => {
        const response = await call('/rest/v1/rpc/' + name, { method: 'POST',
          headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(args) });
        const data = await smallJson(response, controller.signal);
        if (!response.ok) {
          if (data?.code === '42501') throw new Problem(403, 'TRANSFER_ACCESS_DENIED');
          if (data?.code === '22023' || data?.code === '40001') throw new Problem(409, 'TRANSFER_RECONCILIATION_REQUIRED');
          throw new Problem(response.status === 429 ? 429 : 503, 'VERIFICATION_UNAVAILABLE', retryHint(response));
        }
        return data;
      };
      const target = await rpc('photo_verification_target_for_session', {
        p_photo: photo, p_transfer_version: version, p_owner: user.id, p_session: claims.session_id,
      });
      if (target?.state === 'RECEIVED') return resultResponse(200, null, minimalReceipt(target, photo, version));
      if (!target || target.photo_id !== photo || target.transfer_version !== version || target.state !== 'WAITING'
        || target.owner_user_id !== user.id || target.owner_session_id !== claims.session_id
        || target.bucket !== 'fwh-review-private' || !UUID.test(target.object_id ?? '')
        || typeof target.object_version !== 'string' || target.object_version.length < 1 || target.object_version.length > 256
        || typeof target.expected_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(target.expected_sha256)
        || !Number.isSafeInteger(target.expected_size) || target.expected_size < 4
        || typeof target.object_key !== 'string') throw new Problem(409, 'TRANSFER_RECONCILIATION_REQUIRED');
      const parts = target.object_key.split('/');
      if (parts.length !== 4 || !parts.slice(0, 3).every(x => UUID.test(x)) || parts[3] !== photo + '.jpg') {
        throw new Problem(409, 'TRANSFER_RECONCILIATION_REQUIRED');
      }
      if (target.expected_size > MAX_VERIFICATION_BYTES) throw new Problem(413, 'VERIFICATION_SIZE_LIMIT');
      const object = await call('/storage/v1/object/authenticated/' + target.bucket + '/' + parts.map(encodeURIComponent).join('/'), {
        headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Accept-Encoding': 'identity' },
      });
      if (!object.ok) {
        await object.body?.cancel();
        throw new Problem(object.status === 429 ? 429 : object.status === 408 || object.status >= 500 ? 503 : 409, 'PRIVATE_OBJECT_UNAVAILABLE', retryHint(object));
      }
      // Do not trust catalog metadata, Content-Length or upload-success responses.
      const bytes = await boundedBytes(object, target.expected_size, true, controller.signal);
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
        throw new Problem(409, 'JPEG_FRAMING_MISMATCH');
      }
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
      if (digest !== target.expected_sha256) throw new Problem(409, 'CONTENT_HASH_MISMATCH');
      const receipt = await rpc('confirm_photo_transfer', {
        p_action: action, p_photo: photo, p_transfer_version: version, p_owner: user.id, p_session: claims.session_id,
        p_object_id: target.object_id, p_object_version: target.object_version, p_bucket: target.bucket,
        p_object_key: target.object_key, p_observed_sha256: digest, p_observed_size: bytes.length,
      });
      return resultResponse(200, null, minimalReceipt(receipt, photo, version));
    } catch (error) {
      return resultResponse(error instanceof Problem ? error.status : 503,
        error instanceof Problem ? error.code : 'VERIFICATION_UNAVAILABLE', undefined, error instanceof Problem ? error.retryAfter : undefined);
    } finally {
      clearTimeout(timer); inFlight -= 1;
    }
  };
}

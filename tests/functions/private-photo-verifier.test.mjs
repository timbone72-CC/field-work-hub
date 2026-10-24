import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoVerifier, MAX_VERIFICATION_BYTES } from '../../supabase/functions/verify-private-photo/handler.mjs';

const [action, photo, version, owner, session, object, org, wo, run, receipt] = Array.from({ length: 10 }, () => crypto.randomUUID());
// Synthetic framing/content fixture. This tests identity, not JPEG decoding or real Storage.
const bytes = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 0xff, 0xd9]);
const hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
const target = { photo_id: photo, transfer_version: version, state: 'WAITING', owner_user_id: owner,
  owner_session_id: session, bucket: 'fwh-review-private', object_key: `${org}/${wo}/${run}/${photo}.jpg`,
  expected_sha256: hash, expected_size: bytes.length, object_id: object, object_version: 'V1' };
const received = { photo_id: photo, transfer_version: version, state: 'RECEIVED', receipt_id: receipt };
const token = `header.${Buffer.from(JSON.stringify({ sub: owner, session_id: session })).toString('base64url')}.signature`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function request(body = { action_id: action, photo_id: photo, transfer_version: version }, headers = {}) {
  return new Request('https://example.invalid/verify-private-photo', { method: 'POST', headers: {
    Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
function fixture(overrides = {}, options = {}) {
  const calls = [];
  const handler = createPhotoVerifier({ url: 'https://disposable-project.supabase.co', anonKey: 'test-anon', serviceKey: 'test-service',
    ...options, fetcher: async (url, config) => {
      assert.equal(url.origin, 'https://disposable-project.supabase.co');
      assert.equal(config.redirect, 'error');
      assert.ok(config.signal instanceof AbortSignal);
      const path = url.pathname;
      calls.push({ path, config });
      const stage = path === '/auth/v1/user' ? 'auth' : path.endsWith('photo_verification_target_for_session') ? 'target'
        : path.endsWith('confirm_photo_transfer') ? 'confirm' : 'object';
      if (overrides[stage]) return overrides[stage](config);
      if (stage === 'auth') return json({ id: owner, is_anonymous: false });
      if (stage === 'target') return json(target);
      if (stage === 'object') return new Response(bytes);
      return json(received);
    } });
  return { handler, calls };
}

test('actual received bytes determine hash/size; fixed private path and minimal result', async () => {
  const { handler, calls } = fixture();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), received);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(calls.length, 4);
  assert.equal(calls[0].config.headers.Authorization, 'Bearer ' + token);
  assert.equal(calls[2].path, `/storage/v1/object/authenticated/fwh-review-private/${target.object_key}`);
  assert.equal(calls[2].config.headers.Authorization, 'Bearer test-service');
  const observed = JSON.parse(calls[3].config.body);
  assert.equal(observed.p_observed_sha256, hash);
  assert.equal(observed.p_observed_size, bytes.length);
  assert.equal(observed.p_object_version, 'V1');
  assert.equal(observed.p_session, session);
});

test('historical receipt retry returns exact proof without reading/replacing bytes', async () => {
  const { handler, calls } = fixture({ target: () => json(received) });
  const response = await handler(request());
  assert.deepEqual(await response.json(), received);
  assert.equal(calls.length, 2);
});

test('authentication, input and target failures never download or confirm', async t => {
  const cases = [
    ['no token', {}, { Authorization: '' }, 401],
    ['wrong browser origin', {}, { Origin: 'https://evil.invalid' }, 403],
    ['client path injection', {}, {}, 400, { action_id: action, photo_id: photo, transfer_version: version, object_key: 'arbitrary' }],
    ['unverified JWT', { auth: () => json({}, 401) }, {}, 401],
    ['Auth user disagrees with JWT', { auth: () => json({ id: crypto.randomUUID() }) }, {}, 401],
    ['anonymous Auth account', { auth: () => json({ id: owner, is_anonymous: true }) }, {}, 401],
    ['expired exact session', { target: () => json({ code: '42501', message: 'PRIVATE SQL MUST NOT LEAK' }, 403) }, {}, 403],
    ['wrong target owner', { target: () => json({ ...target, owner_user_id: crypto.randomUUID() }) }, {}, 409],
    ['wrong target session', { target: () => json({ ...target, owner_session_id: crypto.randomUUID() }) }, {}, 409],
    ['malicious target path', { target: () => json({ ...target, object_key: '../evil.jpg' }) }, {}, 409],
    ['oversize registered derivative', { target: () => json({ ...target, expected_size: MAX_VERIFICATION_BYTES + 1 }) }, {}, 413],
  ];
  for (const [name, overrides, headers, expected, body] of cases) await t.test(name, async () => {
    const { handler, calls } = fixture(overrides);
    const response = await handler(request(body, headers));
    assert.equal(response.status, expected);
    assert.ok(!calls.some(x => x.path.includes('/storage/') || x.path.endsWith('confirm_photo_transfer')));
    assert.ok(!(await response.text()).includes('PRIVATE SQL'));
  });
});

test('content/network failures cannot produce receipt; retries retain exact content identity', async t => {
  const cases = [
    ['changed byte', () => new Response(new Uint8Array([0xff, 0xd8, 9, 2, 3, 4, 0xff, 0xd9])), 409],
    ['truncated', () => new Response(bytes.slice(0, 6)), 409],
    ['extra byte', () => new Response(new Uint8Array([...bytes, 0])), 409],
    ['non JPEG framing', () => new Response(new Uint8Array(8)), 409],
    ['false content length', () => new Response(bytes.slice(0, 4), { headers: { 'Content-Length': '8' } }), 409],
    ['missing object', () => new Response(null, { status: 404 }), 409],
    ['permission failure', () => new Response(null, { status: 403 }), 409],
    ['request timeout', () => new Response(null, { status: 408 }), 503],
    ['transient failure', () => new Response(null, { status: 503 }), 503],
    ['rate limit', () => new Response(null, { status: 429 }), 429],
    ['redirect/network rejection', () => { throw new TypeError('redirect denied'); }, 503],
    ['stream interruption', () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 4)); c.error(new Error('disconnected')); } })), 503],
  ];
  for (const [name, objectRead, expected] of cases) await t.test(name, async () => {
    let fail = true;
    const { handler, calls } = fixture({ object: () => fail ? objectRead() : new Response(bytes) });
    const response = await handler(request());
    assert.equal(response.status, expected);
    assert.equal(calls.filter(x => x.path.endsWith('confirm_photo_transfer')).length, 0);
    fail = false;
    assert.equal((await handler(request())).status, 200);
    const confirm = calls.find(x => x.path.endsWith('confirm_photo_transfer'));
    assert.equal(JSON.parse(confirm.config.body).p_action, action);
    assert.equal(JSON.parse(confirm.config.body).p_object_id, object);
  });
});

test('catalog/session change at confirmation stays unreceived; no SQL/URL leakage', async () => {
  const { handler } = fixture({ confirm: () => json({ code: '22023', message: target.object_key }, 400) });
  const response = await handler(request());
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'TRANSFER_RECONCILIATION_REQUIRED' });
});

test('slow body deadline and isolate concurrency bound release readers for retry', async () => {
  let cancelled = 0;
  const { handler, calls } = fixture({ object: () => new Response(new ReadableStream({ cancel() { cancelled++; } })) }, { deadlineMs: 25 });
  const one = handler(request()); const two = handler(request());
  const busy = await handler(request());
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get('Retry-After'), '30');
  assert.equal((await one).status, 503); assert.equal((await two).status, 503);
  assert.equal(cancelled, 2);
  assert.equal(calls.filter(x => x.path.endsWith('confirm_photo_transfer')).length, 0);
  assert.equal((await handler(request())).status, 503);
  assert.equal(cancelled, 3);
});

test('runtime entry wires the tested handler; no elevated client code or external dependency', async () => {
  const prior = globalThis.Deno;
  let installed;
  globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: 'https://disposable-project.supabase.co', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service' })[name] }, serve: handler => { installed = handler; } };
  try { await import('../../supabase/functions/verify-private-photo/index.ts'); }
  finally { globalThis.Deno = prior; }
  assert.equal(typeof installed, 'function');
  assert.equal((await installed(new Request('https://example.invalid', { method: 'OPTIONS' }))).status, 200);
});

 test('upstream retry delay is preserved without leaking error bodies', async () => {
  const { handler } = fixture({ object: () => new Response('PRIVATE OBJECT ERROR', { status: 429, headers: { 'Retry-After': '120' } }) });
  const response = await handler(request());
  assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '120');
  assert.ok(!(await response.text()).includes('PRIVATE OBJECT ERROR'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivatePhotoViewer } from '../../supabase/functions/admin-private-photo/handler.mjs';

const [photo, version, owner, session, object, org, wo, run] =
  Array.from({ length: 8 }, () => crypto.randomUUID());
const path = `${org}/${wo}/${run}/${photo}.jpg`;
const target = { photo_id: photo, transfer_version: version,
  bucket: 'fwh-review-private', object_key: path, object_id: object, object_version: 'V1' };
const token = `header.${Buffer.from(JSON.stringify({ sub: owner, session_id: session })).toString('base64url')}.signed`;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
function input(data = { photo_id: photo, transfer_version: version }, extraHeaders = {}) {
  return new Request('https://any.invalid', { method: 'POST', headers: {
    Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...extraHeaders
  }, body: JSON.stringify(data) });
}
function fixture(overrides = {}) {
  const requests = [];
  const handle = createPrivatePhotoViewer({ url: 'https://fwh-disposable.supabase.co',
    anonKey: 'anon-test', serviceKey: 'service-test', fetcher: async (url, config) => {
      requests.push({ url, config });
      assert.equal(url.origin, 'https://fwh-disposable.supabase.co');
      assert.equal(config.redirect, 'error');
      const stage = url.pathname === '/auth/v1/user' ? 'auth'
        : url.pathname.endsWith('admin_private_photo_target_for_session') ? 'target' : 'sign';
      if (overrides[stage]) return overrides[stage](url, config);
      if (stage === 'auth') return json({ id: owner, is_anonymous: false });
      if (stage === 'target') return json(target);
      return json({ signedURL: `/object/sign/fwh-review-private/${path}?token=read-only-test` });
    } });
  return { handle, requests };
}

test('current office JWT authorizes an exact 120-second object link, no secret key returned', async () => {
  const { handle, requests } = fixture();
  const response = await handle(input());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store, private');
  const result = await response.json();
  assert.equal(result.photo_id, photo);
  assert.equal(result.transfer_version, version);
  assert.equal(result.expires_in, 120);
  assert.equal(result.url, `https://fwh-disposable.supabase.co/storage/v1/object/sign/fwh-review-private/${path}?token=read-only-test`);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].config.headers.Authorization, 'Bearer ' + token);
  assert.equal(requests[1].config.headers.Authorization, 'Bearer service-test');
  assert.deepEqual(JSON.parse(requests[1].config.body),
    { p_photo: photo, p_transfer_version: version, p_actor: owner, p_session: session });
  assert.equal(JSON.parse(requests[2].config.body).expiresIn, 120);
  assert.equal(requests[2].config.headers.Authorization, 'Bearer service-test');
  assert.ok(!JSON.stringify(result).includes('service-test'));
});
test('caller never chooses bucket, object key, other actor or preview TTL', async () => {
  for (const bad of [{ ...target }, { photo_id: photo, transfer_version: version, bucket: 'other' },
    { photo_id: photo, transfer_version: version, expires_in: 86400 }]) {
    const { handle, requests } = fixture();
    assert.equal((await handle(input(bad))).status, 400);
    assert.equal(requests.length, 0);
  }
});
test('unverified, anonymous, expired or unauthorized office sessions never sign storage URLs', async () => {
  const cases = [
    { auth: () => json({}, 401) }, { auth: () => json({ id: crypto.randomUUID(), is_anonymous: false }) },
    { auth: () => json({ id: owner, is_anonymous: true }) },
    { target: () => json({ code: '42501', message: 'PRIVATE BACKEND DATA' }, 403) },
    { target: () => json({ ...target, bucket: 'public' }) },
    { target: () => json({ ...target, object_key: `../${photo}.jpg` }) },
    { target: () => json({ ...target, photo_id: crypto.randomUUID() }) },
    { target: () => json({ ...target, object_id: 'invalid' }) },
  ];
  for (const overrides of cases) {
    const { handle, requests } = fixture(overrides);
    const result = await handle(input());
    assert.ok([401,403,409].includes(result.status), String(result.status));
    assert.equal(requests.filter(r => r.url.pathname.includes('/storage/')).length, 0);
    assert.ok(!(await result.text()).includes('PRIVATE BACKEND'));
  }
});
test('signer cannot substitute another destination, redirect host, query or unlimited token lifetime', async () => {
  const urls = [
    'https://evil.invalid/object/sign/other?token=x',
    `/object/sign/fwh-review-private/${org}/${wo}/${run}/evil.jpg?token=x`,
    `/object/sign/fwh-review-private/${path}?token=x&download=1`,
    `/object/sign/fwh-review-private/${path}?foo=1`,
    `/object/sign/fwh-review-private/${path}?token=x#hash`,
  ];
  for (const signedURL of urls) {
    const { handle } = fixture({ sign: () => json({ signedURL }) });
    const result = await handle(input());
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { error: 'SIGNATURE_UNAVAILABLE' });
  }
});
test('anonymous, foreign browser origins and unsupported verbs are denied before network', async () => {
  const { handle, requests } = fixture();
  const foreign = await handle(input(undefined, { Origin: 'https://evil.invalid' }));
  assert.equal(foreign.status, 403);
  const noToken = await handle(input(undefined, { Authorization: '' }));
  assert.equal(noToken.status, 401);
  const put = await handle(new Request('https://any.invalid', { method: 'PUT' }));
  assert.equal(put.status, 405);
  assert.equal(requests.length, 0);
});
test('runtime entry wires the same tested handler', async () => {
  const existing = globalThis.Deno;
  let installed;
  globalThis.Deno = {
    env: { get: key => ({ SUPABASE_URL: 'https://fwh-disposable.supabase.co',
      SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' })[key] },
    serve: handler => { installed = handler; }
  };
  try { await import('../../supabase/functions/admin-private-photo/index.ts'); }
  finally { globalThis.Deno = existing; }
  assert.equal(typeof installed, 'function');
  assert.equal((await installed(new Request('https://any.invalid', { method: 'OPTIONS' }))).status, 200);
});

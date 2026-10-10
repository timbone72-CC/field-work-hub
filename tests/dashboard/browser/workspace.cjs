/* Disposable browser fixtures: block every backend request and never use live identities. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '../../../dashboard');
const output = process.env.FWH_BROWSER_OUTPUT || '/tmp/fwh-browser-evidence';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const organization = uuid(9001), contractor = uuid(9002);
let admin = uuid(9003), failSave = false, failDetail = false, delayPage = null, delayDetail = null;
let reviewedDecision = 'PENDING', reviewedRevision = null;
const reviewPhoto = uuid(9901), reviewVersion = uuid(9902), reviewRun = uuid(9903);
const reviewPackageId=uuid(9991), approvedHash='a'.repeat(64);
let selectedCompany=null, reviewRequired=true, reviewPolicyRevision=uuid(9980), simulatedPackage=null;
const rows = Array.from({ length: 1000 }, (_, i) => ({ id: uuid(i + 1), organization_id: organization,
  assigned_user_id: contractor, pending_assignee_user_id: null, reassignment_requested_at: null,
  assignment_received_at: null, wo_number: `DEMO-${String(i + 1).padStart(4, '0')}`,
  property_address: i < 50 ? '100 Example Street, Unit A' : `${i + 100} Example Street`, work_type: 'Property inspection',
  instructions: 'Record the requested inspection photos.', due_date: '2026-10-15', field_status: 'ASSIGNED',
  created_at: '2026-10-01T12:00:00Z', current_run_id: null, run: null }));
const requests = [], saves = [], errors = [];
const wait = async (page, condition) => page.waitForFunction(condition);
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    const file = path.join(root, name === '/' ? 'index.html' : name);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('https://**/*', async route => {
      const req = route.request(), url = new URL(req.url()); requests.push(url.pathname + url.search);
      const reply = (body, status = 200, headers = {}) => route.fulfill({ status, headers: { 'Content-Type': 'application/json', 'Access-Control-Expose-Headers': 'Content-Range', ...headers }, body: JSON.stringify(body) });
      if (url.pathname === '/auth/v1/token') return reply({ access_token: 'disposable-test-access', refresh_token: 'disposable-test-refresh', expires_in: 3600 });
      if (url.pathname === '/auth/v1/user') return reply({ id: admin, email: 'admin@example.invalid', app_metadata: { role: 'ADMIN', organization_id: organization } });
      if (url.pathname === '/rest/v1/photo_templates') return reply([]);
      if (url.pathname.endsWith('/admin_list_assignable_users')) return reply([{ user_id: contractor, email: 'contractor@example.invalid', role: 'CONTRACTOR' }]);
      if (url.pathname.endsWith('/admin_client_choices')) {
        const p=req.postDataJSON();
        return reply({work_order_id:p.p_wo,client_company_id:selectedCompany,review_required:reviewRequired,
          revision:reviewPolicyRevision,companies:[{id:uuid(9981),name:'DISPOSABLE COMPANY'}]});
      }
      if (url.pathname.endsWith('/admin_set_review_required')) {
        const p=req.postDataJSON();assert.equal(p.p_expected_revision,reviewPolicyRevision);
        assert.ok(p.p_reason);reviewRequired=p.p_required;reviewPolicyRevision=uuid(9982);
        return reply({work_order_id:p.p_work_order,review_required:reviewRequired,review_policy_revision:reviewPolicyRevision});
      }
      if (url.pathname.endsWith('/admin_assign_client_company')) {
        const p=req.postDataJSON();assert.equal(p.p_company,uuid(9981));
        assert.equal(p.p_expected_policy_revision,reviewPolicyRevision);
        selectedCompany=p.p_company;reviewPolicyRevision=uuid(9983);
        return reply({work_order_id:p.p_work_order,company_id:selectedCompany,
          review_policy_revision:reviewPolicyRevision});
      }
      if (url.pathname.endsWith('/admin_package_state')) {
        const p=req.postDataJSON();
        return reply({work_order_id:p.p_wo,available_photos:selectedCompany
          ? [{photo_id:reviewPhoto,transfer_version:reviewVersion,decision:'APPROVED',requirement_label:'Extra'}]:[],
          too_many_photos:false,coverage_message:'Release goals verified',
          destination:selectedCompany?{verified:true,company_name:'DISPOSABLE COMPANY'}:null,
          package:simulatedPackage});
      }
      if (url.pathname.endsWith('/admin_save_package_draft')) {
        const p=req.postDataJSON();assert.equal(p.p_wo,uuid(51));
        assert.deepEqual(p.p_photo_ids,[reviewPhoto]);
        assert.equal(p.p_expected_revision,null);
        simulatedPackage={id:reviewPackageId,status:'DRAFT',revision:uuid(9992),
          notes:p.p_notes,photos:[{photo_id:reviewPhoto}],manifest_sha256:approvedHash,
          ready_to_approve:true,can_send:false};
        return reply({id:reviewPackageId,revision:simulatedPackage.revision,status:'DRAFT'});
      }
      if (url.pathname.endsWith('/admin_preview_package')) {
        const p=req.postDataJSON();assert.equal(p.p_package,reviewPackageId);
        assert.equal(p.p_expected_revision,simulatedPackage.revision);
        return reply({package_id:reviewPackageId,revision:simulatedPackage.revision,
          manifest_sha256:approvedHash,manifest:{client_company_id:selectedCompany,
            client_wo_number:'DEMO-0051',client_notes:simulatedPackage.notes,
            destination_root:'DISPOSABLE VERIFIED TEST',destination_provider:'GOOGLE_DRIVE',
            review_required:reviewRequired,requirements:{},selected_photos:[{photo_id:reviewPhoto}]}});
      }
      if (url.pathname.endsWith('/admin_approve_package')) {
        const p=req.postDataJSON();assert.equal(p.p_package,reviewPackageId);
        assert.equal(p.p_manifest_sha256,approvedHash);
        simulatedPackage={...simulatedPackage,status:'APPROVED',revision:uuid(9993),
          ready_to_approve:false,can_send:false};
        return reply({package_id:reviewPackageId,status:'APPROVED',revision:simulatedPackage.revision});
      }
      if (url.pathname.endsWith('/admin_list_private_review_photos')) {
        const args = req.postDataJSON();
        assert.equal(args.p_limit, 25);
        return reply({ work_order_id: args.p_work_order,
          photos: [{ photo_id: reviewPhoto, transfer_version: reviewVersion, run_id: reviewRun,
            requirement_item_id: null, captured_at: '2026-10-01T12:00:00Z',
            verified_at: '2026-10-01T12:02:00Z', decision: reviewedDecision,
            decision_revision: reviewedRevision, reason: null }], next_photo: null });
      }
      if (url.pathname.endsWith('/admin_review_photo')) {
        const p = req.postDataJSON();
        assert.equal(p.p_photo, reviewPhoto);
        assert.equal(p.p_transfer_version, reviewVersion);
        assert.equal(p.p_expected_revision, reviewedRevision);
        assert.equal(p.p_reason, '');
        assert.equal(p.p_decision, 'APPROVED');
        reviewedDecision = 'APPROVED';
        reviewedRevision = uuid(9955);
        return reply({ action_id: p.p_action, photo_id: reviewPhoto, transfer_version: reviewVersion,
          work_order_id: p.p_work_order, decision: reviewedDecision, decision_revision: reviewedRevision });
      }
      if (url.pathname === '/functions/v1/admin-private-photo') {
        const p = req.postDataJSON();
        assert.equal(p.photo_id, reviewPhoto); assert.equal(p.transfer_version, reviewVersion);
        return reply({ photo_id: reviewPhoto, transfer_version: reviewVersion, expires_in: 120,
          url: `https://vyocaujuwrivoqynvitm.supabase.co/storage/v1/object/sign/fwh-review-private/${organization}/${uuid(51)}/${reviewRun}/${reviewPhoto}.jpg?token=disposable-preview` });
      }
      if (url.pathname.startsWith('/storage/v1/object/sign/fwh-review-private/')) {
        assert.equal(url.searchParams.get('token'), 'disposable-preview');
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jUlkAAAAASUVORK5CYII=', 'base64');
        return route.fulfill({ status: 200, headers: { 'Content-Type': 'image/png' }, body: png });
      }
      if (url.pathname.endsWith('/admin_get_contractor_seat_summary')) return reply([{ available_seats: 0, used_seats: 2, seat_limit: 2, pending_invitations: 0 }]);
      if (url.pathname.endsWith('/admin_list_pending_contractor_invitations')) return reply([]);
      if (url.pathname.endsWith('/admin_update_work_order_v4')) {
        const payload = req.postDataJSON(); saves.push(payload);
        if (failSave) return reply({ message: 'Controlled save failure' }, 409);
        const row = rows.find(r => r.id === payload.p_work_order_id);
        Object.assign(row, { property_address: payload.p_property_address, instructions: payload.p_instructions,
          wo_number: payload.p_wo_number, assigned_user_id: payload.p_assigned_user_id, due_date: payload.p_due_date,
          work_type: payload.p_work_type, run: { requirement_snapshot: payload.p_requirements } });
        return reply([{ work_order_id: row.id, wo_number: row.wo_number, pending_assignee_user_id: null }]);
      }
      if (url.pathname === '/rest/v1/work_orders') {
        const id = url.searchParams.get('id');
        if (id) {
          if (delayDetail) { const pending = delayDetail; delayDetail = null; await pending; }
          if (failDetail) return reply({ message: 'Controlled detail refresh failure' }, 503);
          assert.equal(url.searchParams.get('limit'), '1');
          return reply(rows.filter(row => `eq.${row.id}` === id));
        }
        const size = Number(url.searchParams.get('limit')), offset = Number(url.searchParams.get('offset'));
        assert.ok([25, 50].includes(size), 'Every table read must be bounded');
        assert.equal(req.headers().prefer, 'count=exact');
        assert.equal(url.searchParams.has('organization_id'), false);
        let data = rows.slice();
        if (url.searchParams.get('field_status')) data = data.filter(row => `eq.${row.field_status}` === url.searchParams.get('field_status'));
        for (const field of ['property_address', 'wo_number']) if (url.searchParams.has(field)) {
          const text = url.searchParams.get(field).slice(7, -1).replace(/\\(.)/g, '$1').toLowerCase();
          data = data.filter(row => row[field].toLowerCase().includes(text));
        }
        const pageRows = structuredClone(data.slice(offset, offset + size));
        if (delayPage) { const pending = delayPage; delayPage = null; await pending; }
        return reply(pageRows, 200, { 'Content-Range': pageRows.length ? `${offset}-${offset + pageRows.length - 1}/${data.length}` : `*/${data.length}` });
      }
      errors.push(`Unexpected external request ${url.pathname}`); return reply({ message: 'Blocked test request' }, 503);
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    async function login() {
      await page.locator('#email').fill('admin@example.invalid'); await page.locator('#password').fill('disposable');
      await page.locator('#sign-in').click(); await wait(page, () => document.querySelectorAll('.job-table tbody tr').length === 25);
      await page.evaluate(() => stopAdminAutoRefresh());
    }
    await login();
    assert.match(await page.locator('#job-page-info').innerText(), /1–25 of 1000/);
    assert.equal(await page.locator('details.admin-action[open]').count(), 0);
    await page.screenshot({ path: path.join(output, 'dashboard-desktop.png'), fullPage: true });
    await page.locator('.job-link').first().click(); await wait(page, () => document.querySelector('dialog').open);
    const first = await page.locator('#edit-work-order-id').inputValue();
    await page.locator('#edit-instructions').fill('Unsaved office instruction');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog').evaluate(el => el.open), true);
    await page.locator('#job-stay').click(); assert.equal(await page.locator('#edit-instructions').inputValue(), 'Unsaved office instruction');
    await page.locator('#job-next').click(); await page.locator('#job-discard').click();
    await wait(page, () => document.querySelector('#edit-work-order-id').value !== '00000000-0000-4000-8000-000000000001');
    const second = await page.locator('#edit-work-order-id').inputValue(); assert.notEqual(first, second);
    await page.locator('#edit-instructions').fill('Save then switch'); failSave = true;
    await page.locator('#job-next').click(); await page.locator('#job-save-continue').click();
    await wait(page, () => document.querySelector('#edit-status').textContent.includes('Controlled save failure'));
    assert.equal(await page.locator('#edit-work-order-id').inputValue(), second);
    assert.equal(await page.locator('#edit-instructions').inputValue(), 'Save then switch');
    failSave = false; await page.locator('#job-save-continue').click();
    await wait(page, () => document.querySelector('#edit-work-order-id').value === '00000000-0000-4000-8000-000000000003');
    assert.equal(rows[1].instructions, 'Save then switch'); assert.equal(saves.at(-1).p_work_order_id, second);
    await page.locator('#edit-instructions').fill('Keep across automatic refresh');
    rows[2].assignment_received_at = '2026-10-07T12:00:00Z';
    await page.evaluate(async () => { await refreshAdminViewAutomatically(); stopAdminAutoRefresh(); });
    assert.equal(await page.locator('#edit-instructions').inputValue(), 'Keep across automatic refresh');
    assert.match(await page.locator('#edit-status').innerText(), /changed on the server/);
    await page.evaluate(async () => { document.getElementById('job-status').value = 'FIELD_COMPLETE'; document.getElementById('job-filters').requestSubmit(); });
    await wait(page, () => document.querySelector('#job-page-info').textContent.includes('No jobs'));
    assert.match(await page.locator('#job-context').innerText(), /outside the current page/);
    assert.equal(await page.locator('#edit-work-order-id').inputValue(), uuid(3));
    await page.locator('#cancel-edit').click(); await page.locator('#job-discard').click();
    await page.locator('#job-status').selectOption(''); await page.locator('#job-page-size').selectOption('50');
    await page.locator('#job-search').fill('100 Example Street'); await page.locator('#job-filters button').click();
    await wait(page, () => document.querySelectorAll('.job-table tbody tr').length === 50);
    assert.match(await page.locator('#job-page-info').innerText(), /of 50/);
    let release; delayPage = new Promise(resolve => { release = resolve; });
    await page.evaluate(() => document.getElementById('job-filters').requestSubmit());
    await page.locator('#job-search').fill('no matching address'); await page.locator('#job-filters button').click();
    await wait(page, () => document.querySelector('#job-page-info').textContent.includes('No jobs'));
    release(); await page.waitForTimeout(100);
    assert.equal(await page.locator('.job-table tbody tr').count(), 0, 'Stale filtered page must not replace newer search');
    await page.locator('#job-search').fill(''); await page.locator('#job-filters button').click();
    await wait(page, () => document.querySelectorAll('.job-table tbody tr').length === 50);
    await page.locator('#job-page-next').click(); await wait(page, () => document.querySelector('#job-page-info').textContent.includes('51–100'));
    await page.locator('.job-link').first().click(); await wait(page, () => document.querySelector('dialog').open);
    await page.locator('#edit-instructions').fill('Accepted write with failed read'); failDetail = true;
    await page.locator('#save-edit').click(); await wait(page, () => document.querySelector('#edit-status').textContent.includes('Changes saved. Unable'));
    const count = saves.length; await page.locator('#save-edit').click(); assert.equal(saves.length, count, 'Must not repeat accepted mutation when revision refresh fails');
    failDetail = false; await page.locator('#job-reload').click(); await wait(page, () => document.querySelector('#job-reload').hidden);
    await page.screenshot({ path: path.join(output, 'workspace-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-job-tab="photos"]').click();
    await wait(page, () => document.querySelectorAll('.private-review-photo').length === 1);
    assert.equal(await page.locator('#private-review-list strong').innerText(), 'Photo 00000000 · PENDING');
    assert.equal(await page.locator('.private-review-photo').getByRole('button', { name: 'Approve' }).isDisabled(), true,
      'An Admin must actually preview a verified image before approving it');
    assert.equal(await page.locator('#save-edit').isVisible(), false, 'Photo decisions must not look like ordinary WO save');
    await page.locator('.private-review-photo').getByRole('button', { name: 'Preview photo' }).click();
    await wait(page, () => !document.querySelectorAll('.private-review-photo button')[1].disabled);
    await page.locator('.private-review-photo').getByRole('button', { name: 'Approve' }).click();
    await wait(page, () => document.querySelector('#private-review-list strong')?.textContent.includes('APPROVED'));
    assert.equal(reviewedDecision, 'APPROVED');
    await page.locator('[data-job-tab="delivery"]').click();
    await wait(page, () => document.querySelector('#release-status').textContent.includes('No package saved'));
    assert.equal(await page.locator('#release-send').isDisabled(), true, 'No verified destination or approved package: no Send');
    assert.equal(await page.locator('#release-approve').isDisabled(), true, 'No draft: no Approve');
    assert.equal(requests.some(x => x.includes('admin_queue_package')), false, 'Preview/navigation cannot Send');
    await page.locator('#release-company').selectOption(uuid(9981));
    await page.locator('#release-assign-company').click();
    await wait(page, () => document.querySelector('#release-status').textContent.includes('No package saved'));
    assert.equal(selectedCompany,uuid(9981));
    await page.locator('#release-photo-list input[type=checkbox]').check();
    await page.locator('#release-notes').fill('Verified mock client notes');
    await page.locator('#release-save').click();
    await wait(page, () => document.querySelector('#release-status').textContent.includes('Package DRAFT'));
    assert.equal(await page.locator('#release-approve').isDisabled(), true,
      'Approval cannot precede viewing the exact preview');
    await page.locator('#release-preview').click();
    await wait(page, () => !document.querySelector('#release-exact-preview').hidden);
    assert.match(await page.locator('#release-exact-preview').innerText(), /DISPOSABLE VERIFIED TEST/);
    await page.locator('#release-approve').click();
    await wait(page, () => document.querySelector('#release-status').textContent.includes('Package APPROVED'));
    assert.equal(await page.locator('#release-send').isDisabled(), true,
      'Unverified trusted provider worker still prevents Send after approval');
    assert.equal(requests.some(x => x.includes('admin_queue_package')), false,
      'No client delivery can happen without explicit enabled Send');
    await page.locator('[data-job-tab="requirements"]').click();
    assert.equal(await page.locator('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'Mobile workspace must not require sideways scrolling');
    await page.screenshot({ path: path.join(output, 'workspace-mobile.png'), fullPage: true });
    await page.locator('#edit-photo-requirements').getByRole('button', { name: 'Add photo item', exact: true }).click();
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#job-unsaved').isVisible(), true, 'Requirement button edits are protected');
    await page.locator('#job-discard').click();
    await page.setViewportSize({ width: 1280, height: 900 });
    // Account switch clears searches, selected work, and visible edits; only whitelisted preferences remain.
    await page.locator('#sign-out').click(); admin = uuid(9010); await login();
    assert.equal(await page.locator('#job-page-size').inputValue(), '25');
    assert.equal(await page.locator('#job-search').inputValue(), ''); assert.equal(await page.locator('#edit-work-order-id').inputValue(), '');
    const preferences = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('fwh.jobView.')));
    assert.ok(preferences.length > 0);
    for (const [, value] of preferences) assert.deepEqual(Object.keys(JSON.parse(value)).sort(), ['size', 'sort', 'status']);
    let releaseDetail; delayDetail = new Promise(resolve => { releaseDetail = resolve; });
    await page.locator('.job-link').first().click(); await page.locator('#sign-out').click(); releaseDetail(); await page.waitForTimeout(100);
    assert.equal(await page.locator('dialog').evaluate(el => el.open), false);
    assert.equal(await page.locator('#edit-work-order-id').inputValue(), '');
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(requests.filter(url => url.startsWith('/storage/v1/object/sign/')).length, 1,
      'Private image access is on-demand, bounded to one verified preview');
    assert.equal(requests.some(url => url.includes('work_order_photos')), false, 'List selection does not fetch all photos');
    console.log('PASS: bounded 1,000-job paging, 50 same-address results, UUID navigation, Save/Stay/Discard and requirements edits, failed save/read recovery, stale refresh, account/sign-out isolation, desktop/mobile workspace. No live backend traffic.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

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
let syntheticOwner=false,ownerTier=2,ownerTierRevision=uuid(9211),ownerQuotaRevision=uuid(9212),ownerAdminLimit=4;
let ownerScope=[uuid(9213)],ownerWrites=[],ownerRejectNext=false;
let ownerPersonActive=true,ownerAccessRevision=uuid(9223),ownerAccessWrites=[];
let ownerEnrolled=false,ownerEnrollWrites=[],ownerEnrolledGrantActive=true,ownerEnrolledGrantRevision=uuid(9234),ownerGrantWrites=[];
let ownerEnrollFailOnce=true;
let ownerRosterTeam=null,ownerRosterRevision=null,ownerRosterWrites=[],ownerRosterBusyOnce=true;

let reviewedDecision = 'PENDING', reviewedRevision = null;
let bulkSaves = [], bulkConflict = false;
let largeReview=false,maxPhotoPage=0;
const reviewPhoto = uuid(9901), reviewVersion = uuid(9902), reviewRun = uuid(9903);
const reviewPackageId=uuid(9991), approvedHash='a'.repeat(64);
let selectedCompany=null, reviewRequired=true, reviewPolicyRevision=uuid(9980), simulatedPackage=null;
let largePackage=false,packagePageCalls=0,persistedPackagePhotoIds=[];
const alertTypes=['READY_FOR_REVIEW','FOLLOWUP_READY_FOR_REVIEW','ASSIGNMENT_NEEDS_ACCEPT','ACCEPT_REMINDER',
  'OVERDUE','UPLOAD_PROBLEM','APP_OR_SYNC_PROBLEM','DELIVERY_PROBLEM','CLIENT_DELIVERED'];
const syntheticAlertId=uuid(9754),alertRun=uuid(9755);
let alertSettings=new Map(),alertReceipt=null,alertWrites=[],alertOrgTimezone=null;
const templateRows=[];
const optionalTemplate=()=>({schema:1,revision:uuid(9978),total:{enabled:false,minimum:0},items:[]});
let templateSaves=[];
const correctiveOriginalRun=uuid(9961),correctiveNewRun=uuid(9962);
let correctionDraftRev=uuid(9963);const correctionHash='c'.repeat(64);
let correctionIssues=[];
let correctionDraft=null,correctionPreviewCount=0,correctionDispatchCount=0;
let cancelCount=0,replaceCount=0,managementStatus='ASSIGNED';
const replacementRun=uuid(9979);
let correctionRequest=null;
const correctionBase=()=>({
  work_order_id:uuid(51),client_wo_number:'DEMO-0051',client_company_id:uuid(9981),
  work_type:'Property inspection',origin_run_id:correctiveOriginalRun,
  expected_wo_updated_at:'2026-10-11T20:00:00Z',kind:'INTERNAL_CORRECTION',
  current_assignee:contractor,current_due_date:'2026-10-15',
  release_requirements:{schema:1,revision:uuid(9965),
    total:{enabled:false,minimum:0},items:[]}
});
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
    await context.addInitScript(()=>{
      window.__permissionRequestCount=0;
      if(window.Notification?.requestPermission){
        const original=window.Notification.requestPermission.bind(window.Notification);
        window.Notification.requestPermission=(...args)=>{
          window.__permissionRequestCount++;return original(...args);
        };
      }
    });
    await context.route('https://**/*', async route => {
      const req = route.request(), url = new URL(req.url()); requests.push(url.pathname + url.search);
      const reply = (body, status = 200, headers = {}) => route.fulfill({ status, headers: { 'Content-Type': 'application/json', 'Access-Control-Expose-Headers': 'Content-Range', ...headers }, body: JSON.stringify(body) });
      if (url.pathname.endsWith('/review_account_work_access')) {
        const p=req.postDataJSON();assert.equal(p.p_target,uuid(9214));
        return reply({organization_id:organization,target_user_id:uuid(9214),
          target_role:'SUPERVISOR',active:ownerPersonActive,requested_active:p.p_active,
          access_revision:ownerAccessRevision,review_fingerprint:'a'.repeat(64),
          affected_jobs:2,in_progress_jobs:1,field_complete_jobs:0,
          teams:[{team_id:uuid(9213),name:'West test team',affected_jobs:2,
            manager_count:1,manager_user_ids:[admin]}],total_teams:1,next_team:null,
          continuity_required:!p.p_active});
      }
      if (url.pathname.endsWith('/set_reviewed_account_work_access')) {
        const p=req.postDataJSON();ownerAccessWrites.push(p);
        assert.equal(p.p_expected_revision,ownerAccessRevision);
        assert.equal(p.p_review_fingerprint,'a'.repeat(64));
        if (!p.p_active) assert.deepEqual(p.p_continuity,[{
          team_id:uuid(9213),decision:'KEEP_MANAGER',manager_user_id:admin
        }]);
        else assert.deepEqual(p.p_continuity,[]);
        ownerPersonActive=p.p_active;ownerAccessRevision=uuid(9225);
        return reply([{action_id:p.p_action,target_user_id:p.p_target,active:p.p_active,
          revision:ownerAccessRevision,recovery_grant_id:p.p_active?null:p.p_action}]);
      }
      if (url.pathname.startsWith('/rest/v1/rpc/owner_')) {
        if (!syntheticOwner) return reply({message:'Verified Product Owner required'},403);
        const p=req.postDataJSON();
        assert.equal(p.p_environment,'TEST');
        assert.equal(p.p_org,organization);
        if (url.pathname.endsWith('owner_office_capacity_status')) return reply({
          organization_id:organization,revision:ownerQuotaRevision,
          admin_limit:ownerAdminLimit,admin_active:2,admin_reserved:1,admin_available:ownerAdminLimit-3,
          supervisor_limit:4,supervisor_active:1,supervisor_reserved:0,supervisor_available:3
        });
        if (url.pathname.endsWith('owner_supervisor_grant_list')) return reply([{
          user_id:uuid(9214),account_email:'supervisor@example.invalid',tier:ownerTier,grant_active:true,grant_revision:ownerTierRevision,
          work_active:true,team_count:ownerScope.length
        }, ...(ownerEnrolled ? [{user_id:uuid(9231),account_email:'new-supervisor@example.invalid',
          tier:1,grant_active:ownerEnrolledGrantActive,grant_revision:ownerEnrolledGrantRevision,work_active:false,team_count:1}] : [])]);
        if (url.pathname.endsWith('owner_office_people_list')) return reply([
          {user_id:admin,account_email:'admin@example.invalid',work_role:'ADMIN',
            work_active:true,access_revision:uuid(9221)},
          {user_id:uuid(9214),account_email:'supervisor@example.invalid',
            work_role:'SUPERVISOR',work_active:ownerPersonActive,
            access_revision:ownerAccessRevision,identity_ready:true},
          {user_id:uuid(9231),account_email:'new-supervisor@example.invalid',
            work_role:'SUPERVISOR',work_active:false,
            access_revision:uuid(9232),identity_ready:true},
          {user_id:uuid(9241),account_email:'contractor-roster@example.invalid',
            work_role:'CONTRACTOR',work_active:true,identity_ready:true,
            access_revision:uuid(9242),roster_team_id:ownerRosterTeam,
            roster_revision:ownerRosterRevision}
        ]);
        if (url.pathname.endsWith('owner_office_team_list')) return reply([{
          team_id:uuid(9213),team_name:'West test team',active:true,revision:uuid(9215),admin_count:1
        },{
          team_id:uuid(9216),team_name:'East test team',active:true,revision:uuid(9219),admin_count:1
        }]);
        if (url.pathname.endsWith('owner_supervisor_team_scope_list')) return reply(ownerScope.map(team_id=>({team_id})));
        ownerWrites.push({name:url.pathname.split('/').at(-1),...p});
        if (url.pathname.endsWith('manage_idle_contractor_roster')) {
          ownerRosterWrites.push(p);
          assert.equal(p.p_user,uuid(9241));
          assert.equal(p.p_expected_revision,ownerRosterRevision);
          if (ownerRosterTeam === uuid(9213) && ownerRosterBusyOnce) {
            ownerRosterBusyOnce=false;
            return reply({message:'Contractor has open assignments; separate handoff required'},409);
          }
          const previous = ownerRosterTeam;
          ownerRosterTeam=p.p_team;
          ownerRosterRevision=uuid(previous?9244:9243);
          return reply({action_id:p.p_action,user_id:p.p_user,old_team_id:previous,
            new_team_id:ownerRosterTeam,revision:ownerRosterRevision,
            action_kind:previous?'TRANSFER':'PLACE'});
        }
        if (url.pathname.endsWith('owner_set_supervisor_grant_state')) {
          ownerGrantWrites.push(p);
          assert.equal(p.p_user,uuid(9231));
          assert.equal(p.p_expected_grant_revision,ownerEnrolledGrantRevision);
          assert.equal(p.p_expected_access_revision,uuid(9232));
          assert.notEqual(p.p_active,ownerEnrolledGrantActive);
          ownerEnrolledGrantActive=p.p_active;
          ownerEnrolledGrantRevision=uuid(ownerEnrolledGrantActive?9236:9235);
          return reply(ownerEnrolledGrantRevision);
        }
        if (url.pathname.endsWith('owner_enroll_supervisor_with_seat')) {
          ownerEnrollWrites.push(p);
          assert.equal(p.p_user,uuid(9231));
          assert.equal(p.p_expected_access_revision,uuid(9232));
          assert.equal(p.p_tier,1);
          assert.deepEqual(p.p_team_ids,[uuid(9213)]);
          assert.match(p.p_action,/^[a-f0-9-]{36}$/);
          assert.equal(ownerEnrolled,false,'Enrollment must create only one grant');
          if (ownerEnrollFailOnce) {
            ownerEnrollFailOnce=false;
            return reply({message:'Temporary gateway failure; verify enrollment state'},503);
          }
          ownerEnrolled=true;
          return reply(uuid(9234));
        }
        if (url.pathname.endsWith('owner_change_supervisor_tier')) {
          assert.equal(p.p_expected_revision,ownerTierRevision);
          ownerTier=p.p_tier;ownerTierRevision=uuid(9217);return reply(ownerTierRevision);
        }
        if (url.pathname.endsWith('owner_set_supervisor_team_scope')) {
          if (ownerRejectNext) {ownerRejectNext=false;return reply({message:'Work scope changed; reload before saving'},409);}
          assert.equal(p.p_expected_revision,ownerTierRevision);
          ownerScope=p.p_allowed?[p.p_team]:[];ownerTierRevision=uuid(9218);return reply(ownerTierRevision);
        }
        if (url.pathname.endsWith('owner_set_office_allowances')) {
          assert.equal(p.p_expected_revision,ownerQuotaRevision);
          assert.equal(p.p_admin_limit,5);ownerAdminLimit=p.p_admin_limit;ownerQuotaRevision=uuid(9219);return reply(ownerQuotaRevision);
        }
        throw Error('Unexpected owner request');
      }
      if (url.pathname === '/auth/v1/token') return reply({ access_token: 'disposable-test-access', refresh_token: 'disposable-test-refresh', expires_in: 3600 });
      if (url.pathname === '/auth/v1/user') return reply({ id: admin, email: 'admin@example.invalid', app_metadata: { role: 'ADMIN', organization_id: organization } });
      if (url.pathname === '/rest/v1/photo_templates') return reply(templateRows);
      if (url.pathname.endsWith('/admin_save_company_photo_template')) {
        const payload=req.postDataJSON();templateSaves.push(payload);
        const saved={id:payload.p_id,company_id:payload.p_company_id,revision:uuid(9977),
          name:payload.p_name,work_type:payload.p_work_type,
          description:payload.p_description,instructions:payload.p_instructions,
          requirements:payload.p_requirements,active:payload.p_active,is_default:payload.p_is_default};
        templateRows.push(saved);return reply(saved);
      }
      if (url.pathname.endsWith('/admin_followup_management_state')) {
        const p=req.postDataJSON();assert.equal(p.p_wo,uuid(51));
        const active=correctionDispatchCount>0&&rows[50].current_run_id!==correctiveOriginalRun;
        return reply({work_order_id:uuid(51),available:active,
          run_id:rows[50].current_run_id,status:rows[50].field_status,
          wo_number:rows[50].wo_number,company_id:uuid(9981),
          expected_wo_updated_at:'2026-10-11T20:00:01Z',
          obligation_id:uuid(9989),kind:'INTERNAL_CORRECTION',
          reason:'Replace exterior evidence',assigned_user_id:contractor,due_date:'2026-10-22',
          can_cancel:active&&rows[50].field_status==='ASSIGNED',
          can_replace:active&&rows[50].field_status==='CANCELLED',
          historical_run_id:correctiveOriginalRun});
      }
      if (url.pathname.endsWith('/admin_cancel_untouched_followup')) {
        const p=req.postDataJSON();cancelCount++;
        assert.equal(p.p_wo,uuid(51));assert.equal(p.p_run,correctiveNewRun);
        assert.equal(p.p_expected_updated_at,'2026-10-11T20:00:01Z');
        assert.equal(p.p_reason,'Schedule changed');
        rows[50].field_status='CANCELLED';
        return reply({work_order_id:uuid(51),run_id:correctiveNewRun,status:'CANCELLED',
          obligation_id:uuid(9989),obligation_status:'OPEN'});
      }
      if (url.pathname.endsWith('/admin_replace_cancelled_followup')) {
        const p=req.postDataJSON();replaceCount++;
        assert.equal(p.p_wo,uuid(51));assert.equal(p.p_cancelled_run,correctiveNewRun);
        assert.equal(p.p_assigned_user,contractor);
        assert.equal(p.p_due_date,'2026-10-25');
        assert.equal(p.p_reason,'Client requested another visit');
        rows[50].field_status='ASSIGNED';rows[50].current_run_id=replacementRun;
        return reply({work_order_id:uuid(51),run_id:replacementRun,
          assignment_instance_id:uuid(9990),run_sequence:3,status:'ASSIGNED',
          superseded_obligation_id:uuid(9989),new_obligation_id:uuid(9995)});
      }
      if (url.pathname.endsWith('/admin_correction_state')) {
        const p=req.postDataJSON();assert.equal(p.p_wo,uuid(51));
        if (rows[50].field_status!=='FIELD_COMPLETE')return reply({message:'Not complete'},409);
        return reply({...correctionBase(),draft:correctionDraft});
      }
      if (url.pathname.endsWith('/admin_save_correction_draft_with_issues')) {
        const p=req.postDataJSON();assert.equal(p.p_wo,uuid(51));
        assert.equal(p.p_expected_run,correctiveOriginalRun);
        assert.equal(p.p_expected_wo_updated_at,'2026-10-11T20:00:00Z');
        assert.equal(p.p_expected_revision,correctionDraft?.revision||null);
        assert.equal(p.p_assigned_user,contractor);
        assert.deepEqual(p.p_reference_photos,[reviewPhoto]);
        assert.equal(p.p_item_mapping.length,1);
        assert.equal(p.p_item_mapping[0].release_item_id,p.p_item_mapping[0].capture_item_id);
        assert.equal(p.p_release_requirements.items.length,1);
        assert.equal(p.p_issues.length,1);
        assert.equal(p.p_issues[0].photo_id,reviewPhoto);
        assert.equal(p.p_issues[0].reason,'Blurry exterior');
        assert.equal(p.p_issues[0].requested_count,1);
        correctionIssues=structuredClone(p.p_issues);
        correctionDraftRev=uuid(9966);
        correctionDraft={id:uuid(9964),revision:correctionDraftRev,status:'DRAFT',
          origin_run_id:p.p_expected_run,expected_wo_updated_at:p.p_expected_wo_updated_at,
          kind:'INTERNAL_CORRECTION',reason:p.p_reason,reference_photos:p.p_reference_photos,
          assigned_user_id:p.p_assigned_user,due_date:p.p_due_date,
          instructions:p.p_instructions,capture_requirements:p.p_capture_requirements,
          item_mapping:p.p_item_mapping,release_requirements:p.p_release_requirements,
          issues:structuredClone(correctionIssues)};
        return reply({draft_id:correctionDraft.id,revision:correctionDraftRev,status:'DRAFT',
          issues:correctionIssues});
      }
      if (url.pathname.endsWith('/admin_save_correction_issues')) {
        const p=req.postDataJSON();assert.equal(p.p_wo,uuid(51));
        assert.equal(p.p_expected_revision,correctionDraftRev);
        assert.equal(p.p_issues.length,1);
        assert.equal(p.p_issues[0].photo_id,reviewPhoto);
        assert.equal(p.p_issues[0].reason,'Blurry exterior');
        assert.equal(p.p_issues[0].requested_count,1);
        correctionIssues=p.p_issues;correctionDraftRev=uuid(9966);
        correctionDraft.revision=correctionDraftRev;
        correctionDraft.issues=structuredClone(correctionIssues);
        return reply({work_order_id:uuid(51),draft_id:correctionDraft.id,
          revision:correctionDraftRev,issues:correctionIssues});
      }
      if (url.pathname.endsWith('/admin_preview_correction_draft')) {
        const p=req.postDataJSON();assert.equal(p.p_wo,uuid(51));
        assert.equal(p.p_revision,correctionDraftRev);
        correctionPreviewCount++;
        const d=correctionDraft;
        return reply({draft_revision:d.revision,preview_sha256:correctionHash,
          summary:{work_order_id:uuid(51),wo_number:'DEMO-0051',company_id:uuid(9981),
            origin_run_id:d.origin_run_id,kind:d.kind,reason:d.reason,due_date:d.due_date,
            assigned_user_id:d.assigned_user_id,instructions:d.instructions,
            capture_requirements:d.capture_requirements,release_requirements:d.release_requirements,
            reference_photos:d.reference_photos,item_mapping:d.item_mapping,
            issues:d.issues||[]}});
      }
      if (url.pathname.endsWith('/admin_dispatch_correction_draft')) {
        const p=req.postDataJSON();assert.equal(p.p_wo,uuid(51));
        assert.equal(p.p_revision,correctionDraftRev);
        assert.equal(p.p_preview_sha256,correctionHash);
        assert.equal(correctionPreviewCount,1);
        correctionDispatchCount++;correctionRequest=p;
        const row=rows[50];row.field_status='ASSIGNED';row.current_run_id=correctiveNewRun;
        row.run={requirement_snapshot:correctionDraft.capture_requirements};
        return reply({work_order_id:row.id,run_id:correctiveNewRun,
          run_sequence:2,assignment_instance_id:uuid(9969),kind:'INTERNAL_CORRECTION',status:'ASSIGNED'});
      }
      if (url.pathname.endsWith('/admin_notification_settings')) {
        return reply({organization_id:organization,push_ready:false,
          organization_timezone:alertOrgTimezone,organization_timezone_revision:
            alertOrgTimezone?uuid(9753):null,devices:[],types:alertTypes.map(type=>({
            type,revision:alertSettings.get(type)?.revision||null,
            dashboard:alertSettings.get(type)?.dashboard??true,
            phone:alertSettings.get(type)?.phone??false,
            computer:alertSettings.get(type)?.computer??false,
            quiet_timezone:alertSettings.get(type)?.quiet_timezone||null,
            quiet_start:alertSettings.get(type)?.quiet_start||null,
            quiet_end:alertSettings.get(type)?.quiet_end||null,
            reminder_minutes:alertSettings.get(type)?.reminder_minutes||1440
          }))});
      }
      if (url.pathname.endsWith('/admin_alert_list')) {
        const p=req.postDataJSON();assert.equal(p.p_limit,25);
        return reply({organization_id:organization,alerts:[{
          id:syntheticAlertId,work_order_id:uuid(51),run_id:alertRun,
          type:'ASSIGNMENT_NEEDS_ACCEPT',current:true,
          first_at:'2026-10-11T10:00:00Z',last_at:'2026-10-11T10:00:00Z',
          version_key:'a'.repeat(64),receipt_revision:alertReceipt?.revision||null,
          acknowledged:alertReceipt?.mode==='ACKNOWLEDGE',
          snoozed_until:alertReceipt?.snoozed_until||null
        }].filter(a=>alertSettings.get(a.type)?.dashboard!==false)});
      }
      if (url.pathname.endsWith('/admin_set_notification_preferences')) {
        const p=req.postDataJSON();assert.ok(alertTypes.includes(p.p_type));
        assert.equal(p.p_phone,false);assert.equal(p.p_computer,false);
        const current=alertSettings.get(p.p_type);
        assert.equal(p.p_expected_revision,current?.revision||null);
        const revision=uuid(9750+alertWrites.length);
        alertSettings.set(p.p_type,{...p,revision,
          dashboard:p.p_dashboard,phone:p.p_phone,computer:p.p_computer,
          reminder_minutes:p.p_reminder_minutes,
          quiet_timezone:p.p_quiet_timezone,quiet_start:p.p_quiet_start,
          quiet_end:p.p_quiet_end});
        alertWrites.push(p);
        return reply({type:p.p_type,revision,dashboard:p.p_dashboard,
          phone:p.p_phone,computer:p.p_computer});
      }
      if (url.pathname.endsWith('/admin_alert_receipt_action')) {
        const p=req.postDataJSON();assert.equal(p.p_issue,syntheticAlertId);
        assert.equal(p.p_expected_revision,alertReceipt?.revision||null);
        alertReceipt={mode:p.p_mode,snoozed_until:p.p_snoozed_until,revision:uuid(9778)};
        return reply({issue_id:syntheticAlertId,mode:p.p_mode,
          revision:alertReceipt.revision,acknowledged:p.p_mode==='ACKNOWLEDGE',
          snoozed_until:p.p_snoozed_until});
      }
      if (url.pathname.endsWith('/admin_configure_alert_timezone')) {
        const p=req.postDataJSON();assert.equal(p.p_timezone,'America/Chicago');
        alertOrgTimezone=p.p_timezone;
        return reply({organization_id:organization,timezone:p.p_timezone,revision:uuid(9753)});
      }
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
      if (url.pathname.endsWith('/admin_release_history')) {
        const p=req.postDataJSON();assert.equal(p.p_wo,uuid(51));assert.equal(p.p_limit,25);
        return reply({work_order_id:uuid(51),bounded_to:25,
          runs:[{run_id:correctiveOriginalRun,run_sequence:1,field_status:'FIELD_COMPLETE',
            registered_photos:1,private_receipts:1,
            started_at:'2026-10-01T12:00:00Z',finished_at:'2026-10-01T12:10:00Z'}],
          corrections:[],packages:[{package_id:uuid(9987),run_id:correctiveOriginalRun,
            status:'DELIVERED',selected_count:1,approved_at:'2026-10-01T13:00:00Z',
            frozen_wo_number:'DEMO-0051',receipt_confirmed_at:'2026-10-01T15:00:00Z',
            verified_drive_folder_id:'SYNTHETIC-VERIFIED-HISTORICAL',
            receipt_sha256:'a'.repeat(64)}],more_runs:false,more_packages:false});
      }
      if(url.pathname.endsWith('/admin_package_photo_page')){
        const p=req.postDataJSON();assert.equal(p.p_wo,uuid(51));
        assert.equal(p.p_limit,25);packagePageCalls++;
        const all=Array.from({length:500},(_,i)=>({
          photo_id:uuid(20000+i),run_id:i<250?correctiveNewRun:correctiveOriginalRun,
          run_sequence:i<250?2:1,release_item_id:null,
          decision:'APPROVED',transfer_version:reviewVersion
        }));
        const candidates=all.filter(x=>p.p_after_sequence===null
          ||x.run_sequence<p.p_after_sequence
          ||x.run_sequence===p.p_after_sequence&&x.photo_id>p.p_after_photo);
        const slice=candidates.slice(0,25);
        return reply({work_order_id:uuid(51),photos:slice,
          next_sequence:candidates.length>25?slice.at(-1).run_sequence:null,
          next_photo:candidates.length>25?slice.at(-1).photo_id:null});
      }
      if (url.pathname.endsWith('/admin_package_state')) {
        const p=req.postDataJSON();
        return reply({work_order_id:p.p_wo,paged_selection:largePackage,available_photos:selectedCompany
          ? [{photo_id:reviewPhoto,transfer_version:reviewVersion,decision:'APPROVED',requirement_label:'Extra'}]:[],
          too_many_photos:false,coverage_message:'Release goals verified',
          destination:selectedCompany?{verified:true,company_name:'DISPOSABLE COMPANY'}:null,
          package:largePackage?null:simulatedPackage});
      }
      if (url.pathname.endsWith('/admin_save_package_draft')) {
        const p=req.postDataJSON();assert.equal(p.p_wo,uuid(51));
        if(largePackage){
          assert.deepEqual(p.p_photo_ids,[uuid(20000),uuid(20025)]);
          persistedPackagePhotoIds=p.p_photo_ids;
        }else assert.deepEqual(p.p_photo_ids,[reviewPhoto]);
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
      if (url.pathname.endsWith('/admin_review_photo_page')) {
        const p=req.postDataJSON(); assert.equal(p.p_wo,uuid(51));
        assert.ok([25,50].includes(p.p_limit));
        if(largeReview){
          const all=Array.from({length:500},(_,i)=>({
            photo_id:uuid(10000+i),transfer_version:reviewVersion,
            run_id:reviewRun,run_sequence:1,requirement_item_id:null,
            requirement_label:'Extra',stage:'NONE',
            captured_at:'2026-10-01T12:00:00Z',
            verified_at:'2026-10-01T12:02:00Z',decision:'PENDING',
            decision_revision:null,reason:null}));
          let list=all.filter(photo=>(!p.p_after_photo||photo.photo_id>p.p_after_photo)
            &&(!p.p_run||p.p_run===reviewRun)
            &&(!p.p_item&&!p.p_extra||p.p_extra)
            &&(!p.p_stage||p.p_stage==='NONE')
            &&(!p.p_decision||p.p_decision==='PENDING'));
          const pageRows=list.slice(0,p.p_limit);
          maxPhotoPage=Math.max(maxPhotoPage,pageRows.length);
          return reply({work_order_id:uuid(51),photos:pageRows,
            next_sequence:list.length>p.p_limit?1:null,
            next_photo:list.length>p.p_limit?pageRows.at(-1).photo_id:null});
        }
        assert.equal(p.p_after_photo,null);assert.equal(p.p_after_sequence,null);
        const visible=(!p.p_decision||p.p_decision===reviewedDecision)
          &&(!p.p_item||p.p_item===null)
          &&(!p.p_run||p.p_run===reviewRun)
          &&(!p.p_stage||p.p_stage==='NONE');
        return reply({work_order_id:p.p_wo,photos:visible?[{
          photo_id:reviewPhoto,transfer_version:reviewVersion,run_id:reviewRun,run_sequence:1,
          requirement_item_id:null,requirement_label:'Extra',stage:'NONE',
          captured_at:'2026-10-01T12:00:00Z',verified_at:'2026-10-01T12:02:00Z',
          decision:reviewedDecision,decision_revision:reviewedRevision,reason:null
        }]:[],next_photo:null,next_sequence:null});
      }
      if (url.pathname.endsWith('/admin_review_photos_bulk')) {
        const p=req.postDataJSON();bulkSaves.push(p);
        assert.equal(p.p_work_order,uuid(51));
        assert.equal(p.p_photos.length,1);
        assert.equal(p.p_photos[0].photo_id,reviewPhoto);
        assert.equal(p.p_photos[0].transfer_version,reviewVersion);
        assert.equal(p.p_photos[0].expected_revision,reviewedRevision);
        if(bulkConflict)return reply({outcome:'CONFLICT',work_order_id:uuid(51),
          applied:0,conflicts:[{photo_id:reviewPhoto,reason:'CONTENT_OR_REVISION_CHANGED'}]});
        reviewedDecision=p.p_decision;reviewedRevision=uuid(9956);
        return reply({outcome:'APPLIED',work_order_id:uuid(51),
          applied:1,photos:[{photo_id:reviewPhoto,decision:reviewedDecision}]});
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
    assert.equal(await page.locator('#owner-office-console').count(),0,
      'Ordinary Admin must not see owner-only office controls.');
    assert.equal(await page.evaluate(()=>window.__permissionRequestCount),0,
      'Opening the dashboard must not prompt for OS notification permission.');
    await page.locator('#notification-center > summary').click();
    await wait(page,()=>document.querySelectorAll('.notification-preference').length===9);
    assert.match(await page.locator('#notification-push-status').innerText(),/not configured/);
    assert.equal(await page.locator('#notification-settings input[type=checkbox]:checked').count(),9);
    assert.match(await page.locator('#notification-list').innerText(),/Awaiting contractor Accept/);
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/admin_set_notification_preferences')
        && response.request().method()==='POST'),
      page.locator('.notification-preference').filter({hasText:'Awaiting contractor Accept'})
        .getByRole('button',{name:'Save Awaiting contractor Accept'}).click()
    ]);
    assert.equal(alertWrites[0].p_dashboard,true);
    assert.equal(alertWrites[0].p_phone,false);
    assert.equal(alertWrites[0].p_computer,false);
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/admin_alert_receipt_action')
        && response.request().method()==='POST'),
      page.locator('#notification-list').getByRole('button',{name:'Snooze 4 hours'}).click()
    ]);
    assert.equal(alertReceipt?.mode,'SNOOZE');
    await wait(page,()=>document.querySelector('#notification-list')?.textContent.includes('Snoozed until'));
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/admin_alert_receipt_action')
        && response.request().method()==='POST'),
      page.locator('#notification-list').getByRole('button',{name:'Acknowledge'}).click()
    ]);
    assert.equal(alertReceipt?.mode,'ACKNOWLEDGE');
    await wait(page,()=>document.querySelector('#notification-list')?.textContent.includes('Acknowledged ·'));
    await page.locator('#notification-center > summary').click();
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
    await page.locator('#job-search').fill('100 Example Street'); await page.locator('#job-filters button[type="submit"]').click();
    await wait(page, () => document.querySelectorAll('.job-table tbody tr').length === 50);
    assert.match(await page.locator('#job-page-info').innerText(), /of 50/);
    let release; delayPage = new Promise(resolve => { release = resolve; });
    await page.evaluate(() => document.getElementById('job-filters').requestSubmit());
    await page.locator('#job-search').fill('no matching address'); await page.locator('#job-filters button[type="submit"]').click();
    await wait(page, () => document.querySelector('#job-page-info').textContent.includes('No jobs'));
    release(); await page.waitForTimeout(100);
    assert.equal(await page.locator('.job-table tbody tr').count(), 0, 'Stale filtered page must not replace newer search');
    await page.locator('#job-search').fill(''); await page.locator('#job-filters button[type="submit"]').click();
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
    // A changed decision requires a fresh on-demand private preview, not
    // stale browser-inspected status inherited from the previous revision.
    await page.locator('.private-review-photo').getByRole('button',{name:'Preview photo'}).click();
    await wait(page,()=>!document.querySelectorAll('.private-review-photo button')[1].disabled);
    // Bulk decisions are limited to actually inspected content versions;
    // user must confirm the frozen explicit selection, not unseen additions.
    await page.locator('.private-review-photo').getByLabel('Select reviewed photo '+reviewPhoto).check();
    await page.locator('#private-review-bulk-reason').fill('Retake blurry photo');
    await Promise.all([
      page.waitForEvent('dialog').then(dialog=>dialog.accept()),
      page.locator('#private-review-bulk-reject').click()
    ]);
    await wait(page,()=>document.querySelector('#private-review-list strong')?.textContent.includes('REJECTED'));
    assert.equal(bulkSaves.length,1);
    assert.equal(bulkSaves[0].p_decision,'REJECTED');
    assert.equal(bulkSaves[0].p_reason,'Retake blurry photo');
    assert.equal(bulkSaves[0].p_photos.length,1);
    assert.equal(requests.some(x=>x.includes('admin_queue_package')),false);
    await page.locator('#private-review-decision').selectOption('APPROVED');
    await wait(page,()=>document.querySelectorAll('.private-review-photo').length===0);
    await page.locator('#private-review-decision').selectOption('');
    await wait(page,()=>document.querySelectorAll('.private-review-photo').length===1);
    await page.locator('.private-review-photo').getByRole('button',{name:'Preview photo'}).click();
    await wait(page,()=>!document.querySelectorAll('.private-review-photo button')[1].disabled);
    await page.locator('.private-review-photo').getByRole('button',{name:'Approve'}).click();
    await wait(page,()=>document.querySelector('#private-review-list strong')?.textContent.includes('APPROVED'));
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
    await page.locator('[data-job-tab="history"]').click();
    await wait(page,()=>document.querySelector('#job-history-status').textContent.includes('read-only'));
    assert.match(await page.locator('#job-history-packages').innerText(),/DELIVERED/);
    assert.match(await page.locator('#job-history-packages').innerText(),/SYNTHETIC-VERIFIED-HISTORICAL/);
    await page.locator('[data-job-tab="delivery"]').click();
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
    // Phase 6B: the repeat action creates ONLY a fresh draft with a new
    // requirement revision, never the old WO number/assignment/due date.
    rows[50].run={requirement_snapshot:{schema:1,revision:uuid(7700),
      total:{enabled:false,minimum:0},items:[{
        id:uuid(7701),label:'Front',enabled:true,minimum:2,
        instruction:'Front view',stage:'BEFORE',framing:'WIDE',order:0
      }]}};
    await page.locator('.job-link').first().click();
    await wait(page, () => document.querySelector('dialog').open);
    await page.locator('#prepare-repeat-work').click();
    await wait(page, () => document.querySelector('#create-wo-details').open);
    assert.equal(await page.locator('#property-address').inputValue(),rows[50].property_address);
    assert.equal(await page.locator('#work-type').inputValue(),rows[50].work_type);
    assert.equal(await page.locator('#instructions').inputValue(),rows[50].instructions);
    assert.equal(await page.locator('#due-date').inputValue(),'');
    assert.equal(await page.locator('#assignee').inputValue(),'');
    assert.equal(await page.locator('#wo-number-mode-auto').isChecked(),true);
    assert.equal(await page.locator('#wo-number').inputValue(),'');
    assert.equal(await page.locator('#create-photo-requirements input[type="number"]').count(),2);
    assert.equal(requests.some(x=>x.includes('/admin_create_work_order')),false);
    // Phase 6B custom choice keeps the address but does not inherit the old
    // work type, instructions, or photo minimums. Replacing a draft is explicit.
    await page.locator('.job-link').first().click();
    await wait(page, () => document.querySelector('dialog').open);
    await Promise.all([
      page.waitForEvent('dialog').then(dialog => dialog.dismiss()),
      page.locator('#prepare-custom-work').click()
    ]);
    assert.equal(await page.locator('#work-type').inputValue(),rows[50].work_type,
      'Cancelled replacement must preserve the existing repeat draft');
    await Promise.all([
      page.waitForEvent('dialog').then(dialog => dialog.accept()),
      page.locator('#prepare-custom-work').click()
    ]);
    await wait(page, () => document.querySelector('#create-status').textContent.includes('New custom work-order draft'));
    assert.equal(await page.locator('#property-address').inputValue(),rows[50].property_address);
    assert.equal(await page.locator('#work-type').inputValue(),'');
    assert.equal(await page.locator('#instructions').inputValue(),'');
    assert.equal(await page.locator('#due-date').inputValue(),'');
    assert.equal(await page.locator('#assignee').inputValue(),'');
    assert.equal(await page.locator('#wo-number').inputValue(),'');
    assert.equal(await page.locator('#wo-number-mode-auto').isChecked(),true);
    assert.equal(await page.locator('#create-photo-requirements .photo-item').count(),0);
    assert.equal(requests.some(x=>x.includes('/admin_create_work_order')),false);
    // Company-scoped templates appear only on a server-authorized company WO.
    templateRows.push(
      {id:uuid(9970),company_id:null,name:'Organization inspection',active:true,
        work_type:'Property inspection',is_default:true,revision:uuid(9971),
        description:'Org metadata',instructions:'General company instructions',requirements:optionalTemplate()},
      {id:uuid(9972),company_id:uuid(9981),name:'Company inspection',active:true,
        work_type:'Property inspection',is_default:true,revision:uuid(9973),
        description:'Company metadata',instructions:'Company-specific instructions',requirements:optionalTemplate()},
      {id:uuid(9974),company_id:uuid(9975),name:'Foreign company inspection',active:true,
        work_type:'Property inspection',is_default:true,revision:uuid(9976),
        description:'Unavailable',instructions:'Never copy',requirements:optionalTemplate()}
    );
    await page.evaluate(async()=>{await Promise.all([createPhotos.reloadTemplates(),editPhotos.reloadTemplates()]);fillWorkTypes();});
    await page.locator('#work-type').fill('Property inspection');
    await page.locator('#work-type').dispatchEvent('change');
    assert.equal(await page.locator('#create-photo-requirements').getByLabel('Photo template').locator('option').count(),2,
      'An unassigned Create draft has only organization-wide templates');
    rows[50].client_company_id=uuid(9981);
    await page.evaluate(async()=>{await refreshWorkOrders();});
    await page.locator('.job-link').first().click();
    await wait(page, () => document.querySelector('dialog').open);
    assert.equal(await page.locator('#edit-photo-requirements').getByLabel('Photo template').locator('option').count(),3,
      'Selected job has one company template, org fallback, and Custom');
    const choices=await page.locator('#edit-photo-requirements').getByLabel('Photo template').locator('option').allTextContents();
    assert.match(choices[1],/Company inspection.*default/);
    assert.ok(choices.every(t=>!t.includes('Foreign company')));
    await page.locator('[data-job-tab="requirements"]').click();
    const templateChoice=page.locator('#edit-photo-requirements').getByLabel('Photo template');
    assert.equal(await templateChoice.isEnabled(),true,'Authorized unstarted work must allow template copy');
    assert.notEqual(await page.locator('#edit-instructions').inputValue(),'Company-specific instructions');
    let confirmationCount=0;
    const acceptInstructionReplacement=dialog=>{
      confirmationCount++;void dialog.accept();
    };
    page.on('dialog',acceptInstructionReplacement);
    try { await templateChoice.selectOption(uuid(9972)); }
    finally { page.off('dialog',acceptInstructionReplacement); }
    assert.equal(confirmationCount,1,'Existing instructions require an explicit confirmation');
    assert.equal(await page.locator('#edit-instructions').inputValue(),'Company-specific instructions');
    const editReq=await page.evaluate(()=>editPhotos.snapshot());
    assert.notEqual(editReq.revision,uuid(9978),'Copy must have a fresh draft revision');
    assert.equal(templateRows[1].requirements.revision,uuid(9978),'Saved template snapshot not modified');
    await page.locator('#edit-photo-requirements').getByText('Save or manage templates').click();
    await page.locator('#edit-photo-requirements').getByLabel('Template name').fill('Company inspection copy');
    await page.locator('#edit-photo-requirements').getByLabel('Template description').fill('Editable description');
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/admin_save_company_photo_template')
        && response.request().method()==='POST'),
      page.locator('#edit-photo-requirements').getByText('Save as new template', {exact:true}).click()
    ]);
    assert.ok(templateSaves.length>0);
    assert.equal(templateSaves.at(-1).p_company_id,uuid(9981));
    assert.equal(templateSaves.at(-1).p_description,'Editable description');
    assert.equal(templateSaves.at(-1).p_expected_revision,null);
    assert.equal(requests.some(x=>x.includes('/admin_create_work_order')),false);
    await page.locator('#cancel-edit').click();
    await page.locator('#job-discard').click();
    // Phase 6C: the existing Photos section, not a parallel dashboard,
    // hosts one saved, revisioned correction request. Preview does not dispatch.
    rows[50].field_status='FIELD_COMPLETE';
    rows[50].client_company_id=uuid(9981);
    rows[50].current_run_id=correctiveOriginalRun;
    rows[50].run={requirement_snapshot:optionalTemplate()};
    await page.locator('.job-link').first().click();
    await wait(page,()=>document.querySelector('dialog').open);
    await page.locator('[data-job-tab="photos"]').click();
    await wait(page,()=>!document.getElementById('correction-details').hidden);
    await page.locator('#correction-details > summary').click();
    await page.locator('.private-review-photo').getByLabel('Photo rejection reason')
      .fill('Blurry exterior');
    await page.locator('.private-review-photo').getByRole('button',{name:'Add correction issue'}).click();
    assert.match(await page.locator('#correction-issue-list').innerText(),/Blurry exterior/);
    await page.locator('#correction-reason').fill('Replace exterior evidence');
    await page.locator('#correction-assignee').selectOption(contractor);
    await page.locator('#correction-due').fill('2026-10-22');
    await page.locator('#correction-instructions').fill('Reinspect the front');
    await wait(page,()=>document.querySelectorAll('.private-review-photo').length===1);
    await page.locator('.private-review-photo').getByLabel('Reference in follow-up').check();
    await page.locator('#correction-photo-requirements').getByText('Add photo item',{exact:true}).click();
    await page.locator('#correction-photo-requirements').getByLabel('Photo item').fill('Corrected front');
    await page.locator('#correction-photo-requirements').getByLabel('Photo item').dispatchEvent('change');
    await page.locator('#correction-item-mapping select').selectOption('NEW');
    assert.equal(await page.locator('#correction-preview').isDisabled(),true);
    await page.locator('#correction-save').click();
    await wait(page,()=>document.getElementById('correction-status').textContent.includes('Draft saved'));
    assert.equal(correctionPreviewCount,0);
    assert.equal(correctionDispatchCount,0);
    await page.locator('#correction-preview').click();
    await wait(page,()=>!document.getElementById('correction-summary').hidden);
    assert.match(await page.locator('#correction-summary').innerText(),/DEMO-0051/);
    assert.match(await page.locator('#correction-summary').innerText(),/New visit photos/);
    assert.match(await page.locator('#correction-summary').innerText(),/Blurry exterior/);
    assert.equal(correctionIssues[0].photo_id,reviewPhoto);
    assert.equal(correctionPreviewCount,1);
    assert.equal(correctionDispatchCount,0);
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/admin_dispatch_correction_draft')
        && response.request().method()==='POST'),
      (async()=>{
        const accepted=page.waitForEvent('dialog').then(dialog=>dialog.accept());
        await page.locator('#correction-dispatch').click();
        await accepted;
      })()
    ]);
    assert.equal(correctionDispatchCount,1);
    assert.equal(rows[50].current_run_id,correctiveNewRun);
    assert.equal(correctionRequest.p_revision,correctionDraftRev);
    assert.equal(rows[50].wo_number,'DEMO-0051');
    assert.equal(requests.some(x=>x.includes('admin_queue_package')),false);
    // Protected management happens separately from correction creation.
    await page.locator('[data-job-tab="photos"]').click();
    await wait(page,()=>!document.getElementById('followup-management').hidden);
    await page.locator('#followup-management > summary').click();
    assert.equal(await page.locator('#followup-replace').isVisible(),false);
    await page.locator('#followup-management-reason').fill('Schedule changed');
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/admin_cancel_untouched_followup')
        && response.request().method()==='POST'),
      (async()=>{const acknowledged=page.waitForEvent('dialog').then(dialog=>dialog.accept());
        await page.locator('#followup-cancel').click();await acknowledged;})()
    ]);
    assert.equal(rows[50].field_status,'CANCELLED');
    assert.equal(cancelCount,1,'Cancelled a never-acknowledged follow-up only once');
    await page.locator('[data-job-tab="photos"]').click();
    await wait(page,()=>!document.getElementById('followup-management').hidden);
    if(!await page.locator('#followup-management').evaluate(el=>el.open))
      await page.locator('#followup-management > summary').click();
    await page.locator('#followup-management-reason').fill('Client requested another visit');
    await page.locator('#followup-replacement-due').fill('2026-10-25');
    await page.locator('#followup-replacement-instructions').fill('Retake the front');
    await page.locator('#followup-replacement-assignee').selectOption(contractor);
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/admin_replace_cancelled_followup')
        && response.request().method()==='POST'),
      (async()=>{const acknowledged=page.waitForEvent('dialog').then(dialog=>dialog.accept());
        await page.locator('#followup-replace').click();await acknowledged;})()
    ]);
    assert.equal(rows[50].current_run_id,replacementRun);
    assert.equal(replaceCount,1);
    assert.equal(rows[50].wo_number,'DEMO-0051','Replacement retains original client number');
    assert.equal(requests.some(x=>x.includes('admin_queue_package')),false);
    // 500 private photos must stay server-paged. Never materialize all 500 in
    // the browser, even with latest-run, item, stage and decision filters.
    largeReview=true;
    await page.locator('[data-job-tab="photos"]').click();
    await wait(page,()=>document.querySelectorAll('.private-review-photo').length===25);
    assert.equal(await page.locator('#private-review-more').isVisible(),true);
    await page.locator('#private-review-more').click();
    await wait(page,()=>document.querySelectorAll('.private-review-photo').length===50);
    assert.equal(maxPhotoPage,25);
    await page.locator('#private-review-stage').selectOption('AFTER');
    await wait(page,()=>document.querySelectorAll('.private-review-photo').length===0);
    await page.locator('#private-review-stage').selectOption('');
    await wait(page,()=>document.querySelectorAll('.private-review-photo').length===25);
    largeReview=false;
    largePackage=true;simulatedPackage=null;
    await page.locator('[data-job-tab="delivery"]').click();
    await wait(page,()=>document.querySelectorAll('#release-photo-list input').length===25);
    assert.equal(await page.locator('#release-photos-more').isVisible(),true);
    await page.locator('#release-photo-list input').first().check();
    await page.locator('#release-photos-more').click();
    await wait(page,()=>document.querySelectorAll('#release-photo-list input').length===50);
    await page.locator('#release-photo-list input').nth(25).check();
    assert.match(await page.locator('#release-photo-count').innerText(),/2 photos selected/);
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/admin_save_package_draft')
        && response.request().method()==='POST'),
      page.locator('#release-save').click()
    ]);
    assert.equal(persistedPackagePhotoIds.length,2);
    assert.equal(packagePageCalls>=2,true);
    assert.equal(requests.some(x=>x.includes('admin_queue_package')),false);
    largePackage=false;
    await page.locator('#cancel-edit').click();
    // Account switch clears searches, selected work, and visible edits; only whitelisted preferences remain.
    await page.locator('#sign-out').click(); admin = uuid(9010); await login();
    assert.equal(await page.locator('#property-address').inputValue(), '', 'Repeat draft address must be cleared between accounts');
    assert.equal(await page.locator('#instructions').inputValue(), '', 'Repeat draft instructions must be cleared between accounts');
    assert.equal(await page.locator('#due-date').inputValue(), '', 'Repeat draft due date must be cleared between accounts');
    assert.equal(await page.locator('#create-photo-requirements .photo-item').count(),0,'Repeat photo requirements must clear between accounts');
    assert.equal(await page.locator('#job-page-size').inputValue(), '25');
    assert.equal(await page.locator('#job-search').inputValue(), ''); assert.equal(await page.locator('#edit-work-order-id').inputValue(), '');
    const preferences = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('fwh.jobView.')));
    assert.ok(preferences.length > 0);
    for (const [, value] of preferences) assert.deepEqual(Object.keys(JSON.parse(value)).sort(), ['size', 'sort', 'status']);
    let releaseDetail; delayDetail = new Promise(resolve => { releaseDetail = resolve; });
    await page.locator('.job-link').first().click(); await page.locator('#sign-out').click(); releaseDetail(); await page.waitForTimeout(100);
    assert.equal(await page.locator('dialog').evaluate(el => el.open), false);
    assert.equal(await page.locator('#edit-work-order-id').inputValue(), '');
    // An authenticated non-owner has no visible owner controls; only the
    // server-recognized synthetic owner can render and use the shared console.
    syntheticOwner=true;
    // The immediately preceding race check already signed this account out.
    await login();
    await page.locator('#owner-office-console').waitFor({state:'attached'});
    await page.locator('#owner-office-console > summary').click();
    await page.locator('#owner-office-reason').fill('Synthetic office access review');
    await page.locator('#owner-admin-limit').fill('5');
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/owner_set_office_allowances')),
      page.locator('#owner-office-limit-save').click()
    ]);
    await wait(page,()=>document.querySelector('#owner-office-status')?.textContent.includes('Saved. Server permissions'));
    assert.equal(await page.locator('#owner-admin-limit').inputValue(),'5');
    assert.equal(ownerWrites.some(x=>x.name==='owner_set_office_allowances'),true);
    await page.locator('#owner-supervisor-list select').selectOption('1');
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/owner_change_supervisor_tier')),
      page.locator('#owner-supervisor-list button').filter({hasText:'Change tier'}).click()
    ]);
    await wait(page,()=>document.querySelector('#owner-supervisor-list')?.textContent.includes('Tier 1'));
    assert.equal(ownerTier,1);
    await page.locator('#owner-supervisor-list button').filter({hasText:'Manage teams'}).click();
    await wait(page,()=>document.querySelector('#owner-supervisor-team-panel')?.textContent.includes('West test team'));
    page.once('dialog', dialog=>dialog.accept());
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/owner_set_supervisor_team_scope')),
      page.locator('#owner-supervisor-team-panel').getByRole('button',{name:'Remove: West test team'}).click()
    ]);
    await wait(page,()=>document.querySelector('#owner-office-status')?.textContent.includes('Saved'));
    assert.deepEqual(ownerScope,[]);
    assert.equal(ownerWrites.every(x=>x.p_reason==='Synthetic office access review'),true);
    // A fresh server-side revision denial cannot become a phantom successful grant.
    await page.locator('#owner-supervisor-list button').filter({hasText:'Manage teams'}).click();
    await wait(page,()=>document.querySelector('#owner-supervisor-team-panel')?.textContent.includes('West test team'));
    ownerRejectNext=true;
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/owner_set_supervisor_team_scope')),
      page.locator('#owner-supervisor-team-panel').getByRole('button',{name:'Add: West test team'}).click()
    ]);
    await wait(page,()=>document.querySelector('#owner-office-status')?.textContent.includes('Work scope changed'));
    assert.deepEqual(ownerScope,[],'Rejected change cannot mutate Supervisor scope');
    // Reviewed disablement must explicitly identify an existing team manager.
    await page.locator('#owner-office-people .row').filter({hasText:/^supervisor@example\.invalid ·/})
      .getByRole('button',{name:'Review disable'}).click();
    await wait(page,()=>document.querySelector('#owner-access-review-panel')?.textContent.includes('West test team'));
    await page.locator('#owner-access-review-panel button').click();
    await wait(page,()=>document.querySelector('#owner-office-status')?.textContent.includes('Choose a responsible manager'));
    assert.equal(ownerAccessWrites.length,0,'No manager choice must block reviewed disable');
    await page.locator('#owner-access-review-panel select').selectOption(admin);
    page.once('dialog', dialog=>dialog.accept());
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/set_reviewed_account_work_access')),
      page.locator('#owner-access-review-panel button').click()
    ]);
    await wait(page,()=>Array.from(document.querySelectorAll('#owner-office-people .row')).some(row=>row.textContent.includes('supervisor@example.invalid') && row.textContent.includes('work disabled')));
    assert.equal(ownerPersonActive,false);
    await page.locator('#owner-office-people .row').filter({hasText:/^supervisor@example\.invalid ·/})
      .getByRole('button',{name:'Review restore'}).click();
    await wait(page,()=>document.querySelector('#owner-access-review-panel')?.textContent.includes('Restore work'));
    page.once('dialog', dialog=>dialog.accept());
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/set_reviewed_account_work_access')),
      page.locator('#owner-access-review-panel button').click()
    ]);
    await wait(page,()=>Array.from(document.querySelectorAll('#owner-office-people .row')).some(row=>row.textContent.includes('supervisor@example.invalid') && row.textContent.includes('work enabled')));
    assert.equal(ownerPersonActive,true);
    assert.equal(ownerAccessWrites.length,2);
    await page.locator('#owner-enrollment > summary').click();
    await page.locator('#owner-enrollment-user').selectOption(uuid(9231));
    await page.locator('#owner-enrollment button[type=submit]').click();
    await wait(page,()=>document.querySelector('#owner-office-status')?.textContent.includes('Choose at least one exact active team'));
    assert.equal(ownerEnrollWrites.length,0,'Incomplete team selection did not create an enrollment');
    await page.locator('#owner-enrollment-teams').getByRole('checkbox',{name:'West test team'}).check();
    page.once('dialog', dialog=>dialog.accept());
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/owner_enroll_supervisor_with_seat')),
      page.locator('#owner-enrollment button[type=submit]').click()
    ]);
    await wait(page,()=>document.querySelector('#owner-office-status')?.textContent.includes('Temporary gateway failure'));
    assert.equal(ownerEnrolled,false,'Gateway failure cannot claim enrollment');
    page.once('dialog', dialog=>dialog.accept());
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/owner_enroll_supervisor_with_seat')),
      page.locator('#owner-enrollment button[type=submit]').click()
    ]);
    await wait(page,()=>document.querySelector('#owner-supervisor-list')?.textContent.includes('new-supervisor@example.invalid'));
    assert.equal(ownerEnrolled,true);
    assert.equal(ownerEnrollWrites.length,2);
    assert.equal(ownerEnrollWrites[0].p_action,ownerEnrollWrites[1].p_action,
      'Retry must carry the same immutable enrollment action UUID');
    page.once('dialog', dialog=>dialog.accept());
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/owner_set_supervisor_grant_state')),
      page.locator('#owner-supervisor-list .row').filter({hasText:/^new-supervisor@example\.invalid/})
        .getByRole('button',{name:'Remove grant'}).click()
    ]);
    await wait(page,()=>document.querySelector('#owner-office-status')?.textContent.includes('Saved.'));
    assert.equal(ownerEnrolledGrantActive,false);
    assert.equal(await page.locator('#owner-office-people .row').filter({hasText:/^new-supervisor@example\.invalid/})
      .getByRole('button',{name:'Review restore'}).isDisabled(),true);
    page.once('dialog', dialog=>dialog.accept());
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/owner_set_supervisor_grant_state')),
      page.locator('#owner-supervisor-list .row').filter({hasText:/^new-supervisor@example\.invalid/})
        .getByRole('button',{name:'Re-enable grant'}).click()
    ]);
    await wait(page,()=>document.querySelector('#owner-office-status')?.textContent.includes('Saved.'));
    assert.equal(ownerEnrolledGrantActive,true);
    assert.equal(ownerGrantWrites.length,2);
    const rosterRow=page.locator('#owner-contractor-roster .row')
      .filter({hasText:'contractor-roster@example.invalid'});
    await rosterRow.locator('select').selectOption(uuid(9213));
    page.once('dialog',dialog=>dialog.accept());
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/manage_idle_contractor_roster')),
      rosterRow.getByRole('button',{name:'Place unassigned'}).click()
    ]);
    await wait(page,()=>document.querySelector('#owner-contractor-roster')
      ?.textContent.includes('West test team'));
    assert.equal(ownerRosterTeam,uuid(9213));
    await rosterRow.locator('select').selectOption(uuid(9216));
    page.once('dialog',dialog=>dialog.accept());
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/manage_idle_contractor_roster')),
      rosterRow.getByRole('button',{name:'Review idle transfer'}).click()
    ]);
    await wait(page,()=>document.querySelector('#owner-office-status')
      ?.textContent.includes('Contractor has open assignments'));
    assert.equal(ownerRosterTeam,uuid(9213),'Busy transfer must not mutate roster');
    page.once('dialog',dialog=>dialog.accept());
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/manage_idle_contractor_roster')),
      rosterRow.getByRole('button',{name:'Review idle transfer'}).click()
    ]);
    await wait(page,()=>document.querySelector('#owner-contractor-roster')
      ?.textContent.includes('East test team'));
    assert.equal(ownerRosterTeam,uuid(9216));
    assert.equal(ownerRosterWrites.length,3);
    assert.equal(ownerRosterWrites[1].p_action,ownerRosterWrites[2].p_action,
      'Ambiguous roster response must keep the action UUID');
    assert.equal(await page.locator('#owner-enrollment-user').locator('option').count(),1,
      'Already enrolled Supervisor cannot be offered for a second enrollment');
    await page.screenshot({path:path.join(output,'phase6f-owner-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await wait(page,()=>document.querySelector('#owner-office-console')?.clientWidth>0);
    assert.equal(await page.evaluate(()=>{
      const panel=document.getElementById('owner-office-console');
      return panel.scrollWidth <= panel.clientWidth+2;
    }),true,'Owner controls must not overflow on a narrow Android viewport');
    await page.screenshot({path:path.join(output,'phase6f-owner-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1280,height:900});
    await page.locator('#sign-out').click();
    assert.equal(await page.locator('#owner-office-console').count(),0,'Owner data must clear on signout');
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(requests.filter(url => url.startsWith('/storage/v1/object/sign/')).length, 3,
      'Three explicit inspections open three short-lived private images; no gallery prefetch');
    assert.equal(requests.some(url => url.includes('work_order_photos')), false, 'List selection does not fetch all photos');
    console.log('PASS: bounded 1,000-job paging, 50 same-address results, UUID navigation, Save/Stay/Discard and requirements edits, failed save/read recovery, stale refresh, account/sign-out isolation, desktop/mobile workspace. No live backend traffic.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

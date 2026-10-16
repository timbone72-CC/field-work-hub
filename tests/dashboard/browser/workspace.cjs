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
let ownerAdminInviteAttempts=[],ownerAdminInviteFailOnce=true;
let syntheticRole='ADMIN', staffingGranted=true, staffInviteFailOnce=true, staffingWorkTier=2;
let recoveryMode=false, recoveryGranted=true, recoveryPhotoRequests=0, recoveryCorruptBytes='NONE';
const recoveryJpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==','base64');
const recoveryJpegSha256=require('node:crypto').createHash('sha256').update(recoveryJpeg).digest('hex');
let staffingPagingRace=false, staffingScopeShift=false, staffingDetailDenied=false;
let staffWorkEdits=[], staffWorkEditFailOnce=true, staffWorkDue='2026-10-20';
let staffingCandidateCalls=0,staffAssignmentWrites=[],staffAssignmentFailOnce=true;
let staffWorkNote='Read-only <script>not executable</script>';
let staffWorkRevision='d'.repeat(32);
let staffingAttempts=[],staffHandoffAttempts=[],staffHandoffFailOnce=true,staffHistoricalHandoff=false;
let staffConsentAvailable=false,staffConsentStatus='NOT_REQUESTED',staffConsentRequests=[];
let staffRosterTeam=null,staffRosterRevision=null,staffRosterFailOnce=true,staffRosterAttempts=[];
let ownerPersonActive=true,ownerAccessRevision=uuid(9223),ownerAccessWrites=[];
let ownerEnrolled=false,ownerEnrollWrites=[],ownerEnrolledGrantActive=true,ownerEnrolledGrantRevision=uuid(9234),ownerGrantWrites=[];
let ownerEnrollFailOnce=true;
let ownerRosterTeam=null,ownerRosterRevision=null,ownerRosterWrites=[],ownerRosterBusyOnce=true,ownerRosterTransportOnce=true;

let reviewedDecision = 'PENDING', reviewedRevision = null;
let supervisorReviewDecision = 'PENDING', supervisorReviewRevision = null;
let supervisorReviewWrites = [], supervisorReviewFailOnce = true;
let bulkSaves = [], bulkConflict = false;
let largeReview=false,maxPhotoPage=0;
const reviewPhoto = uuid(9901), reviewVersion = uuid(9902), reviewRun = uuid(9903);
const reviewPackageId=uuid(9991), approvedHash='a'.repeat(64);
let selectedCompany=null, reviewRequired=true, reviewPolicyRevision=uuid(9980), simulatedPackage=null;
let destinationAttempts=[],destinationFailOnce=true;
let layoutWrites=[],layoutFailOnce=true,layoutListDelayed=false,resolveLayoutList=null,layoutListRequested=false;

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
      if (url.pathname.endsWith('/rest/v1/rpc/manage_idle_contractor_roster') &&
          syntheticRole === 'SUPERVISOR') {
        const p=req.postDataJSON();
        assert.equal(p.p_org,organization);
        assert.equal(p.p_environment,'TEST');
        assert.equal(p.p_user,uuid(9315));
        assert.equal(p.p_team,uuid(9213));
        assert.equal(p.p_expected_revision,staffRosterRevision);
        assert.equal(p.p_reason,'Supervisor reviewed idle placement');
        assert.match(p.p_action,/^[a-f0-9-]{36}$/);
        staffRosterAttempts.push(p);
        if (staffRosterFailOnce) {
          staffRosterFailOnce=false;
          return reply({message:'Temporary roster response uncertain'},503);
        }
        const previous=staffRosterTeam;
        staffRosterTeam=p.p_team;
        staffRosterRevision=uuid(9316);
        return reply({action_id:p.p_action,user_id:p.p_user,
          old_team_id:previous,new_team_id:staffRosterTeam,
          revision:staffRosterRevision,action_kind:previous?'TRANSFER':'PLACE'});
      }
      if (url.pathname.startsWith('/rest/v1/rpc/owner_') || url.pathname.endsWith('/rest/v1/rpc/manage_idle_contractor_roster')) {
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
          if (ownerRosterTeam === uuid(9213) && ownerRosterTransportOnce) {
            ownerRosterTransportOnce=false;
            return reply({message:'Gateway unavailable; reconcile exact roster action'},503);
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
      if (url.pathname.endsWith('/office_supervisor_correct_work_schedule')) {
          const p=req.postDataJSON();
          staffWorkEdits.push(p);
          assert.equal(p.p_org,organization);
          assert.equal(p.p_work_order,uuid(9304));
          assert.equal(p.p_expected_scope_fingerprint,'a'.repeat(32));
          assert.equal(p.p_expected_updated_at,'2026-10-12T12:10:00Z');
          assert.equal(p.p_expected_work_revision,staffWorkRevision);
          if (!staffingGranted) return reply({message:'Access denied'},403);
          if (staffWorkEditFailOnce) {
            staffWorkEditFailOnce=false;
            return reply({message:'Temporary server outcome uncertain'},503);
          }
          staffWorkDue=p.p_due_date;
          staffWorkNote+='\n'+p.p_append_note;
          staffWorkRevision='e'.repeat(32);
          return reply({action_id:p.p_action,work_order_id:p.p_work_order,
            team_id:uuid(9213),due_date:staffWorkDue,instructions:staffWorkNote,
            updated_at:'2026-10-12T12:11:00Z',work_revision:staffWorkRevision,status:'SAVED'});
      }
      if (url.pathname.endsWith('/office_supervisor_assignment_candidates')) {
        const p=req.postDataJSON();
        staffingCandidateCalls++;
        assert.equal(p.p_org,organization);
        assert.equal(p.p_work_order,uuid(9304));
        assert.equal(p.p_limit,25);assert.equal(p.p_after,null);
        assert.equal(p.p_expected_scope_fingerprint,'a'.repeat(32));
        if(!staffingGranted) return reply({message:'Access revoked'},403);
        return reply({organization_id:organization,work_order_id:uuid(9304),
          team_id:uuid(9213),scope_fingerprint:'a'.repeat(32),
          field_status:'ASSIGNED',requires_current_contractor_consent:false,
          candidate_contractors:[
            {user_id:uuid(9315),label:'Eligible Contractor <script>inert</script>'},
            {user_id:uuid(9316),label:'Second eligible contractor'}
          ],next_after:null});
      }
      if (url.pathname.endsWith('/office_supervisor_assign_work')) {
        const p=req.postDataJSON();staffAssignmentWrites.push(p);
        assert.equal(p.p_org,organization);assert.equal(p.p_work_order,uuid(9304));
        assert.equal(p.p_assignee,uuid(9316));assert.equal(p.p_expected_scope_fingerprint,'a'.repeat(32));
        assert.equal(p.p_expected_work_revision,staffWorkRevision);
        if(staffAssignmentFailOnce){staffAssignmentFailOnce=false;return reply({message:'Temporary assignment outcome uncertain'},503);}
        staffWorkRevision='f'.repeat(32);
        return reply({status:'ASSIGNED',action_id:p.p_action,work_order_id:p.p_work_order,
          assigned_user_id:p.p_assignee,pending_assignee_user_id:null,work_revision:staffWorkRevision});
      }
      if (url.pathname.endsWith('/office_supervisor_work_detail')) {
          const p=req.postDataJSON();
          assert.equal(p.p_org,organization);
          assert.equal(p.p_expected_scope_fingerprint,staffingScopeShift?'b'.repeat(32):'a'.repeat(32));
          if (!staffingGranted || staffingDetailDenied) return reply({message:'Supervisor detail denied'},403);
          if (![uuid(9304),uuid(9305)].includes(p.p_work_order)) return reply({message:'Unknown job'},403);
          return reply({organization_id:organization,caller_tier:staffingWorkTier,
            scope_fingerprint:staffingScopeShift?'b'.repeat(32):'a'.repeat(32),
            work_order:{work_order_id:p.p_work_order,team_id:uuid(9213),
              team_name:'West test team',wo_number:'TEST-WO-1',
              property_address:'Example work address',work_type:'Inspection',
              instructions:staffWorkNote,
              due_date:staffWorkDue,field_status:'ASSIGNED',created_at:'2026-10-12T12:00:00Z',
              updated_at:'2026-10-12T12:10:00Z',work_revision:staffWorkRevision,
              assignment:{assignee_id:uuid(9315),assignee_label:'Demo contractor <script>unsafe</script>',
                download_received_at:'2026-10-12T12:04:00Z',human_accepted_at:null,
                pending_assignee_id:null,pending_assignee_label:null,
                reassignment_requested_at:null}}});
        }
        if (url.pathname.endsWith('/office_supervisor_work_page')) {
         const p=req.postDataJSON();
         assert.equal(p.p_org,organization);
         assert.equal(p.p_limit,25);
         if (!staffingGranted) return reply({message:'Supervisor work access denied'},403);
         const sample={work_order_id:uuid(9304),team_id:uuid(9213),team_name:'West test team',
           property_address:'Example work address',wo_number:'TEST-WO-1',field_status:'ASSIGNED',
           due_date:staffWorkDue};
         return reply({organization_id:organization,caller_tier:staffingWorkTier,
           scope_fingerprint:staffingScopeShift?'b'.repeat(32):'a'.repeat(32),
           work_orders:p.p_after?(staffingPagingRace?[{...sample,work_order_id:uuid(9306)}]:[]):staffingWorkTier===3
             ? [sample,{...sample,work_order_id:uuid(9305),wo_number:'TEST-ACTIVE',field_status:'IN_PROGRESS'}]
             : [sample],next_after:staffingPagingRace&&!p.p_after?uuid(9304):null});
       }
       if (url.pathname.endsWith('/preview_work_order_team_handoff')) {
        const p=req.postDataJSON();
        assert.equal(p.p_destination,uuid(9222));
        assert.equal(p.p_environment,'TEST');
        const active=p.p_work_order===uuid(9305);
        const eligible=active?staffConsentStatus==='APPROVED' : p.p_work_order===uuid(9304);
        return reply({organization_id:organization,work_order_id:p.p_work_order,
          old_team_id:uuid(9213),old_team_name:'West test team',
          new_team_id:uuid(9222),new_team_name:'East test team',
          eligible,block_reason:eligible?null:'Protected active work requires consent',
          consent_possible:active&&staffConsentAvailable,
          consent_status:active&&staffConsentAvailable?staffConsentStatus:'NOT_REQUESTED',
          handoff_kind:active?'IN_PROGRESS':staffHistoricalHandoff?'FIELD_COMPLETE':'UNDISPATCHED',
          field_status:active?'IN_PROGRESS':staffHistoricalHandoff?'FIELD_COMPLETE':'ASSIGNED',
          original_run_id:active?uuid(9316):staffHistoricalHandoff?uuid(9317):null,
          original_assignment_id:active?uuid(9318):staffHistoricalHandoff?uuid(9319):null,
          original_assignee_id:active?uuid(9315):staffHistoricalHandoff?uuid(9315):null,
          recovery_recipient_count:active?1:staffHistoricalHandoff?2:0,
          protected_photo_count:active?0:staffHistoricalHandoff?7:0,
          review_fingerprint:'d'.repeat(32)});
      }
      if (url.pathname.endsWith('/request_work_order_team_handoff_consent')) {
        const p=req.postDataJSON();
        assert.equal(p.p_work_order,uuid(9305));
        assert.equal(p.p_destination,uuid(9222));
        assert.equal(p.p_environment,'TEST');
        assert.equal(p.p_expected_fingerprint,'d'.repeat(32));
        assert.equal(p.p_reason,'Reviewed test handoff');
        assert.match(p.p_request,/^[a-f0-9-]{36}$/);
        staffConsentRequests.push(p);
        staffConsentStatus='PENDING';
        return reply({request_id:p.p_request,work_order_id:p.p_work_order,status:'PENDING'});
      }
      if (url.pathname.endsWith('/handoff_work_order_team')) {
        const p=req.postDataJSON();
        assert.ok([uuid(9304),uuid(9305)].includes(p.p_work_order));
        assert.equal(p.p_destination,uuid(9222));
        assert.equal(p.p_expected_fingerprint,'d'.repeat(32));
        assert.equal(p.p_reason,'Reviewed test handoff');
        assert.equal(p.p_environment,'TEST');
        assert.match(p.p_action,/^[a-f0-9-]{36}$/);
        staffHandoffAttempts.push(p);
        if (staffHandoffFailOnce) {
          staffHandoffFailOnce=false;
          return reply({message:'Outcome uncertain; reconcile exact action'},503);
        }
        return reply({status:'HANDED_OFF',action_id:p.p_action,
          work_order_id:p.p_work_order,new_team_id:p.p_destination});
      }
      if (url.pathname.endsWith('/office_contractor_roster_snapshot')) {
        const p=req.postDataJSON();
        assert.equal(p.p_org,organization);
        assert.equal(p.p_environment,'TEST');
        assert.equal(p.p_limit,50);
        if (!staffingGranted) return reply({message:'Tier 2/3 staffing grant unavailable'},403);
        return reply({organization_id:organization,caller_tier:2,
          contractors:[{user_id:uuid(9315),email:'available-contractor@example.invalid',
            team_id:staffRosterTeam,revision:staffRosterRevision,idle:true}],
          next_after:null});
      }
      if (url.pathname.endsWith('/office_staffing_scope_snapshot')) {
        const p=req.postDataJSON();
        assert.equal(p.p_org,organization);
        assert.equal(p.p_environment,'TEST');
        assert.equal(p.p_limit,50);
        if (!staffingGranted) return reply({message:'Tier 2/3 staffing grant unavailable'},403);
        return reply({organization_id:organization,allowance_revision:uuid(9212),
          admin_limit:5,admin_active:2,admin_reserved:1,admin_available:2,
          teams:staffingWorkTier===3
            ? [{team_id:uuid(9213),name:'West test team'},
               {team_id:uuid(9222),name:'East test team'}]
            : [{team_id:uuid(9213),name:'West test team'}],next_after:null});
      }
      if (url.pathname === '/functions/v1/admin-invite-contractor' &&
          syntheticRole === 'SUPERVISOR') {
        const p=req.postDataJSON();
        assert.equal(p.operation,'invite_admin_new_team');
        assert.equal(p.expected_allowance_revision,uuid(9212));
        assert.equal(p.team_name,'North test team');
        assert.equal(p.display_name,'New Staff Admin');
        assert.equal(p.email,'staff-admin@example.invalid');
        assert.equal(p.reason,'Approved new team test');
        assert.match(p.action_id,/^[a-f0-9-]{36}$/);
        staffingAttempts.push(p);
        if (staffInviteFailOnce) {
          staffInviteFailOnce=false;
          return reply({status:'RECONCILE',error:'Auth outcome uncertain'},503);
        }
        return reply({status:'BOUND',action_id:p.action_id,team_id:p.team_id,
          setup_url:'https://auth.example.invalid/scoped-staff-setup'});
      }
      if (url.pathname === '/functions/v1/admin-invite-contractor') {
        const p=req.postDataJSON();
        assert.equal(p.operation,'invite_admin');
        assert.equal(p.team_id,uuid(9213));
        assert.equal(p.expected_allowance_revision,ownerQuotaRevision);
        assert.equal(p.email,'new-admin@example.invalid');
        assert.equal(p.display_name,'New Admin');
        assert.equal(p.reason,'Owner reviewed new office staff');
        assert.match(p.action_id,/^[a-f0-9-]{36}$/);
        ownerAdminInviteAttempts.push(p);
        if (ownerAdminInviteFailOnce) {
          ownerAdminInviteFailOnce=false;
          return reply({status:'RECONCILE',error:'Auth result uncertain; retain the exact action'},503);
        }
        return reply({status:'BOUND',action_id:p.action_id,
          setup_url:'https://auth.example.invalid/one-time-setup'});
      }
      if (url.pathname === '/rest/v1/rpc/photo_recovery_page') {
        if (!recoveryMode || !recoveryGranted) return reply({message:'Recovery unavailable'},403);
        const p=req.postDataJSON(); assert.equal(p.p_limit,25);
        assert.equal(p.p_after_photo,null);
        return reply({photos:[{photo_id:reviewPhoto,transfer_version:reviewVersion,
          run_id:reviewRun,work_order_id:uuid(51),captured_at:'2026-10-01T12:00:00Z',
          verified_at:'2026-10-01T12:02:00Z',prepared_size:recoveryJpeg.length,
          prepared_sha256:recoveryJpegSha256}],next_photo:null});
      }
      if (url.pathname === '/functions/v1/recovery-private-photo') {
        assert.equal(recoveryMode,true); recoveryPhotoRequests++;
        const p=req.postDataJSON();
        assert.deepEqual(p,{photo_id:reviewPhoto,transfer_version:reviewVersion});
        return reply({photo_id:reviewPhoto,transfer_version:reviewVersion,expires_in:120,
          url:`https://vyocaujuwrivoqynvitm.supabase.co/storage/v1/object/sign/fwh-review-private/${organization}/${uuid(51)}/${reviewRun}/${reviewPhoto}.jpg?token=disposable-preview`});
      }
      if (url.pathname === '/auth/v1/token') return reply({ access_token: 'disposable-test-access', refresh_token: 'disposable-test-refresh', expires_in: 3600 });
      if (url.pathname === '/auth/v1/user') return reply({
        id: syntheticRole === 'SUPERVISOR' ? uuid(9301) : admin,
        email: syntheticRole === 'SUPERVISOR' ? 'supervisor@example.invalid' : 'admin@example.invalid',
        app_metadata: { role: syntheticRole, organization_id: organization }
      });
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
        if (!rows[50].client_company_id)
          return reply({message:'Current completed client work required'},409);
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
      if (url.pathname.endsWith('/admin_list_client_folder_destinations')) {
        if(layoutListDelayed){
          layoutListRequested=true;
          await new Promise(resolve => {resolveLayoutList=resolve;});
        }
        return reply({destinations:[{destination_id:uuid(9892),company_id:uuid(9981),
          company_name:'DISPOSABLE VERIFIED CLIENT',layout:'ADDRESS_WORK_ORDER',revision:null}]});
      }
      if (url.pathname.endsWith('/admin_set_client_folder_layout')) {
        const p=req.postDataJSON();layoutWrites.push(p);
        assert.equal(p.p_destination,uuid(9892));
        assert.equal(p.p_expected_revision,null);
        assert.equal(p.p_layout,'STATE_CITY_ADDRESS');
        if(layoutFailOnce){layoutFailOnce=false;return reply({code:'synthetic_lost_result'},503);}
        return reply({destination_id:uuid(9892),company_id:uuid(9981),
          layout:p.p_layout,revision:uuid(9893),replayed:true});
      }
      if (url.pathname.endsWith('/admin_propose_client_delivery_destination')) {
        const p=req.postDataJSON();destinationAttempts.push(p);
        assert.equal(p.p_company,uuid(9981));
        assert.equal(p.p_workspace_email,'operator@disposable.invalid');
        assert.equal(p.p_root_folder_id,'disposable_client_root_12345678');
        assert.ok(/^[a-f0-9-]{36}$/.test(p.p_action));
        if(destinationFailOnce){destinationFailOnce=false;return reply({code:'synthetic_transport_uncertain'},503);}
        return reply({destination_id:uuid(9890),company_id:p.p_company,
          verified:false,active:false,revision:uuid(9891),replayed:true});
      }
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
        const p=req.postDataJSON();
        if (syntheticRole === 'SUPERVISOR') {
          assert.equal(p.p_wo,uuid(9304));assert.equal(p.p_limit,25);
          if (!staffingGranted) return reply({message:'Scoped review revoked'},403);
          return reply({work_order_id:uuid(9304),photos:[{
            photo_id:reviewPhoto,transfer_version:reviewVersion,run_id:reviewRun,
            run_sequence:1,requirement_label:'Roof <script>unsafe</script>',
            stage:'BEFORE',decision:supervisorReviewDecision,
            decision_revision:supervisorReviewRevision
          }],next_photo:null,next_sequence:null});
        }
        assert.equal(p.p_wo,uuid(51));
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
        if (syntheticRole === 'SUPERVISOR') {
          assert.equal(p.p_work_order,uuid(9304));
          assert.equal(p.p_photo,reviewPhoto);
          assert.equal(p.p_transfer_version,reviewVersion);
          assert.equal(p.p_expected_revision,supervisorReviewRevision);
          assert.equal(p.p_decision,'APPROVED');
          assert.equal(p.p_reason,'');
          supervisorReviewWrites.push(p);
          if (!staffingGranted) return reply({message:'Scoped review revoked'},403);
          if (supervisorReviewFailOnce) {
            supervisorReviewFailOnce=false;
            return reply({message:'Uncertain receipt from server'},503);
          }
          supervisorReviewDecision='APPROVED';supervisorReviewRevision=uuid(9261);
          return reply({action_id:p.p_action,photo_id:reviewPhoto,
            work_order_id:uuid(9304),transfer_version:reviewVersion,
            decision:'APPROVED',decision_revision:supervisorReviewRevision});
        }
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
          url: `https://vyocaujuwrivoqynvitm.supabase.co/storage/v1/object/sign/fwh-review-private/${organization}/${syntheticRole==='SUPERVISOR'?uuid(9304):uuid(51)}/${reviewRun}/${reviewPhoto}.jpg?token=disposable-preview` });
      }
      if (url.pathname.startsWith('/storage/v1/object/sign/fwh-review-private/')) {
        assert.equal(url.searchParams.get('token'), 'disposable-preview');
        if (recoveryMode) return route.fulfill({status:200,
          headers:{'Content-Type':'image/jpeg','Access-Control-Allow-Origin':'*'},
          body:recoveryCorruptBytes==='SHORT' ? recoveryJpeg.subarray(0,recoveryJpeg.length-3)
            : recoveryCorruptBytes==='ALTERED'
              ? Buffer.from(recoveryJpeg.map((b,i)=>i===recoveryJpeg.length-10 ? b^1 : b))
              : recoveryJpeg});
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
        if (recoveryMode) return reply({message:'Office work access disabled'},403);
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
    // Wait for the completed settings + issue read, not just the first
    // rendered preference row. CI may still be processing the final read.
    await wait(page,()=>document.querySelector('#notification-status')?.textContent
      .startsWith('Loaded current server facts.'));
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

    await page.locator('#client-folder-settings > summary').click();
    await page.locator('#folder-layout-refresh').click();
    await wait(page,()=>document.querySelector('#folder-layout-destination option:nth-child(2)'));
    await page.locator('#folder-layout-destination').selectOption(uuid(9892));
    await page.locator('#folder-layout-choice').selectOption('STATE_CITY_ADDRESS');
    await Promise.all([
      page.waitForEvent('dialog').then(dialog=>dialog.accept()),
      page.locator('#folder-layout-save').click()
    ]);
    await wait(page,()=>document.querySelector('#folder-layout-status')?.textContent.includes('outcome uncertain'));
    assert.equal(layoutWrites.length,1);
    assert.equal(await page.locator('#folder-layout-choice').isDisabled(),true,
      'Unknown preference write cannot be edited or applied under a new ID.');
    assert.equal(await page.locator('#folder-layout-refresh').isDisabled(),true,
      'A refresh cannot hide unresolved preference revision.');
    // Rotate the bearer string WITHOUT changing signed-in user or session epoch.
    // An ordinary refresh must never strand an in-flight action.
    await page.evaluate(()=>{window.__originalClientBearer=accessToken;
      accessToken='synthetic-same-user-refreshed-bearer';});
    await page.locator('#folder-layout-save').click();
    await wait(page,()=>document.querySelector('#folder-layout-status')?.textContent.includes('preference saved'));
    assert.equal(layoutWrites.length,2);
    assert.equal(layoutWrites[0].p_action,layoutWrites[1].p_action,
      'An ambiguous save must replay the exact server action.');
    assert.equal(await page.locator('#folder-layout-save').isDisabled(),true);
    assert.equal(await page.locator('#folder-layout-choice').inputValue(),'STATE_CITY_ADDRESS');
    await page.locator('#folder-proposal-company').selectOption(uuid(9981));
    await page.locator('#folder-proposal-email').fill('operator@disposable.invalid');
    await page.locator('#folder-proposal-root').fill('invalid url!');
    assert.equal(await page.locator('#folder-proposal-submit').isDisabled(),true,
      'Invalid candidate root cannot be submitted.');
    await page.locator('#folder-proposal-root').fill('disposable_client_root_12345678');
    await page.locator('#folder-proposal-submit').click();
    await wait(page,()=>document.querySelector('#folder-proposal-status')?.textContent.includes('Result uncertain'));
    assert.equal(destinationAttempts.length,1);
    assert.equal(await page.locator('#folder-proposal-root').isDisabled(),true,
      'An uncertain proposal freezes exact folder and account.');
    await page.locator('#folder-proposal-submit').click();
    await wait(page,()=>document.querySelector('#folder-proposal-status')?.textContent.includes('INACTIVE and UNVERIFIED'));
    await page.evaluate(()=>{accessToken=window.__originalClientBearer;
      delete window.__originalClientBearer;});
    assert.equal(destinationAttempts.length,2);
    assert.equal(destinationAttempts[0].p_action,destinationAttempts[1].p_action,
      'Transport uncertainty must reuse the identical proposal UUID.');
    assert.equal(await page.locator('#folder-proposal-submit').isDisabled(),true);
    assert.equal(await page.locator('#release-send').isDisabled(),true,
      'Unverified storage proposal can never turn on Send.');
    assert.equal(requests.some(x=>x.includes('admin_queue_package')),false,
      'Destination proposal must not implicitly queue client delivery.');
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
    // Phase 6C: a missing client company is a server eligibility refusal,
    // not a missing feature. Explain it outside the hidden form before any
    // unsafe Save/Dispatch, then proceed with a verified company fixture.
    rows[50].field_status='FIELD_COMPLETE';
    rows[50].client_company_id=null;
    rows[50].current_run_id=correctiveOriginalRun;
    await page.locator('.job-link').first().click();
    await wait(page,()=>document.querySelector('dialog').open);
    await page.locator('[data-job-tab="photos"]').click();
    await wait(page,()=>document.querySelector('#correction-availability')
      ?.textContent.includes('A client company is required'));
    assert.equal(await page.locator('#correction-details').isVisible(),false);
    assert.equal(await page.locator('#correction-availability').isVisible(),true);
    assert.equal(correctionDispatchCount,0);
    await page.locator('#cancel-edit').click();
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
    // A headless click can resolve before the dialog's close transition.
    // Require the real modal to be closed before a physical header sign-out;
    // a still-open dialog is a test failure, not an excuse to force-click.
    await wait(page,()=>!document.querySelector('#edit-work-order-section').open);
    // Account switch clears searches, selected work, and visible edits; only whitelisted preferences remain.
    // Open one authorized job to initiate the delayed request; account-level
    // controls are inaccessible while this modal is open by design.
    await page.locator('.job-link').first().click();
    await wait(page,()=>document.querySelector('#edit-work-order-section').open);
    await page.locator('[data-job-tab="delivery"]').click();
    layoutListDelayed=true;
    await Promise.all([
      page.waitForRequest(request=>request.url().includes('/admin_list_client_folder_destinations')),
      page.locator('#folder-layout-refresh').click()
    ]);
    for(let tries=0;tries<30&&!resolveLayoutList;tries++)
      await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(typeof resolveLayoutList,'function',
      'An original client-destination list must be in flight before leaving its job.');
    await page.locator('#cancel-edit').click();
    await wait(page,()=>!document.querySelector('#edit-work-order-section').open);
    assert.equal(await page.locator('#folder-layout-destination option').count(),1,
      'Closing a job must clear the prior job destination list.');
    resolveLayoutList();layoutListDelayed=false;layoutListRequested=false;
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#folder-layout-destination option').count(),1,
      'Late previous-job destination data must never reappear.');
    await page.locator('#sign-out').click();
    assert.equal(await page.locator('#folder-layout-destination option').count(),1,
      'Account sign-out cannot preserve another user’s destination choices.');
    assert.equal(await page.locator('#folder-layout-status').innerText(),'');
    admin = uuid(9010); await login();
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
    // A modal workspace intentionally blocks pointer access to the header.
    // Simulate an independent session termination while a detail read is
    // pending; this is a stale-response isolation test, not a clickability test.
    await page.locator('.job-link').first().click();
    await page.evaluate(() => document.querySelector('#sign-out').click());
    releaseDetail(); await page.waitForTimeout(100);
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
    // Fail-closed uncertain response retains exact action UUID on retry.
    await page.locator('#owner-admin-invite-team').selectOption(uuid(9213));
    await page.locator('#owner-admin-invite-name').fill('New Admin');
    await page.locator('#owner-admin-invite-email').fill('new-admin@example.invalid');
    await page.locator('#owner-admin-invite-reason').fill('Owner reviewed new office staff');
    await Promise.all([
      page.waitForResponse(response=>response.url().endsWith('/admin-invite-contractor')
        && response.request().method()==='POST'),
      page.locator('#owner-admin-invite-submit').click()
    ]);
    await wait(page,()=>document.querySelector('#owner-admin-invite-status')?.textContent.includes('Auth result uncertain'));
    assert.equal(await page.locator('#owner-admin-invite-link-result').isVisible(),false);
    await Promise.all([
      page.waitForResponse(response=>response.url().endsWith('/admin-invite-contractor')
        && response.request().method()==='POST'),
      page.locator('#owner-admin-invite-submit').click()
    ]);
    await wait(page,()=>document.querySelector('#owner-admin-invite-link-result')?.classList.contains('hidden')===false);
    assert.equal(await page.locator('#owner-admin-invite-link').inputValue(),
      'https://auth.example.invalid/one-time-setup');
    assert.equal(ownerAdminInviteAttempts.length,2);
    assert.equal(ownerAdminInviteAttempts[0].action_id,ownerAdminInviteAttempts[1].action_id);
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
    await wait(page,()=>Array.from(document.querySelectorAll('#owner-contractor-roster .row span'))
      .some(el=>el.textContent.includes('contractor-roster@example.invalid') && el.textContent.includes('West test team')));
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
    await wait(page,()=>document.querySelector('#owner-office-status')
      ?.textContent.includes('Gateway unavailable'));
    assert.equal(ownerRosterTeam,uuid(9213));
    page.once('dialog',dialog=>dialog.accept());
    await Promise.all([
      page.waitForResponse(response=>response.url().includes('/manage_idle_contractor_roster')),
      rosterRow.getByRole('button',{name:'Review idle transfer'}).click()
    ]);
    await wait(page,()=>Array.from(document.querySelectorAll('#owner-contractor-roster .row span'))
      .some(el=>el.textContent.includes('contractor-roster@example.invalid') && el.textContent.includes('East test team')));
    assert.equal(ownerRosterTeam,uuid(9216));
    assert.equal(ownerRosterWrites.length,4);
    assert.notEqual(ownerRosterWrites[1].p_action,ownerRosterWrites[2].p_action,
      'Confirmed transaction rejection must not be retried as an uncertain action');
    assert.equal(ownerRosterWrites[2].p_action,ownerRosterWrites[3].p_action,
      'Ambiguous transport outcome must retry with the exact action UUID');
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
    // Source-only Supervisor staffing: denied lower-tier RPC fails closed,
    // and the scoped invite reconciles the exact unchanged action once.
    syntheticRole='SUPERVISOR'; staffingGranted=false;
    await page.locator('#email').fill('supervisor@example.invalid');
    await page.locator('#password').fill('disposable');
    await page.locator('#sign-in').click();
    await wait(page,()=>document.querySelector('#login-status')?.textContent
      .includes('Supervisor work access denied'));
    assert.equal(await page.locator('#staffing-card:visible').count(),0);
    assert.equal(await page.locator('#results-card:visible').count(),0);
    staffingGranted=true;
    await page.locator('#password').fill('disposable');
    await page.locator('#sign-in').click();
    await page.locator('#staffing-card:visible').waitFor();
    assert.equal(await page.locator('#results-card:visible').count(),0,
      'Supervisor staffing must not expose Admin job/photo controls.');
    assert.equal(await page.locator('#owner-office-console').count(),0);
    assert.match(await page.locator('#staffing-capacity').innerText(),/2 available of 5/);
    assert.equal(await page.locator('#staffing-team option').count(),2);
    assert.equal(await page.locator('#staffing-roster-person option').count(),2);
     assert.match(await page.locator('#staffing-work-status').innerText(),/Tier 2 · 1 authorized jobs/);
     assert.equal(await page.locator('#staffing-work-rows tr').count(),1);
    await page.locator('#staffing-work-rows .staffing-view-detail').first().click();
    await wait(page,()=>document.querySelector('#staffing-work-detail-status')?.textContent
      .includes('Current team authorization confirmed'));
    assert.match(await page.locator('#staffing-work-detail').innerText(),/Read-only <script>not executable<\/script>/);
    assert.equal(await page.locator('#staffing-work-detail script').count(),0,
      'Work instructions must remain inert text');
    assert.equal(await page.locator('#edit-work-order-section:visible').count(),0,
      'Supervisor selected detail cannot expose Admin editing');
    const assignmentDetail = await page.locator('#staffing-work-detail-fields').innerText();
    assert.match(assignmentDetail,/Demo contractor <script>unsafe<\/script>/);
    assert.match(assignmentDetail,/Phone download received/);
    assert.match(assignmentDetail,/Contractor accepted\s+Not confirmed/);
    assert.equal(await page.locator('#staffing-work-detail script').count(),0,
      'Server-provided assignee labels must remain inert DOM text');
    // Current eligible contractors are a deliberate, exact-WO-only read.
    assert.equal(staffingCandidateCalls,0,'Selecting a job cannot prefetch the roster');
    await page.locator('#supervisor-candidates button').first().click();
    await wait(page,()=>document.querySelector('#supervisor-candidates-status')?.textContent
      .includes('eligible team contractor'));
    assert.equal(staffingCandidateCalls,1);
    assert.match(await page.locator('#supervisor-candidates-list').innerText(),
      /Eligible Contractor <script>inert<\/script>/);
    assert.equal(await page.locator('#supervisor-candidates-list script').count(),0);
    assert.match(await page.locator('#supervisor-candidates').innerText(),/Assignment is rechecked by the server/);
    await page.locator('#supervisor-assignment-person').selectOption(uuid(9316));
    await page.locator('#supervisor-assignment-reason').fill('Route coverage change');
    await page.locator('#supervisor-assignment-form button').click();
    await wait(page,()=>document.querySelector('#supervisor-candidates-status')?.textContent.includes('safe retry'));
    assert.equal(staffAssignmentWrites.length,1);
    await page.locator('#supervisor-assignment-reason').fill('Changed unsafe retry');
    await page.locator('#supervisor-assignment-form button').click();
    assert.equal(staffAssignmentWrites.length,1,'Changed unresolved assignment must not create another write');
    await page.locator('#supervisor-assignment-reason').fill('Route coverage change');
    await page.locator('#supervisor-assignment-form button').click();
    await wait(page,()=>document.querySelector('#supervisor-candidates-status')?.textContent.includes('new assignment'));
    assert.equal(staffAssignmentWrites.length,2);
    assert.equal(staffAssignmentWrites[0].p_action,staffAssignmentWrites[1].p_action,
      'Ambiguous assignment outcome must retry the exact action UUID');
    assert.match(await page.locator('#staffing-work-detail-fields').innerText(),/Second eligible contractor/);
    assert.match(await page.locator('#staffing-work-detail-fields').innerText(),/Contractor accepted\s+Not confirmed/);
    // Supervisor uses the same scoped verified gallery and decision engine as Admin.
    await page.locator('#supervisor-photo-review button').first().click();
    await page.locator('#supervisor-photo-rows .private-review-photo').first().waitFor();
    assert.match(await page.locator('#supervisor-photo-rows').innerText(),/Roof <script>unsafe<\/script>/);
    assert.equal(await page.locator('#supervisor-photo-rows script').count(),0);
    assert.equal(await page.locator('#supervisor-photo-rows button:has-text("Approve")').isDisabled(),true,
      'Uninspected Supervisor photos cannot be approved');
    await page.locator('#supervisor-photo-rows button:has-text("Inspect photo")').click();
    await wait(page,()=>document.querySelector('#supervisor-photo-status')?.textContent
      .includes('Photo inspected'));
    await page.locator('#supervisor-photo-rows button:has-text("Approve")').click();
    await wait(page,()=>document.querySelector('#supervisor-photo-status')?.textContent
      .includes('outcome uncertain'));
    assert.equal(supervisorReviewWrites.length,1);
    await page.locator('#supervisor-photo-rows button:has-text("Approve")').click();
    await wait(page,()=>document.querySelector('#supervisor-photo-rows')?.textContent
      .includes('APPROVED'));
    assert.equal(supervisorReviewWrites.length,2);
    assert.equal(supervisorReviewWrites[0].p_action,supervisorReviewWrites[1].p_action);
    assert.equal(await page.locator('#supervisor-photo-rows button:has-text("Approve")').isDisabled(),true,
      'Confirmed review requires inspecting the currently returned version again');
    // Tier 2 may make an authorized due-date and additive-instruction edit;
    // uncertain network outcomes must reuse the exact action ID and inputs.
    await page.locator('#staffing-work-edit-form:visible').waitFor();
    await page.locator('#staffing-work-edit-due').fill('2026-10-21');
    await page.locator('#staffing-work-edit-note').fill('Supervisor check note');
    await page.locator('#staffing-work-edit-reason').fill('Correction from team review');
    await page.locator('#staffing-work-edit-submit').click();
    await wait(page,()=>document.querySelector('#staffing-work-detail-status')?.textContent
      .includes('Server correction outcome uncertain.'));
    assert.equal(staffWorkEdits.length,1);
    await page.locator('#staffing-work-edit-note').fill('Changed unsafe retry');
    await page.locator('#staffing-work-edit-submit').click();
    assert.equal(staffWorkEdits.length,1,'Changed retry must never mutate current work');
    await page.locator('#staffing-work-edit-note').fill('Supervisor check note');
    await page.locator('#staffing-work-edit-submit').click();
    await wait(page,()=>document.querySelector('#staffing-work-detail-status')?.textContent
      .includes('Server saved the correction'));
    assert.equal(staffWorkEdits.length,2);
    assert.equal(staffWorkEdits[0].p_action,staffWorkEdits[1].p_action);
    assert.equal(await page.locator('#staffing-work-edit-due').inputValue(),'2026-10-21');
    assert.match(await page.locator('#staffing-work-detail-fields').innerText(),/Supervisor check note/);
    assert.equal(await page.locator('#staffing-work-detail script').count(),0);
    await page.locator('#staffing-work-detail-close').click();
    assert.equal(await page.locator('#staffing-work-detail:visible').count(),0);
    await page.locator('#staffing-roster-person').selectOption(uuid(9315));
    await page.locator('#staffing-roster-team').selectOption(uuid(9213));
    await page.locator('#staffing-roster-reason').fill('Supervisor reviewed idle placement');
    await page.locator('#staffing-roster-submit').click();
    await wait(page,()=>document.querySelector('#staffing-roster-status')?.textContent
      .includes('Temporary roster response uncertain'));
    await page.locator('#staffing-roster-reason').fill('Changed request');
    await page.locator('#staffing-roster-submit').click();
    assert.equal(staffRosterAttempts.length,1,
      'Uncertain Contractor action cannot be retried with changed inputs.');
    await page.locator('#staffing-roster-reason').fill('Supervisor reviewed idle placement');
    await page.locator('#staffing-roster-submit').click();
    await wait(page,()=>document.querySelector('#staffing-roster-status')?.textContent
      .includes('Server confirmed the roster change'));
    assert.equal(staffRosterAttempts.length,2);
    assert.equal(staffRosterAttempts[0].p_action,staffRosterAttempts[1].p_action,
      'Uncertain Contractor placement must retry the exact action ID.');
    assert.equal(await page.locator('#staffing-roster-submit').isDisabled(),true,
      'A confirmed Contractor placement must require a fresh roster read.');
    await page.locator('#staffing-refresh').click();
    await wait(page,()=>document.querySelector('#staffing-roster-person option:nth-child(2)')?.disabled);
    assert.equal(await page.locator('#staffing-roster-submit').isDisabled(),true,
      'Tier 2 must not transfer an already placed Contractor.');
    await page.locator('#staffing-team-name').fill('North test team');
    await page.locator('#staffing-name').fill('New Staff Admin');
    await page.locator('#staffing-email').fill('staff-admin@example.invalid');
    await page.locator('#staffing-reason').fill('Approved new team test');
    await page.locator('#staffing-submit').click();
    await wait(page,()=>document.querySelector('#staffing-status')?.textContent
      .includes('Auth outcome uncertain'));
    assert.equal(await page.locator('#staffing-link-result:visible').count(),0,
      'Uncertain Auth outcome cannot expose an unbound setup URL.');
    await page.locator('#staffing-team-name').fill('Changed team');
    await page.locator('#staffing-submit').click();
    assert.equal(staffingAttempts.length,1,
      'Editing an unresolved invitation cannot create another action.');
    await page.locator('#staffing-team-name').fill('North test team');
    await page.locator('#staffing-submit').click();
    await wait(page,()=>document.querySelector('#staffing-link-result:not(.hidden)'));
    assert.equal(staffingAttempts.length,2);
    assert.equal(staffingAttempts[0].action_id,staffingAttempts[1].action_id);
    assert.equal(staffingAttempts[0].team_id,staffingAttempts[1].team_id);
    assert.equal(await page.locator('#staffing-link').inputValue(),
      'https://auth.example.invalid/scoped-staff-setup');
    assert.equal(await page.locator('#staffing-submit').isDisabled(),true,
      'Successful link requires a fresh seat revision before another request.');
    await page.locator('#staffing-sign-out').click();
    assert.equal(await page.locator('#staffing-card:visible').count(),0);
    assert.equal(await page.locator('#staffing-link').inputValue(),'',
      'Supervisor setup link must clear on sign-out.');
    assert.equal(await page.locator('#results-card:visible').count(),0);
    assert.equal(await page.evaluate(()=>sessionStorage.length),0,
      'Sign out must clear the existing single tab session.');

    // Tier 1 sees its own server-scoped job labels without any staffing RPC.
    staffingWorkTier=1;
    await page.locator('#email').fill('supervisor@example.invalid');
    await page.locator('#password').fill('disposable');
    await page.locator('#sign-in').click();
    await page.locator('#staffing-card:visible').waitFor();
    assert.match(await page.locator('#staffing-work-status').innerText(),/Tier 1 · 1 authorized jobs/);
    assert.equal(await page.locator('#staffing-invite-form:visible').count(),0);
    assert.equal(await page.locator('#staffing-roster-area:visible').count(),0);
    assert.equal(await page.locator('#results-card:visible').count(),0);
    assert.equal(await page.locator('#staffing-work-rows tr').count(),1);
    await page.locator('#staffing-work-rows .staffing-view-detail').first().click();
    await wait(page,()=>document.querySelector('#staffing-work-detail-status')?.textContent
      .includes('Current team authorization confirmed'));
    assert.match(await page.locator('#staffing-work-detail').innerText(),/Instructions/);
    await page.locator('#staffing-work-detail-close').click();
    assert.equal(await page.locator('#staffing-work-detail:visible').count(),0);
    // A failed current-scope refresh clears previously presented job labels.
    staffingGranted=false;
    await page.locator('#staffing-refresh').click();
    await wait(page,()=>document.querySelector('#login-status')?.textContent
      .includes('Current Supervisor authorization could not be reverified'));
    assert.equal(await page.locator('#staffing-card:visible').count(),0);
    assert.equal(await page.locator('#staffing-work-rows tr').count(),0);
    // A changed current authorized-team set across a page boundary must
    // discard previously presented rows instead of mixing scopes.
    staffingGranted=true; staffingPagingRace=true; staffingWorkTier=1;
    await page.locator('#email').fill('supervisor@example.invalid');
    await page.locator('#password').fill('disposable');
    await page.locator('#sign-in').click();
    await page.locator('#staffing-work-more:visible').waitFor();
    staffingScopeShift=true;
    await page.locator('#staffing-work-more').click();
    await wait(page,()=>document.querySelector('#login-status')?.textContent
      .includes('Supervisor work scope needs a fresh sign-in'));
    assert.equal(await page.locator('#staffing-card:visible').count(),0);
    assert.equal(await page.locator('#staffing-work-rows tr').count(),0,
      'Changed server scope must discard every prior work row');
    staffingScopeShift=false; staffingPagingRace=false;
    // A denied detail refuses stale cached work, then requires a fresh identity.
    staffingDetailDenied=true;staffingWorkTier=1;
    await page.locator('#email').fill('supervisor@example.invalid');
    await page.locator('#password').fill('disposable');
    await page.locator('#sign-in').click();
    await page.locator('#staffing-card:visible').waitFor();
    await page.locator('#staffing-work-rows .staffing-view-detail').first().click();
    await wait(page,()=>document.querySelector('#login-status')?.textContent
      .includes('Supervisor work scope needs a fresh sign-in'));
    assert.equal(await page.locator('#staffing-card:visible').count(),0);
    assert.equal(await page.locator('#staffing-work-detail:visible').count(),0);
    staffingDetailDenied=false;
    // Tier 3 alone receives the reviewed no-evidence work-order handoff.
    staffingWorkTier=3;staffingGranted=true;
    await page.locator('#email').fill('supervisor@example.invalid');
    await page.locator('#password').fill('disposable');
    await page.locator('#sign-in').click();
    await page.locator('#staffing-handoff-area:visible').waitFor();
    assert.equal(await page.locator('#staffing-work-rows tr').count(),2);
    await page.locator('#staffing-handoff-wo').selectOption(uuid(9305));
    await page.locator('#staffing-handoff-team').selectOption(uuid(9222));
    await page.locator('#staffing-handoff-reason').fill('Reviewed test handoff');
    await page.locator('#staffing-handoff-preview').click();
    await wait(page,()=>document.querySelector('#staffing-handoff-status')?.textContent
      .includes('Protected active work requires consent'));
    assert.equal(await page.locator('#staffing-handoff-review:visible').count(),0);
    assert.equal(staffHandoffAttempts.length,0,'In-progress work must not issue handoff');
    staffHistoricalHandoff=true;
    await page.locator('#staffing-handoff-wo').selectOption(uuid(9304));
    await page.locator('#staffing-handoff-preview').click();
    await page.locator('#staffing-handoff-review:not(.hidden)').waitFor();
    assert.match(await page.locator('#staffing-handoff-review-text').textContent(),/field-complete.*2 former office users retain recovery of 7 existing photos/);
    await page.locator('#staffing-handoff-confirm').click();
    await wait(page,()=>document.querySelector('#staffing-handoff-status')?.textContent
      .includes('Outcome uncertain'));
    assert.equal(staffHandoffAttempts.length,1);
    await page.locator('#staffing-handoff-reason').fill('Changed request');
    assert.equal(await page.locator('#staffing-handoff-review:visible').count(),0);
    await page.locator('#staffing-handoff-reason').fill('Reviewed test handoff');
    await page.locator('#staffing-handoff-review:not(.hidden)').waitFor();
    await page.locator('#staffing-handoff-confirm').click();
    await wait(page,()=>document.querySelector('#staffing-handoff-status')?.textContent
      .includes('Server confirmed audited handoff'));
    assert.equal(staffHandoffAttempts.length,2);
    assert.equal(staffHandoffAttempts[0].p_action,staffHandoffAttempts[1].p_action,
      'Ambiguous handoff must reuse exact action');
    assert.equal(await page.locator('#staffing-handoff-preview').isDisabled(),true);
    await page.locator('#staffing-sign-out').click();

    // A separate Tier-3 request asks the actual Contractor for exact consent;
    // the browser cannot infer approval or automatically move the job.
    staffConsentAvailable=true;
    await page.locator('#email').fill('supervisor@example.invalid');
    await page.locator('#password').fill('disposable');
    await page.locator('#sign-in').click();
    await page.locator('#staffing-handoff-area:visible').waitFor();
    await page.locator('#staffing-handoff-wo').selectOption(uuid(9305));
    await page.locator('#staffing-handoff-team').selectOption(uuid(9222));
    await page.locator('#staffing-handoff-reason').fill('Reviewed test handoff');
    await page.locator('#staffing-handoff-preview').click();
    await page.locator('#staffing-handoff-review:not(.hidden)').waitFor();
    assert.equal(await page.locator('#staffing-handoff-confirm').textContent(),'Request Contractor consent');
    await page.locator('#staffing-handoff-confirm').click();
    await wait(page,()=>document.querySelector('#staffing-handoff-status')?.textContent
      .includes('Consent request recorded'));
    assert.equal(staffConsentRequests.length,1);
    assert.equal(staffHandoffAttempts.length,2,'Consent must not silently move work');
    await page.locator('#staffing-sign-out').click();

    // Simulated explicit original-Contractor approval is a separate fixture
    // fact. The manager must obtain a new review and confirm the same WO.
    staffConsentStatus='APPROVED';
    await page.locator('#email').fill('supervisor@example.invalid');
    await page.locator('#password').fill('disposable');
    await page.locator('#sign-in').click();
    await page.locator('#staffing-handoff-area:visible').waitFor();
    await page.locator('#staffing-handoff-wo').selectOption(uuid(9305));
    await page.locator('#staffing-handoff-team').selectOption(uuid(9222));
    await page.locator('#staffing-handoff-reason').fill('Reviewed test handoff');
    await page.locator('#staffing-handoff-preview').click();
    await page.locator('#staffing-handoff-review:not(.hidden)').waitFor();
    assert.match(await page.locator('#staffing-handoff-review-text').textContent(),
      /in-progress.*Original assignment, run, protected photos and Contractor stay fixed/);
    await page.locator('#staffing-handoff-confirm').click();
    await wait(page,()=>document.querySelector('#staffing-handoff-status')?.textContent
      .includes('Server confirmed audited handoff'));
    assert.equal(staffHandoffAttempts.length,3);
    assert.equal(staffHandoffAttempts[2].p_work_order,uuid(9305));
    await page.locator('#staffing-sign-out').click();
    assert.equal(await page.locator('#staffing-work-rows tr').count(),0);
    assert.equal(await page.locator('#staffing-handoff-area:visible').count(),0);
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(requests.filter(url => url.startsWith('/storage/v1/object/sign/')).length, 4,
      'Four explicit Admin/Supervisor inspections open four short-lived private images; no gallery prefetch');
    assert.equal(requests.some(url => url.includes('work_order_photos')), false, 'List selection does not fetch all photos');
    // A current Auth identity with revoked work must not become a dashboard user.
    // Its exact grant page is read only after denial, and private images are on demand.
    syntheticRole='ADMIN';recoveryMode=true;recoveryPhotoRequests=0;
    await page.locator('#email').fill('admin@example.invalid');
    await page.locator('#password').fill('disposable');
    await page.locator('#sign-in').click();
    await page.locator('#recovery-card:visible').waitFor();
    assert.equal(await page.locator('#results-card:visible').count(),0);
    assert.equal(await page.locator('#staffing-card:visible').count(),0);
    assert.equal(recoveryPhotoRequests,0,'List cannot silently issue private image links');
    await page.locator('#recovery-card button').filter({hasText:reviewPhoto.slice(0,8)}).click();
    await wait(page,()=>!document.querySelector('#recovery-card img').hidden);
    assert.equal(recoveryPhotoRequests,1);
    recoveryCorruptBytes='SHORT';
    await page.locator('#recovery-card button').filter({hasText:'Download selected JPEG'}).click();
    await wait(page,()=>document.querySelector('#recovery-card .status')
      ?.textContent.includes('does not match its verified private receipt'));
    assert.equal(recoveryPhotoRequests,2,'Truncated bytes must not pass as recovery');
    recoveryCorruptBytes='ALTERED';
    await page.locator('#recovery-card button').filter({hasText:'Download selected JPEG'}).click();
    await wait(page,()=>document.querySelector('#recovery-card .status')
      ?.textContent.includes('failed its private checksum verification'));
    assert.equal(recoveryPhotoRequests,3,'Same-size changed bytes must fail private SHA-256');
    recoveryCorruptBytes='NONE';
    await page.locator('#recovery-card button').filter({hasText:'Download selected JPEG'}).click();
    try {
      await wait(page,()=>document.querySelector('#recovery-card .status')
        ?.textContent.includes('offered for download'));
    } catch(error) {
      throw new Error('Valid recovery fixture failed: ' +
        await page.locator('#recovery-card .status').textContent(),{cause:error});
    }
    assert.equal(recoveryPhotoRequests,4,'Valid copy uses a fresh exact authorization');
    await page.locator('#recovery-card button').filter({hasText:'Sign Out'}).click();
    assert.equal(await page.locator('#recovery-card:visible').count(),0);
    assert.equal(await page.locator('#login-card:visible').count(),1);
    // A valid office Auth session alone cannot recover an ungranted photo.
    recoveryGranted=false;
    await page.locator('#email').fill('admin@example.invalid');
    await page.locator('#password').fill('disposable');
    await page.locator('#sign-in').click();
    await wait(page,()=>document.querySelector('#login-status')?.textContent.includes('Office work access disabled'));
    assert.equal(await page.locator('#recovery-card:visible').count(),0);
    assert.equal(await page.locator('#results-card:visible').count(),0);
    assert.equal(recoveryPhotoRequests,4);
    recoveryMode=false;recoveryGranted=true;
    assert.equal(errors.length,0,errors.join('\\n'));
    console.log('PASS: bounded job workspace and exact on-demand signed-in recovery after denied work. No live backend traffic.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

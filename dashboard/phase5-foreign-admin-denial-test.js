/* One-off Phase 5 TEST-only real, separate-organization Admin denial gate.
 * The signed-in original TEST Admin resolves one existing approved photo;
 * a second, separate disposable TEST Admin password grant exists only in memory.
 * No second-org token/credential, protected photo ID, URL or bytes are stored,
 * logged, displayed, sent to chat, or committed as a fixture.
 * Only identity, scoped GET, private signer-denial and temporary sign-out calls.
 */
(function(root){
'use strict';
const HOST='https://vyocaujuwrivoqynvitm.supabase.co';
const KEY='sb_publishable_UPmj_Y10-mLwJo7soekCpg_BYZ08LNZ';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/i;
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
async function call(fetcher,url,opts={}){
 try{return await fetcher(url,{...opts,redirect:'error',credentials:'omit',
   cache:'no-store',signal:AbortSignal.timeout(20000)});}
 catch{fail('TEST_NETWORK_UNAVAILABLE');}
}
async function bounded(res,max,code){
 if(!res.ok){await res.body?.cancel().catch(()=>{});fail(code);}
 try{
   const raw=await res.text();
   if(raw.length>max)fail('TEST_RESPONSE_UNVERIFIED');
   return JSON.parse(raw);
 }catch(e){if(e.code)throw e;fail('TEST_RESPONSE_UNVERIFIED');}
}
function claims(jwt){
 if(typeof jwt!=='string'||jwt.length<40)fail('TEST_SESSION_UNVERIFIED');
 let data;
 try{data=JSON.parse(atob(jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}
 catch{fail('TEST_SESSION_UNVERIFIED');}
 if(!UUID.test(data.sub||'')||!UUID.test(data.session_id||'')
   ||!UUID.test(data.app_metadata?.organization_id||'')
   ||data.role!=='authenticated'||data.app_metadata?.role!=='ADMIN'
   ||data.is_anonymous===true||!Number.isInteger(data.exp)
   ||data.exp<=Math.floor(Date.now()/1000)+60)
   fail('TEST_SESSION_UNVERIFIED');
 return data;
}
async function checkUser(fetcher,jwt,identity){
 const res=await call(fetcher,HOST+'/auth/v1/user',{
   method:'GET',headers:{apikey:KEY,Authorization:'Bearer '+jwt}});
 const user=await bounded(res,12000,'TEST_SESSION_UNVERIFIED');
 if(user.id!==identity.sub||user.is_anonymous===true
   ||user.app_metadata?.role!=='ADMIN'
   ||user.app_metadata?.organization_id!==identity.app_metadata.organization_id)
   fail('TEST_SESSION_UNVERIFIED');
}
async function originalFixture(fetcher,adminToken,progress){
 const original=claims(adminToken);
 await checkUser(fetcher,adminToken,original);
 const headers={apikey:KEY,Authorization:'Bearer '+adminToken};
 progress('Locating the original company approved TEST photo (Admin-only read)…');
 const rows=await bounded(await call(fetcher,HOST+
   '/rest/v1/work_orders?select=id,organization_id,wo_number,property_address'+
   '&wo_number=eq.TEST-0003-DASHBOARD&limit=2',{
   method:'GET',headers}),12000,'ORIGINAL_TEST_FIXTURE_UNVERIFIED');
 if(!Array.isArray(rows)||rows.length!==1||!UUID.test(rows[0].id||'')
   ||rows[0].organization_id!==original.app_metadata.organization_id
   ||rows[0].wo_number!=='TEST-0003-DASHBOARD'
   ||rows[0].property_address!=='TEST ONLY - 300 Test Property Rd')
   fail('ORIGINAL_TEST_FIXTURE_UNVERIFIED');
 const photos=await bounded(await call(fetcher,HOST+
   '/rest/v1/rpc/admin_review_photo_page',{
   method:'POST',headers:{...headers,'Content-Type':'application/json'},
   body:JSON.stringify({p_wo:rows[0].id,p_limit:25,p_after_sequence:null,
     p_after_photo:null,p_run:null,p_item:null,p_extra:false,p_stage:null,
     p_decision:'APPROVED'})
 }),25000,'ORIGINAL_TEST_FIXTURE_UNVERIFIED');
 if(photos.work_order_id!==rows[0].id||!Array.isArray(photos.photos)
   ||photos.photos.length>25)fail('ORIGINAL_TEST_FIXTURE_UNVERIFIED');
 const chosen=photos.photos.find(item=>UUID.test(item.photo_id||'')
   &&UUID.test(item.transfer_version||'')&&UUID.test(item.run_id||'')
   &&SHA.test(item.observed_sha256||'')&&item.decision==='APPROVED');
 if(!chosen)fail('ORIGINAL_TEST_FIXTURE_UNVERIFIED');
 return {original,wo:rows[0].id,photo:chosen.photo_id,
   version:chosen.transfer_version};
}
async function verifyForeignAdminDenied({fetcher,adminToken,email,password,progress=()=>{}}){
 if(typeof fetcher!=='function'||typeof email!=='string'
   ||typeof password!=='string'||password.length<1||email.length<3
   ||email.length>254||!email.includes('@'))fail('TEST_CREDENTIALS_REQUIRED');
 const fixture=await originalFixture(fetcher,adminToken,progress);
 let foreignJwt=null,failed=null,passed=false;
 try{
   progress('Signing in a fresh, separate-company TEST Admin session…');
   const auth=await call(fetcher,HOST+'/auth/v1/token?grant_type=password',{
     method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},
     body:JSON.stringify({email:email.trim(),password})});
   const session=await bounded(auth,15000,'SECOND_ADMIN_SIGN_IN_FAILED');
   foreignJwt=session.access_token;
   const foreign=claims(foreignJwt);
   if(foreign.sub===fixture.original.sub
     ||foreign.app_metadata.organization_id===fixture.original.app_metadata.organization_id)
     fail('NOT_SEPARATE_TEST_COMPANY_ADMIN');
   await checkUser(fetcher,foreignJwt,foreign);
   const headers={apikey:KEY,Authorization:'Bearer '+foreignJwt};
   progress('Checking the other company cannot list the original TEST work order…');
   const exact=await bounded(await call(fetcher,HOST+
     '/rest/v1/work_orders?select=id,organization_id,wo_number'+
     '&id=eq.'+fixture.wo+'&limit=2',{
     method:'GET',headers}),12000,'FOREIGN_WORK_ORDER_CHECK_UNVERIFIED');
   if(!Array.isArray(exact)||exact.length!==0)
     fail('FOREIGN_WORK_ORDER_EXPOSED');
   const list=await bounded(await call(fetcher,HOST+
     '/rest/v1/work_orders?select=id,organization_id&limit=25',{
     method:'GET',headers}),12000,'FOREIGN_WORK_LIST_CHECK_UNVERIFIED');
   if(!Array.isArray(list)||list.length>25
     ||list.some(item=>!UUID.test(item.id||'')
       ||item.organization_id!==foreign.app_metadata.organization_id))
     fail('FOREIGN_WORK_LIST_EXPOSED');
   progress('Asking the real private-photo signer to deny the foreign Admin…');
   const response=await call(fetcher,HOST+'/functions/v1/admin-private-photo',{
     method:'POST',headers:{...headers,'Content-Type':'application/json'},
     body:JSON.stringify({photo_id:fixture.photo,transfer_version:fixture.version})});
   if(response.status!==403){
     await response.body?.cancel().catch(()=>{});
     if(response.status>=200&&response.status<300)
       fail('FOREIGN_SIGNED_URL_EXPOSED');
     fail('FOREIGN_SIGNER_DENIAL_UNVERIFIED');
   }
   let denied;
   try{
     const raw=await response.text();
     if(raw.length>1000)fail('FOREIGN_SIGNER_DENIAL_UNVERIFIED');
     denied=JSON.parse(raw);
   }catch(e){if(e.code)throw e;fail('FOREIGN_SIGNER_DENIAL_UNVERIFIED');}
   if(denied.error!=='PHOTO_ACCESS_DENIED'||Object.keys(denied).length!==1)
     fail('FOREIGN_SIGNER_DENIAL_UNVERIFIED');
   passed=true;
 }catch(e){failed=e;}
 finally{
   if(foreignJwt){
     progress('Revoking the temporary other-company TEST login…');
     try{
       const logout=await call(fetcher,HOST+'/auth/v1/logout?scope=local',{
         method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+foreignJwt}});
       if(![200,204].includes(logout.status)){
         await logout.body?.cancel().catch(()=>{});
         if(!failed)failed=Object.assign(new Error('SECOND_ADMIN_SIGNOUT_UNVERIFIED'),
           {code:'SECOND_ADMIN_SIGNOUT_UNVERIFIED'});
       }else await logout.body?.cancel().catch(()=>{});
     }catch{
       if(!failed)failed=Object.assign(new Error('SECOND_ADMIN_SIGNOUT_UNVERIFIED'),
         {code:'SECOND_ADMIN_SIGNOUT_UNVERIFIED'});
     }
   }
   foreignJwt=null;
 }
 if(failed)throw failed;
 if(!passed)fail('FOREIGN_SIGNER_DENIAL_UNVERIFIED');
 return Object.freeze({verified:true,foreign_company:'SEPARATE_ADMIN',
   exact_work_order:'HIDDEN',scoped_list:'ISOLATED',
   signer:'PHOTO_ACCESS_DENIED',temporary_session:'SIGNED_OUT_LOCAL',
   photo_bytes_read:false,delivery:'INACTIVE'});
}
if(typeof module!=='undefined'&&module.exports)
 module.exports={verifyForeignAdminDenied,originalFixture};
if(root?.document&&root?.location){
 const mount=()=>{
   if(root.location.pathname!=='/field-work-hub/phase56-review/'
     ||new URLSearchParams(root.location.search).get('phase5PrivatePhotoTest')!=='1')
     return;
   const parent=root.document.querySelector('main');
   if(!parent)return;
   const panel=root.document.createElement('section');
   panel.id='phase5-foreign-admin-denial-test';
   panel.style.cssText='margin:12px auto;padding:16px;max-width:700px;'+
     'border:2px solid #487caa;border-radius:10px;background:#f2f7fc;color:#173553;';
   const heading=root.document.createElement('h2');
   heading.textContent='Security TEST · Separate-company Admin denial';
   const desc=root.document.createElement('p');
   desc.textContent='Use only the independently created disposable other-company TEST Admin. '+
     'Keep this page signed in as the original TEST Admin. '+
     'The checker opens a separate temporary login, checks exact work-order/list '+
     'isolation and private-photo signer denial, then signs out that temporary login. '+
     'No photo bytes are requested; no jobs, permissions or delivery are changed. '+
     'Enter credentials only on the verified FWH TEST preview, never in chat.';
   const form=root.document.createElement('form');
   form.autocomplete='off';
   const emailLabel=root.document.createElement('label');
   emailLabel.textContent='Separate-company TEST Admin email';
   const emailField=root.document.createElement('input');
   emailField.type='email';emailField.required=true;emailField.maxLength=254;
   emailField.autocomplete='off';emailField.style.cssText='display:block;width:100%;margin:6px 0 12px;';
   const passwordLabel=root.document.createElement('label');
   passwordLabel.textContent='Separate TEST Admin password (not your original Admin password)';
   const passwordField=root.document.createElement('input');
   passwordField.type='password';passwordField.required=true;
   passwordField.autocomplete='new-password';
   passwordField.style.cssText='display:block;width:100%;margin:6px 0 12px;';
   const button=root.document.createElement('button');
   button.type='submit';button.className='secondary';
   button.textContent='Verify separate company is denied';
   const output=root.document.createElement('p');
   output.setAttribute('role','status');output.setAttribute('aria-live','polite');
   output.textContent='Not started. No permission or photo change.';
   emailLabel.append(emailField);passwordLabel.append(passwordField);
   form.append(emailLabel,passwordLabel,button);
   panel.append(heading,desc,form,output);parent.prepend(panel);
   form.addEventListener('submit',async event=>{
     event.preventDefault();if(button.disabled)return;
     button.disabled=true;
     const email=emailField.value.trim(),password=passwordField.value;
     emailField.value='';passwordField.value='';
     output.textContent='Checking existing approved TEST fixture…';
     try{
       const adminToken=typeof accessToken!=='undefined'?accessToken:null;
       const result=await verifyForeignAdminDenied({
         fetcher:root.fetch.bind(root),adminToken,email,password,
         progress:message=>{output.textContent=message;}
       });
       output.textContent='PASS: Separate-company Admin identity verified; '+
         'original TEST work order hidden from exact and scoped list reads; '+
         'private-photo signer returned PHOTO_ACCESS_DENIED; temporary TEST login signed out locally (previously issued JWT expires separately). '+
         'No photo bytes or delivery changed.';
     }catch(error){
       const allowed=new Set(['TEST_CREDENTIALS_REQUIRED','TEST_SESSION_UNVERIFIED',
         'TEST_NETWORK_UNAVAILABLE','TEST_RESPONSE_UNVERIFIED',
         'ORIGINAL_TEST_FIXTURE_UNVERIFIED','SECOND_ADMIN_SIGN_IN_FAILED',
         'NOT_SEPARATE_TEST_COMPANY_ADMIN','FOREIGN_WORK_ORDER_CHECK_UNVERIFIED',
         'FOREIGN_WORK_ORDER_EXPOSED','FOREIGN_WORK_LIST_CHECK_UNVERIFIED',
         'FOREIGN_WORK_LIST_EXPOSED','FOREIGN_SIGNER_DENIAL_UNVERIFIED',
         'FOREIGN_SIGNED_URL_EXPOSED','SECOND_ADMIN_SIGNOUT_UNVERIFIED']);
       output.textContent='BLOCKED: '+(allowed.has(error.code)?error.code:
         'FOREIGN_COMPANY_TEST_UNVERIFIED')+'. No photo or delivery change.';
     }finally{button.disabled=false;}
   });
 };
 if(root.document.readyState==='loading')
   root.document.addEventListener('DOMContentLoaded',mount);
 else mount();
}
})(typeof window!=='undefined'?window:null);

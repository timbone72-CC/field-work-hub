/* Phase 5 TEST-only deny-only real Contractor session gate.
 * Uses the existing Admin tab solely to identify one received TEST fixture.
 * A separate temporary password-grant Contractor session is held in memory,
 * never persisted to dashboard session storage, never copied to chat or URLs.
 * Only Supabase Auth sign-in/sign-out and existing read-only Admin + Edge calls.
 * Does not fetch signed photo bytes, upload, Send, alter grants, or delete.
 */
(function(root){
'use strict';
const HOST='https://vyocaujuwrivoqynvitm.supabase.co';
const KEY='sb_publishable_UPmj_Y10-mLwJo7soekCpg_BYZ08LNZ';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
async function request(fetcher,url,options={}){
 try{return await fetcher(url,{...options,redirect:'error',credentials:'omit',
   cache:'no-store',signal:AbortSignal.timeout(20000)});}
 catch{fail('TEST_NETWORK_UNAVAILABLE');}
}
async function bounded(res,max,errorCode){
 if(!res.ok)fail(errorCode);
 try{
   const raw=await res.text();
   if(raw.length>max)fail('TEST_RESPONSE_UNVERIFIED');
   return JSON.parse(raw);
 }catch(e){if(e.code)throw e;fail('TEST_RESPONSE_UNVERIFIED');}
}
function claims(jwt,role){
 if(typeof jwt!=='string'||jwt.length<40)fail('TEST_SESSION_UNVERIFIED');
 let data;
 try{data=JSON.parse(atob(jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}
 catch{fail('TEST_SESSION_UNVERIFIED');}
 if(!UUID.test(data.sub||'')||!UUID.test(data.session_id||'')
   ||!UUID.test(data.app_metadata?.organization_id||'')
   ||data.role!=='authenticated'||data.app_metadata?.role!==role
   ||data.is_anonymous===true||!Number.isInteger(data.exp)
   ||data.exp<=Math.floor(Date.now()/1000)+60)
   fail('TEST_SESSION_UNVERIFIED');
 return data;
}
async function validateUser(fetcher,jwt,expected){
 const res=await request(fetcher,HOST+'/auth/v1/user',{
   method:'GET',headers:{apikey:KEY,Authorization:'Bearer '+jwt}});
 const user=await bounded(res,12000,'TEST_SESSION_UNVERIFIED');
 if(user.id!==expected.sub||user.is_anonymous===true
   ||user.app_metadata?.role!==expected.app_metadata.role
   ||user.app_metadata?.organization_id!==expected.app_metadata.organization_id)
   fail('TEST_SESSION_UNVERIFIED');
 return user;
}
async function selectReceivedTestPhoto(fetcher,adminJwt,progress){
 const admin=claims(adminJwt,'ADMIN');
 await validateUser(fetcher,adminJwt,admin);
 progress('Finding the original approved TEST photo with the Admin permission…');
 const headers={apikey:KEY,Authorization:'Bearer '+adminJwt};
 const work=await bounded(await request(fetcher,HOST+
   '/rest/v1/work_orders?select=id,organization_id,wo_number,property_address'+
   '&wo_number=eq.TEST-0003-DASHBOARD&limit=2',{
   method:'GET',headers}),12000,'TEST_FIXTURE_NOT_AUTHORIZED');
 if(!Array.isArray(work)||work.length!==1||!UUID.test(work[0].id||'')
   ||work[0].organization_id!==admin.app_metadata.organization_id
   ||work[0].wo_number!=='TEST-0003-DASHBOARD'
   ||work[0].property_address!=='TEST ONLY - 300 Test Property Rd')
   fail('TEST_FIXTURE_NOT_AUTHORIZED');
 const page=await bounded(await request(fetcher,HOST+
   '/rest/v1/rpc/admin_review_photo_page',{
   method:'POST',headers:{...headers,'Content-Type':'application/json'},
   body:JSON.stringify({p_wo:work[0].id,p_limit:25,
     p_after_sequence:null,p_after_photo:null,p_run:null,p_item:null,
     p_extra:false,p_stage:null,p_decision:'APPROVED'})
 }),25000,'TEST_FIXTURE_NOT_AUTHORIZED');
 if(page.work_order_id!==work[0].id||!Array.isArray(page.photos)
   ||page.photos.length>25)fail('TEST_FIXTURE_NOT_AUTHORIZED');
 const selected=page.photos.find(photo=>UUID.test(photo.photo_id||'')
   &&UUID.test(photo.transfer_version||'')&&UUID.test(photo.run_id||'')
   &&SHA.test(photo.observed_sha256||'')&&photo.decision==='APPROVED');
 if(!selected)fail('TEST_FIXTURE_NOT_AUTHORIZED');
 return {admin,photo_id:selected.photo_id,transfer_version:selected.transfer_version};
}
async function verifyContractorSignerDenied({fetcher,adminToken,email,password,progress=()=>{}}){
 if(typeof fetcher!=='function'||typeof email!=='string'
   ||typeof password!=='string'||password.length<1
   ||email.length<3||email.length>254||!email.includes('@'))
   fail('TEST_CREDENTIALS_REQUIRED');
 const fixture=await selectReceivedTestPhoto(fetcher,adminToken,progress);
 let temporaryJwt=null,failed=null,verified=false;
 try{
   progress('Signing in only the temporary Contractor TEST session…');
   const auth=await request(fetcher,HOST+'/auth/v1/token?grant_type=password',{
     method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},
     body:JSON.stringify({email:email.trim(),password})});
   if(!auth.ok){await auth.body?.cancel().catch(()=>{});fail('CONTRACTOR_SIGN_IN_FAILED');}
   const session=await bounded(auth,15000,'CONTRACTOR_SIGN_IN_FAILED');
   // Save the bearer before role validation so the just-created session can
   // still be revoked if the operator selected the wrong TEST account.
   temporaryJwt=session.access_token;
   const contractor=claims(temporaryJwt,'CONTRACTOR');
   if(contractor.sub===fixture.admin.sub
     ||contractor.app_metadata.organization_id!==fixture.admin.app_metadata.organization_id)
     fail('NOT_AN_EXISTING_TEST_CONTRACTOR');
   await validateUser(fetcher,temporaryJwt,contractor);
   progress('Asking the actual server signer to refuse this Contractor…');
   const attempt=await request(fetcher,HOST+'/functions/v1/admin-private-photo',{
     method:'POST',
     headers:{apikey:KEY,Authorization:'Bearer '+temporaryJwt,
       'Content-Type':'application/json'},
     body:JSON.stringify({photo_id:fixture.photo_id,
       transfer_version:fixture.transfer_version})});
   if(attempt.status!==403){
     await attempt.body?.cancel().catch(()=>{});
     if(attempt.status>=200&&attempt.status<300)
       fail('CONTRACTOR_SIGNED_URL_EXPOSED');
     fail('CONTRACTOR_DENIAL_UNVERIFIED');
   }
   let denial;
   try{
     const raw=await attempt.text();
     if(raw.length>1000)fail('CONTRACTOR_DENIAL_UNVERIFIED');
     denial=JSON.parse(raw);
   }catch(e){if(e.code)throw e;fail('CONTRACTOR_DENIAL_UNVERIFIED');}
   if(denial.error!=='PHOTO_ACCESS_DENIED'||Object.keys(denial).length!==1)
     fail('CONTRACTOR_DENIAL_UNVERIFIED');
   verified=true;
 }catch(e){failed=e;}
 finally{
   if(temporaryJwt){
     progress('Revoking only the temporary Contractor TEST login…');
     try{
       const logout=await request(fetcher,HOST+'/auth/v1/logout?scope=local',{
         method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+temporaryJwt}});
       if(![200,204].includes(logout.status)){
         await logout.body?.cancel().catch(()=>{});
         if(!failed)failed=Object.assign(new Error('CONTRACTOR_TEST_SIGNOUT_UNVERIFIED'),
           {code:'CONTRACTOR_TEST_SIGNOUT_UNVERIFIED'});
       }else await logout.body?.cancel().catch(()=>{});
     }catch{
       if(!failed)failed=Object.assign(new Error('CONTRACTOR_TEST_SIGNOUT_UNVERIFIED'),
         {code:'CONTRACTOR_TEST_SIGNOUT_UNVERIFIED'});
     }
   }
   temporaryJwt=null;
 }
 if(failed)throw failed;
 if(!verified)fail('CONTRACTOR_DENIAL_UNVERIFIED');
 return Object.freeze({verified:true,actor:'EXISTING_CONTRACTOR',
   signer:'PHOTO_ACCESS_DENIED',temporary_session:'REVOKED',
   foreign_organization:'NOT_TESTED',photo_bytes_read:false,delivery:'INACTIVE'});
}
if(typeof module!=='undefined'&&module.exports)
 module.exports={verifyContractorSignerDenied,selectReceivedTestPhoto};

if(root?.document&&root?.location){
 const mount=()=>{
   if(root.location.pathname!=='/field-work-hub/phase56-review/'
     ||new URLSearchParams(root.location.search).get('phase5PrivatePhotoTest')!=='1')
     return;
   const parent=root.document.querySelector('main');
   if(!parent)return;
   const panel=root.document.createElement('section');
   panel.id='phase5-contractor-denial-test';
   panel.style.cssText='margin:12px auto;padding:16px;max-width:700px;'+
     'border:2px solid #487caa;border-radius:10px;background:#f2f7fc;color:#173553;';
   const heading=root.document.createElement('h2');
   heading.textContent='TEST-only Contractor access denial';
   const desc=root.document.createElement('p');
   desc.textContent='Use one existing TEST Contractor login. The Admin login stays unchanged. '+
     'This checker signs in separately, asks the real private-photo service to deny access, '+
     'and signs out that temporary Contractor session. No photo is downloaded or sent. '+
     'Enter credentials only on this verified Field Work Hub TEST website, never in chat.';
   const form=root.document.createElement('form');
   form.autocomplete='off';
   const emailLabel=root.document.createElement('label');
   emailLabel.textContent='Existing TEST Contractor email';
   const emailField=root.document.createElement('input');
   emailField.type='email';emailField.required=true;emailField.autocomplete='off';
   emailField.maxLength=254;emailField.style.cssText='display:block;width:100%;margin:6px 0 12px;';
   const passwordLabel=root.document.createElement('label');
   passwordLabel.textContent='Contractor password (not your Admin password)';
   const passwordField=root.document.createElement('input');
   passwordField.type='password';passwordField.required=true;
   passwordField.autocomplete='new-password';
   passwordField.style.cssText='display:block;width:100%;margin:6px 0 12px;';
   const button=root.document.createElement('button');
   button.type='submit';button.className='secondary';
   button.textContent='Verify Contractor is denied';
   const output=root.document.createElement('p');
   output.setAttribute('role','status');output.setAttribute('aria-live','polite');
   output.textContent='Not started. Previously verified JPEG integrity is preserved.';
   emailLabel.append(emailField);passwordLabel.append(passwordField);
   form.append(emailLabel,passwordLabel,button);
   panel.append(heading,desc,form,output);parent.prepend(panel);
   form.addEventListener('submit',async e=>{
     e.preventDefault();if(button.disabled)return;
     button.disabled=true;
     const email=emailField.value.trim(),password=passwordField.value;
     passwordField.value='';emailField.value='';
     output.textContent='Checking existing TEST fixture…';
     try{
       const adminToken=typeof accessToken!=='undefined'?accessToken:null;
       const result=await verifyContractorSignerDenied({
         fetcher:root.fetch.bind(root),adminToken,email,password,
         progress:message=>{output.textContent=message;}
       });
       output.textContent='PASS: Existing TEST Contractor authentication verified; '+
         'the real private-photo signer returned PHOTO_ACCESS_DENIED. '+
         'Temporary Contractor session revoked. Admin session unchanged. '+
         'Other-organization gate is NOT TESTED. No photo bytes or Send changed.';
     }catch(err){
       const allow=new Set(['TEST_CREDENTIALS_REQUIRED','TEST_SESSION_UNVERIFIED',
         'TEST_FIXTURE_NOT_AUTHORIZED','TEST_NETWORK_UNAVAILABLE',
         'TEST_RESPONSE_UNVERIFIED','CONTRACTOR_SIGN_IN_FAILED',
         'NOT_AN_EXISTING_TEST_CONTRACTOR','CONTRACTOR_SIGNED_URL_EXPOSED',
         'CONTRACTOR_DENIAL_UNVERIFIED','CONTRACTOR_TEST_SIGNOUT_UNVERIFIED']);
       output.textContent='BLOCKED: '+(allow.has(err.code)?err.code:
         'CONTRACTOR_TEST_UNVERIFIED')+'. No photo or delivery change.';
     }finally{button.disabled=false;}
   });
 };
 if(root.document.readyState==='loading')
   root.document.addEventListener('DOMContentLoaded',mount);
 else mount();
}
})(typeof window!=='undefined'?window:null);

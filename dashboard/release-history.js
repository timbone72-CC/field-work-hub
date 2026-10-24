/* Phase 6D: scoped read-only audit of historic runs, obligations and frozen
 * client receipts. Never recalculate an earlier confirmed provider package. */
const ReleaseHistory=(()=>{
  let selected='',generation=0;
  const el=id=>document.getElementById(id);
  function reset(){
    generation++;selected='';
    for(const id of ['job-history-status','job-history-runs',
      'job-history-corrections','job-history-packages'])el(id).replaceChildren();
  }
  function section(id,heading,rows,body){
    const host=el(id);host.replaceChildren();
    const title=document.createElement('h3');title.textContent=heading;host.append(title);
    if(!rows.length){const empty=document.createElement('p');
      empty.textContent='No verified records in this bounded history view.';
      empty.className='muted';host.append(empty);return;}
    const list=document.createElement('ol');
    for(const r of rows){
      const li=document.createElement('li');
      const label=document.createElement('strong');label.textContent=body(r)[0];
      const detail=document.createElement('p');detail.className='muted';
      detail.textContent=body(r)[1];li.append(label,detail);list.append(li);
    }
    host.append(list);
  }
  async function open(id){
    if(!id||!accessToken)return;
    const n=++generation,token=accessToken;selected=id;
    el('job-history-status').textContent='Loading verified work-order history…';
    try{
      const response=await adminFetch(SUPABASE_URL+'/rest/v1/rpc/admin_release_history',{
        method:'POST',headers:{apikey:SUPABASE_PUBLISHABLE_KEY,
          Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify({p_wo:id,p_limit:25})
      });
      if(!response.ok)throw Error(await readableError(response,'History inaccessible.'));
      const history=await response.json();
      if(n!==generation||id!==selected||token!==accessToken||editWorkOrderIdInput.value!==id)return;
      if(history.work_order_id!==id||!Array.isArray(history.runs)
        ||!Array.isArray(history.corrections)||!Array.isArray(history.packages)
        ||history.runs.length>25||history.packages.length>25||history.corrections.length>25)
        throw Error('Unexpected scoped history response.');
      section('job-history-runs','Field visits / permanent runs',history.runs,r=>[
        'Run '+r.run_sequence+' · '+r.field_status,
        'Run '+r.run_id+' · '+(r.reopen_reason?'Reason: '+r.reopen_reason+' · ':'')+
        'Download '+(r.downloaded_at||'not confirmed')+
        ' · Start '+(r.started_at||'none')+' · Finish '+(r.finished_at||'none')+
        ' · Photos '+r.registered_photos+' · Verified private receipts '+r.private_receipts]);
      section('job-history-corrections','Correction obligations',history.corrections,r=>[
        r.kind+' · '+r.status,
        r.reason+' · Original run '+r.origin_run_id+
        ' · Replacement run '+r.replacement_run_id+
        (r.superseded_by?' · Replaced by obligation '+r.superseded_by:'')]);
      section('job-history-packages','Client package and confirmed delivery receipts',
        history.packages,r=>[
          'Package '+r.package_id.slice(0,8)+' · '+r.status,
          'Run '+r.run_id+' · '+r.selected_count+' selected photos · '+
          'Client WO '+(r.frozen_wo_number||'(draft)')+
          ' · Approved '+(r.approved_at||'not approved')+
          ' · Confirmed '+(r.receipt_confirmed_at||'NOT DELIVERED')+
          (r.verified_drive_folder_id?' · Verified folder '+r.verified_drive_folder_id:'')+
          (r.receipt_sha256?' · Receipt '+r.receipt_sha256:'')]);
      el('job-history-status').textContent=
        'Historical evidence is read-only.'+
        (history.more_runs||history.more_packages?' Additional older records exist beyond this 25-record page.':'');
    }catch(e){if(n===generation&&id===selected&&token===accessToken){
      el('job-history-status').textContent='History unavailable; no changes were made: '+e.message;}}
  }
  function init(){el('job-history-refresh').addEventListener('click',()=>open(selected));}
  return {open,reset,init};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ReleaseHistory;

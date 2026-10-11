/* Phase 6C: immutable cancelled-run history; server is the only owner of
   cancellation/supersession. Never touch original photos or replay unknown writes. */
const FollowupManagement=(()=>{
  let wo='',serial=0,facts=null,busy=false,uncertain=false;
  const el=id=>document.getElementById(id), UUID=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
  const can=(seq,id,token)=>seq===serial&&id===wo&&accessToken===token
    &&editWorkOrderIdInput.value===id;
  function reset(){
    serial++;wo='';facts=null;busy=false;uncertain=false;
    el('followup-management').hidden=true;el('followup-management').open=false;
    el('followup-management-reason').value='';
    el('followup-replacement-instructions').value='';
    el('followup-replacement-assignee').replaceChildren(new Option('Choose authorized contractor',''));
    el('followup-management-context').textContent='';
    el('followup-management-status').textContent='';
    el('followup-cancel').hidden=true;el('followup-replace').hidden=true;
  }
  function status(text,bad=false){
    el('followup-management-status').textContent=text;
    el('followup-management-status').classList.toggle('error',bad);
  }
  async function rpc(name,body,token){
    const response=await adminFetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{
      method:'POST',headers:{apikey:SUPABASE_PUBLISHABLE_KEY,
        Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    if(!response.ok)throw Error(await readableError(response,
      'Follow-up management was not confirmed.'));
    return response.json();
  }
  function controls(){
    el('followup-cancel').disabled=busy||uncertain||!facts?.can_cancel;
    el('followup-replace').disabled=busy||uncertain||!facts?.can_replace;
  }
  async function open(id,fieldStatus){
    if(!UUID.test(id)||!['ASSIGNED','CANCELLED'].includes(fieldStatus)){
      reset();return;
    }
    if(id===wo&&facts)return;
    const seq=++serial,token=accessToken;
    wo=id;facts=null;busy=false;uncertain=false;
    el('followup-management').hidden=true;
    try{
      const remote=await rpc('admin_followup_management_state',{p_wo:id},token);
      if(!can(seq,id,token))return;
      if(remote.work_order_id!==id||!remote.available)return;
      if(!['ASSIGNED','CANCELLED'].includes(remote.status)
         ||remote.run_id!==workOrderRows.find(x=>x.id===id)?.current_run_id)
        throw Error('Current run changed. Reload job.');
      facts=remote;
      el('followup-management').hidden=false;
      const cancel=remote.status==='ASSIGNED'&&remote.can_cancel;
      const replace=remote.status==='CANCELLED'&&remote.can_replace;
      el('followup-cancel').hidden=!cancel;
      el('followup-replace').hidden=!replace;
      el('followup-replacement').hidden=!replace;
      el('followup-management-context').textContent=
        remote.wo_number+' · '+remote.status.replaceAll('_',' ')+
        ' · current run '+remote.run_id.slice(0,8)+' · '+remote.kind+
        ' · Original correction remains in history.';
      el('followup-management-reason').value='';
      const choice=el('followup-replacement-assignee');
      choice.replaceChildren(new Option('Choose authorized contractor',''));
      for(const user of assignableUsers)if(UUID.test(user.user_id)&&user.role==='CONTRACTOR')
        choice.add(new Option(user.email||'Contractor',user.user_id));
      if([...choice.options].some(o=>o.value===remote.assigned_user_id))
        choice.value=remote.assigned_user_id;
      el('followup-replacement-due').value=remote.due_date||'';
      status(cancel?'Cancellation is permitted only before download, Accept, Start or photos.':
        replace?'Cancelled visit still has an OPEN correction. Explicit replacement is available.':
          'This assignment is protected; cancellation and replacement are blocked.');
      controls();
    }catch(err){
      if(can(seq,id,token)){facts=null;status('Protected follow-up management unavailable: '+err.message,true);}
    }
  }
  async function action(kind){
    if(!facts||busy||uncertain||JobWorkspace.dirty())return;
    const seq=serial,id=wo,token=accessToken,info=facts;
    const reason=el('followup-management-reason').value.trim();
    if(!reason){status('An office reason is required.',true);return;}
    const replacing=kind==='REPLACE_CANCELLED';
    if(replacing&&!info.can_replace||!replacing&&!info.can_cancel)return;
    const assignee=el('followup-replacement-assignee').value;
    const due=el('followup-replacement-due').value;
    const instructions=el('followup-replacement-instructions').value.trim();
    if(replacing&&(!assignee||!due)){status('Choose contractor and due date for replacement.',true);return;}
    const summary=[
      'Work Order '+info.wo_number,
      'Current run '+info.run_id,
      'Action '+(replacing?'Replace cancelled follow-up with a NEW run':'Cancel untouched follow-up'),
      'Reason '+reason,
      replacing?'Contractor '+(assignableUsers.find(x=>x.user_id===assignee)?.email||assignee):'',
      replacing?'Due '+due:'',
      replacing?'Instructions '+(instructions||'(none)'):'',
      'Existing work, Finish, photos and earlier deliveries are preserved.',
      replacing?'Cancelled run stays in history; new correction supersedes its OPEN obligation.':
        'Correction obligation stays OPEN and job needs attention.'
    ].filter(Boolean).join('\n');
    if(!window.confirm(summary+'\nConfirm this ONE action?'))return;
    const request=replacing?{
      p_action:crypto.randomUUID(),p_wo:id,p_cancelled_run:info.run_id,
      p_expected_updated_at:info.expected_wo_updated_at,p_reason:reason,
      p_assigned_user:assignee,p_due_date:due,p_instructions:instructions
    }:{
      p_action:crypto.randomUUID(),p_wo:id,p_run:info.run_id,
      p_expected_updated_at:info.expected_wo_updated_at,p_reason:reason
    };
    busy=true;controls();
    status(replacing?'Dispatching explicit replacement once…':'Cancelling untouched follow-up once…');
    try{
      const response=await rpc(replacing?'admin_replace_cancelled_followup':
        'admin_cancel_untouched_followup',request,token);
      if(!can(seq,id,token))return;
      if(response.work_order_id!==id||response.status!==(replacing?'ASSIGNED':'CANCELLED')
        ||!UUID.test(response.run_id)
        ||(replacing?response.run_id===info.run_id:response.run_id!==info.run_id))
        throw Error('Unexpected result; check server before any retry.');
      status(replacing?'Replacement assigned with NEW run and obligation history.':
        'Untouched visit cancelled. Unresolved correction retained; replacement requires a separate action.');
      facts=null;
      try{await JobWorkspace.reconcileSaved(id);await refreshWorkOrders();}
      catch{setEditStatus('Office action accepted; reload work order for exact history.',false);}
    }catch(err){
      if(can(seq,id,token)){
        uncertain=true;status('Outcome uncertain. Do NOT repeat. Reload and check the server history. '+err.message,true);
      }
    }finally{if(can(seq,id,token)){busy=false;controls();}}
  }
  function init(){
    el('followup-cancel').addEventListener('click',()=>action('CANCEL_UNTOUCHED'));
    el('followup-replace').addEventListener('click',()=>action('REPLACE_CANCELLED'));
  }
  return {init,open,reset};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=FollowupManagement;

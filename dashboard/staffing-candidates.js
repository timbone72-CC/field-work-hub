/* Phase 6F: exact selected-job assignment eligibility preview, not dispatch.
 * Private server predicate verifies current Supervisor/team/WO and Contractor work access.
 * Never treats an eligible roster row as consent to move active work. */
const SupervisorAssignmentCandidates = (() => {
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let generation=0,selected='',rows=[],next=null,busy=false,pending=null,assignBusy=false;
  const panel=()=>document.getElementById('supervisor-candidates');
  function status(message,error=false){
    const node=panel()?.querySelector('#supervisor-candidates-status');
    if(node){node.textContent=message;node.classList.toggle('error',error)}
  }
  function current(gen,wo,identity){
    return generation===gen && selected===wo
      && staffingStillCurrent(identity) && staffingWorkDetail?.work_order_id===wo
      && staffingWork?.rows.some(row=>row.work_order_id===wo
        && row.team_id===staffingWorkDetail.team_id);
  }
  function reset(){
    generation++;selected='';rows=[];next=null;busy=false;pending=null;assignBusy=false;
    panel()?.remove();
  }
  function mount(section){
    if(!staffingWorkDetail || panel() ||
      !['ASSIGNED','IN_PROGRESS'].includes(staffingWorkDetail.field_status))return;
    selected=staffingWorkDetail.work_order_id;
    const root=document.createElement('section');root.id='supervisor-candidates';
    root.className='subsection';
    const heading=document.createElement('h4');heading.textContent='Eligible team contractors';
    const description=document.createElement('p');description.className='muted';
    description.textContent='Current authorized options for this job. Assignment is rechecked by the server; in-progress work requires the current Contractor’s consent.';
    const load=document.createElement('button');load.type='button';load.className='secondary';
    load.textContent='Show eligible contractors';load.addEventListener('click',()=>void loadPage(false));
    const info=document.createElement('p');info.id='supervisor-candidates-status';
    info.className='muted';info.setAttribute('role','status');info.setAttribute('aria-live','polite');
    const list=document.createElement('div');list.id='supervisor-candidates-list';
    const more=document.createElement('button');more.type='button';more.className='secondary hidden';
    more.id='supervisor-candidates-more';more.textContent='More eligible contractors';
    more.addEventListener('click',()=>void loadPage(true));
    const form=document.createElement('form');form.id='supervisor-assignment-form';form.className='admin-form hidden';
    const selectLabel=document.createElement('label');selectLabel.textContent='Assign to Contractor';
    const select=document.createElement('select');select.id='supervisor-assignment-person';select.required=true;selectLabel.append(select);
    const reasonLabel=document.createElement('label');reasonLabel.textContent='Assignment reason';
    const reason=document.createElement('input');reason.id='supervisor-assignment-reason';reason.maxLength=1000;reason.required=true;reasonLabel.append(reason);
    const submit=document.createElement('button');submit.type='submit';submit.textContent='Confirm assignment';
    form.append(selectLabel,reasonLabel,submit);
    form.addEventListener('submit',event=>{event.preventDefault();void assign()});
    root.append(heading,description,load,info,list,more,form);
    section.append(root);
  }
  function render(){
    const p=panel();if(!p)return;
    const list=p.querySelector('#supervisor-candidates-list');list.replaceChildren();
    for(const candidate of rows){
      const row=document.createElement('p');
      const currentAssignee=staffingWorkDetail?.assignment?.assignee_id===candidate.user_id;
      row.textContent=candidate.label+(currentAssignee?' · Currently assigned':'');
      list.append(row);
    }
    p.querySelector('#supervisor-candidates-more').classList.toggle('hidden',!next);
    const form=p.querySelector('#supervisor-assignment-form'),select=form.querySelector('select');
    const previous=select.value;select.replaceChildren(new Option('Choose an eligible Contractor',''));
    for(const candidate of rows){
      const option=new Option(candidate.label,candidate.user_id);
      option.disabled=staffingWorkDetail?.assignment?.assignee_id===candidate.user_id;
      select.add(option);
    }
    if([...select.options].some(o=>o.value===previous&&!o.disabled))select.value=previous;
    form.classList.toggle('hidden',rows.length===0);
    form.querySelector('button').disabled=assignBusy;
  }
  async function loadPage(append){
    const identity=staffingIdentity(),gen=generation,wo=selected;
    if(!current(gen,wo,identity)||busy||(append&&!next))return;
    const old=append?rows:[],after=append?next:null;
    busy=true;status('Checking current team eligibility and work scope…');
    try{
      const response=await adminFetch(SUPABASE_URL+
        '/rest/v1/rpc/office_supervisor_assignment_candidates',{
        method:'POST',headers:authHeaders(true),
        body:JSON.stringify({
          p_org:identity.org,p_work_order:wo,
          p_expected_scope_fingerprint:staffingWork.scopeFingerprint,
          p_limit:25,p_after:after
        })
      });
      if(!current(gen,wo,identity))return;
      if(!response.ok){
        if([401,403,409].includes(response.status)){
          signOutButton.click();setLoginStatus('Supervisor contractor scope changed. Sign in again.',true);return;
        }
        throw Error(await readableError(response,'Eligible contractors are unavailable.'));
      }
      const result=await response.json();
      if(!current(gen,wo,identity))return;
      if(result.organization_id!==identity.org ||result.work_order_id!==wo
        ||result.team_id!==staffingWorkDetail.team_id
        ||result.scope_fingerprint!==staffingWork.scopeFingerprint
        ||result.field_status!==staffingWorkDetail.field_status
        ||result.requires_current_contractor_consent!==(staffingWorkDetail.field_status==='IN_PROGRESS')
        ||!Array.isArray(result.candidate_contractors)
        ||result.candidate_contractors.length>25
        ||result.candidate_contractors.some(c=>!UUID.test(c.user_id||'')
          ||typeof c.label!=='string'||!c.label.trim()
          ||old.some(existing=>existing.user_id===c.user_id))
        ||(result.next_after!==null&&result.next_after!==undefined
          &&(!UUID.test(result.next_after)||!result.candidate_contractors.length))){
        throw Error('Current contractor eligibility or selected work identity changed.');
      }
      rows=[...old,...result.candidate_contractors];
      next=result.next_after||null;
      render();
      status((rows.length?rows.length+' eligible team contractor(s) loaded.':'No eligible team contractors currently available.')+
        (result.requires_current_contractor_consent?
          ' This job is in progress: changing its assignee requires the current Contractor’s consent.':
          ' No assignment change has been made.'));
    }catch(error){
      if(current(gen,wo,identity)){
        rows=[];next=null;render();status(error.message,true);
      }
    }finally{busy=false}
  }
  async function assign(){
    const identity=staffingIdentity(),gen=generation,wo=selected,p=panel();
    if(!current(gen,wo,identity)||assignBusy||!p)return;
    const assignee=p.querySelector('#supervisor-assignment-person').value;
    const reason=p.querySelector('#supervisor-assignment-reason').value.trim();
    const candidate=rows.find(row=>row.user_id===assignee);
    if(!candidate||assignee===staffingWorkDetail?.assignment?.assignee_id||!reason||reason.length>1000){
      status('Choose a different eligible Contractor and enter a reason.',true);return;
    }
    const request={p_org:identity.org,p_work_order:wo,p_assignee:assignee,
      p_expected_scope_fingerprint:staffingWork.scopeFingerprint,
      p_expected_work_revision:staffingWorkDetail.work_revision,p_reason:reason};
    if(pending&&JSON.stringify(pending.request)!==JSON.stringify(request)){
      status('An assignment outcome is unresolved. Restore the exact Contractor and reason before retrying.',true);return;
    }
    pending||={action:crypto.randomUUID(),request};
    assignBusy=true;render();status('Submitting the exact assignment action…');
    try{
      const response=await adminFetch(SUPABASE_URL+'/rest/v1/rpc/office_supervisor_assign_work',{
        method:'POST',headers:authHeaders(true),body:JSON.stringify({...request,p_action:pending.action})
      });
      const result=await response.json().catch(()=>({}));
      if(!current(gen,wo,identity))return;
      if(!response.ok)throw Error(result.message||await readableError(response,'Assignment was not confirmed.'));
      if(result.action_id!==pending.action||result.work_order_id!==wo
        ||result.pending_assignee_user_id!==((result.status==='CONSENT_REQUIRED')?assignee:null)
        ||!['ASSIGNED','CONSENT_REQUIRED'].includes(result.status)||!result.work_revision)
        throw Error('Assignment response did not match the exact requested action.');
      pending=null;
      staffingWorkDetail.work_revision=result.work_revision;
      if(result.status==='ASSIGNED'){
        staffingWorkDetail.assignment.assignee_id=assignee;
        staffingWorkDetail.assignment.assignee_label=candidate.label;
        staffingWorkDetail.assignment.download_received_at=null;
        staffingWorkDetail.assignment.human_accepted_at=null;
        staffingWorkDetail.assignment.pending_assignee_id=null;
        staffingWorkDetail.assignment.pending_assignee_label=null;
        staffingWorkDetail.assignment.reassignment_requested_at=null;
        status('Server confirmed the new assignment. The Contractor must still explicitly Accept it.');
      }else{
        staffingWorkDetail.assignment.pending_assignee_id=assignee;
        staffingWorkDetail.assignment.pending_assignee_label=candidate.label;
        staffingWorkDetail.assignment.reassignment_requested_at='Pending current Contractor consent';
        status('Reassignment requested. The current Contractor keeps control until they consent.');
      }
      staffingRenderDetail();
    }catch(error){
      if(current(gen,wo,identity))status(error.message+' Exact action retained for safe retry.',true);
    }finally{assignBusy=false;render()}
  }
  return {mount,reset};
})();

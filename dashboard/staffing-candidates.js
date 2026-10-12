/* Phase 6F: exact selected-job assignment eligibility preview, not dispatch.
 * Private server predicate verifies current Supervisor/team/WO and Contractor work access.
 * Never treats an eligible roster row as consent to move active work. */
const SupervisorAssignmentCandidates = (() => {
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let generation=0,selected='',rows=[],next=null,busy=false;
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
    generation++;selected='';rows=[];next=null;busy=false;
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
    description.textContent='Current authorized options for this job. Preview only: this list does not assign or transfer anyone.';
    const load=document.createElement('button');load.type='button';load.className='secondary';
    load.textContent='Show eligible contractors';load.addEventListener('click',()=>void loadPage(false));
    const info=document.createElement('p');info.id='supervisor-candidates-status';
    info.className='muted';info.setAttribute('role','status');info.setAttribute('aria-live','polite');
    const list=document.createElement('div');list.id='supervisor-candidates-list';
    const more=document.createElement('button');more.type='button';more.className='secondary hidden';
    more.id='supervisor-candidates-more';more.textContent='More eligible contractors';
    more.addEventListener('click',()=>void loadPage(true));
    root.append(heading,description,load,info,list,more);
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
  return {mount,reset};
})();

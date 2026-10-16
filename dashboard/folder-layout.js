/* Phase 5 Admin client storage organization; no provider writes. */
const ClientFolderLayout = (() => {
  const $ = id => document.getElementById(id);
  let entries = [], revision = 0, busy = false;
  const layouts = new Set(['ADDRESS_WORK_ORDER','STATE_CITY_ADDRESS','STATE_COUNTY_CITY_ADDRESS']);
  async function rpc(name, body = {}) {
    if (!accessToken) throw Error('Sign in as an authorized Admin.');
    const res = await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{
      method:'POST',
      headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${accessToken}`,
        'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    if (!res.ok) throw Error(await readableError(res,'Client folder settings unavailable.'));
    return res.json();
  }
  const message = m => { $('folder-layout-status').textContent = m; };
  function selected() {return entries.find(x=>x.destination_id===$('folder-layout-destination').value);}
  function renderSelection() {
    const e=selected();
    $('folder-layout-choice').value=e?.layout||'ADDRESS_WORK_ORDER';
    $('folder-layout-choice').disabled=!e||busy;
    $('folder-layout-save').disabled=!e||busy;
    message(e ? 'Applies to new packages only. Existing deliveries will not move.'
      : 'No verified client storage destinations are available.');
  }
  async function load() {
    const current=++revision;busy=true;$('folder-layout-refresh').disabled=true;
    $('folder-layout-save').disabled=true;message('Checking authorized client destinations…');
    try {
      const result=await rpc('admin_list_client_folder_destinations');
      if(current!==revision)return;
      if(!Array.isArray(result?.destinations))throw Error('Destination response was incomplete.');
      entries=result.destinations.filter(e=>e.destination_id&&layouts.has(e.layout));
      $('folder-layout-destination').replaceChildren(
        new Option('Choose a verified client destination',''),
        ...entries.map(e=>new Option(e.company_name||'Client destination',e.destination_id)));
      $('folder-layout-destination').disabled=false;
    } catch(e) {if(current===revision){entries=[];$('folder-layout-destination').replaceChildren(
      new Option('No verified destinations',''));message(e.message);}}
    finally {if(current===revision){busy=false;$('folder-layout-refresh').disabled=false;
      if(entries.length)renderSelection();}}
  }
  async function save() {
    const e=selected(),chosen=$('folder-layout-choice').value;
    if(!e||busy||!layouts.has(chosen)||chosen===e.layout)return;
    if(!confirm('Change this client’s folder layout for future approved packages? Existing deliveries stay in place.'))return;
    busy=true;$('folder-layout-save').disabled=true;message('Saving client folder preference…');
    const token=accessToken,request=++revision;
    try {
      const result=await rpc('admin_set_client_folder_layout',{
        p_action:crypto.randomUUID(),p_destination:e.destination_id,
        p_expected_revision:e.revision||null,p_layout:chosen
      });
      if(request!==revision||token!==accessToken)return;
      if(result.destination_id!==e.destination_id||result.layout!==chosen||!result.revision)
        throw Error('Folder layout confirmation was incomplete.');
      e.layout=result.layout;e.revision=result.revision;
      message('Folder preference saved. No photos or existing folders were moved.');
    } catch(err){if(request===revision)message(err.message+' Refresh before trying again.');}
    finally{if(request===revision){busy=false;$('folder-layout-save').disabled=false;}}
  }

  // Authorized company suggestions come from the selected job's scoped RPC.
  // This submits only an inactive, unverified candidate; no provider operation.
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const DRIVE=/^[A-Za-z0-9_-]{10,160}$/;
  const EMAIL=/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
  let proposalJob='',proposalActor='',proposalToken='',proposalEpoch=0;
  let proposalCompanies=[],pending=null,confirmed=false,proposalBusy=false;
  const pe=name=>$('folder-proposal-'+name);
  const say=msg=>{pe('status').textContent=msg;};
  const sameSession=epoch=>epoch===proposalEpoch&&!!accessToken
    &&proposalToken===accessToken&&proposalActor===currentUser?.id
    &&proposalJob===editWorkOrderIdInput.value;
  function buttons(){
    const frozen=proposalBusy||!!pending||confirmed||!proposalJob;
    for(const key of ['company','email','root'])pe(key).disabled=frozen;
    const company=pe('company').value, email=pe('email').value.trim().toLowerCase();
    const root=pe('root').value.trim();
    pe('submit').disabled=proposalBusy||confirmed||!proposalJob
      ||(!pending&&(!proposalCompanies.some(c=>c.id===company)
        ||!EMAIL.test(email)||email.length>254||!DRIVE.test(root)));
    pe('submit').textContent=pending?'Retry exact proposal':'Record inactive proposal';
  }
  function resetProposal(){
    proposalEpoch++;proposalJob='';proposalActor='';proposalToken='';
    proposalCompanies=[];pending=null;confirmed=false;proposalBusy=false;
    pe('area').hidden=true;
    pe('company').replaceChildren(new Option('Choose authorized client',''));
    pe('email').value='';pe('root').value='';say('');buttons();
  }
  function bindProposal(choice,token){
    if(!UUID.test(choice?.work_order_id||'')||!Array.isArray(choice?.companies)
      ||!currentUser?.id||token!==accessToken){resetProposal();return;}
    if(proposalJob!==choice.work_order_id||proposalActor!==currentUser.id||proposalToken!==token)
      resetProposal();
    proposalJob=choice.work_order_id;proposalActor=currentUser.id;proposalToken=token;
    proposalCompanies=choice.companies.filter(c=>UUID.test(c?.id||'')
      &&typeof c.name==='string'&&c.name.length<=320).slice(0,100);
    if(pending&&!proposalCompanies.some(c=>c.id===pending.company)){resetProposal();return;}
    const existing=pe('company').value;
    pe('company').replaceChildren(new Option('Choose authorized client',''),
      ...proposalCompanies.map(c=>new Option(c.name,c.id)));
    const want=pending?.company||existing||choice.client_company_id||'';
    pe('company').value=proposalCompanies.some(c=>c.id===want)?want:'';
    pe('area').hidden=false;
    if(!pending&&!confirmed) say('Records an INACTIVE, UNVERIFIED candidate only. Delivery remains blocked.');
    buttons();
  }
  async function submitProposal(){
    const epoch=proposalEpoch;
    if(!sameSession(epoch)||proposalBusy||confirmed)return;
    if(!pending){
      const company=pe('company').value,email=pe('email').value.trim().toLowerCase();
      const root=pe('root').value.trim();
      if(!proposalCompanies.some(c=>c.id===company)||!EMAIL.test(email)
        ||email.length>254||!DRIVE.test(root))return;
      pending={action:crypto.randomUUID(),company,email,root};
    }
    const request=pending;
    proposalBusy=true;buttons();say('Requesting inactive proposal; no Google file or Send.');
    try{
      const response=await adminFetch(SUPABASE_URL+'/rest/v1/rpc/admin_propose_client_delivery_destination',{
        method:'POST',headers:{apikey:SUPABASE_PUBLISHABLE_KEY,
          Authorization:'Bearer '+proposalToken,'Content-Type':'application/json'},
        body:JSON.stringify({p_action:request.action,p_company:request.company,
          p_workspace_email:request.email,p_root_folder_id:request.root})
      });
      if(!sameSession(epoch))return;
      if(!response.ok){
        if([408,429,500,502,503,504].includes(response.status)){
          say('Result uncertain (HTTP '+response.status
            +'). Retry this exact request, not a new folder or action.');
        }else{
          pending=null;
          say('Server rejected the proposal (HTTP '+response.status
            +'). No activation. Recheck account and client folder ID.');
        }
        return;
      }
      const reply=await response.json();
      if(!sameSession(epoch))return;
      if(!UUID.test(reply?.destination_id||'')||!UUID.test(reply?.revision||'')
        ||reply.company_id!==request.company||reply.verified!==false||reply.active!==false){
        say('Response did not confirm an inactive proposal; retain exact inputs for reconciliation.');
        return;
      }
      confirmed=true;
      say('Recorded as INACTIVE and UNVERIFIED. A separate trusted Google check is required.');
    }catch{
      if(sameSession(epoch))say('Network outcome uncertain. Retry only this same proposal; no Send was requested.');
    }finally{
      if(sameSession(epoch)){proposalBusy=false;buttons();}
    }
  }

  function init() {
    $('folder-layout-refresh')?.addEventListener('click',load);
    pe('submit')?.addEventListener('click',()=>{void submitProposal();});
    for(const key of ['company','email','root'])
      pe(key)?.addEventListener(key==='company'?'change':'input',buttons);
    resetProposal();
    $('folder-layout-destination')?.addEventListener('change',renderSelection);
    $('folder-layout-save')?.addEventListener('click',save);
    $('folder-layout-choice')?.addEventListener('change',()=>{
      $('folder-layout-save').disabled=busy||!selected()||
        selected().layout===$('folder-layout-choice').value;
    });
  }
  return {init,load,bindProposal,resetProposal};
})();
if(typeof document!=='undefined') ClientFolderLayout.init();
if(typeof module!=='undefined'&&module.exports)module.exports=ClientFolderLayout;

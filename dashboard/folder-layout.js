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
  let layoutPending = null;
  const destinationEl = $('folder-layout-destination');
  const choiceEl = $('folder-layout-choice');
  const saveEl = $('folder-layout-save');
  const refreshEl = $('folder-layout-refresh');
  // Token values rotate during a normal refresh. The existing session epoch
  // changes on sign-out/new sign-in, not on a same-user refresh.
  const currentLayout = (request, session, actor, job) =>
    request === revision && !!accessToken && session === adminSessionEpoch
    && actor === currentUser?.id && job === editWorkOrderIdInput.value;
  function selected() {
    return entries.find(x => x.destination_id === destinationEl.value);
  }
  function updateLayoutButtons() {
    const e = selected();
    destinationEl.disabled = busy || !!layoutPending || !entries.length;
    choiceEl.disabled = !e || busy || !!layoutPending;
    saveEl.disabled = !e || busy || (!layoutPending && choiceEl.value === e.layout);
    saveEl.textContent = layoutPending ? 'Retry exact preference save' : 'Save folder preference';
    refreshEl.disabled = busy || !!layoutPending;
  }
  function renderSelection() {
    const e = selected();
    if (!layoutPending) choiceEl.value = e?.layout || 'ADDRESS_WORK_ORDER';
    updateLayoutButtons();
    message(e ? 'Applies to new packages only. Existing deliveries will not move.'
      : 'No active, verified client destinations are available. An inactive registered destination may exist; check before proposing a new root.');
  }
  function clearVerified() {
    revision++; busy = false; layoutPending = null; entries = [];
    destinationEl.replaceChildren(new Option('Load verified destinations', ''));
    choiceEl.value = 'ADDRESS_WORK_ORDER';
    message('');
    updateLayoutButtons();
  }
  function reset() {
    clearVerified();
    resetProposal();
  }
  async function load() {
    if (busy || layoutPending) return;
    const session = adminSessionEpoch, actor = currentUser?.id, job = editWorkOrderIdInput.value;
    if (!accessToken || !actor || !job) {
      clearVerified(); return;
    }
    const request = ++revision;
    busy = true; updateLayoutButtons(); message('Checking authorized client destinations…');
    try {
      const result = await rpc('admin_list_client_folder_destinations');
      if (!currentLayout(request, session, actor, job)) return;
      if (!Array.isArray(result?.destinations)) throw Error('Destination response was incomplete.');
      const ids = new Set();
      const fresh = [];
      for (const e of result.destinations) {
        if (!UUID.test(e?.destination_id || '') || !UUID.test(e?.company_id || '')
          || typeof e.company_name !== 'string' || !layouts.has(e.layout)
          || (e.revision !== null && e.revision !== undefined && !UUID.test(e.revision))
          || ids.has(e.destination_id)) {
          throw Error('Authorized destination list was invalid; no settings were opened.');
        }
        ids.add(e.destination_id);
        fresh.push(e);
      }
      entries = fresh;
      destinationEl.replaceChildren(
        new Option('Choose a verified client destination', ''),
        ...entries.map(e => new Option(e.company_name, e.destination_id)));
      renderSelection();
    } catch (error) {
      if (currentLayout(request, session, actor, job)) {
        entries = []; destinationEl.replaceChildren(new Option('No verified destinations', ''));
        message(error.message);
      }
    } finally {
      if (currentLayout(request, session, actor, job)) {
        busy = false; updateLayoutButtons();
      }
    }
  }
  async function save() {
    const session = adminSessionEpoch, actor = currentUser?.id, job = editWorkOrderIdInput.value;
    const e = selected();
    if (!e || busy || !accessToken || !actor || !job) return;
    if (!layoutPending) {
      const chosen = choiceEl.value;
      if (!layouts.has(chosen) || chosen === e.layout) return;
      if (!confirm('Change this client’s folder layout for future approved packages? Existing deliveries stay in place.')) return;
      layoutPending = {action: crypto.randomUUID(), destination: e.destination_id,
        company: e.company_id, expectedRevision: e.revision || null, layout: chosen};
    }
    const frozen = layoutPending;
    const request = ++revision;
    busy = true; updateLayoutButtons(); message('Saving exact client folder preference…');
    try {
      const response = await adminFetch(SUPABASE_URL + '/rest/v1/rpc/admin_set_client_folder_layout', {
        method: 'POST',
        headers: {apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json'},
        body: JSON.stringify({p_action: frozen.action, p_destination: frozen.destination,
          p_expected_revision: frozen.expectedRevision, p_layout: frozen.layout})
      });
      if (!currentLayout(request, session, actor, job)) return;
      if (!response.ok) {
        if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
          message('Save outcome uncertain (HTTP ' + response.status
            + '). Retry the SAME preference action; existing folders were not moved.');
        } else {
          layoutPending = null;
          entries = []; destinationEl.replaceChildren(new Option('Reload verified clients', ''));
          message('Folder preference was rejected or conflicted (HTTP ' + response.status
            + '). Reload authorized destinations before another change.');
        }
        return;
      }
      const result = await response.json();
      if (!currentLayout(request, session, actor, job)) return;
      if (result?.destination_id !== frozen.destination || result?.company_id !== frozen.company
        || result?.layout !== frozen.layout || !UUID.test(result?.revision || '')) {
        message('Save confirmation is incomplete. Retry ONLY the same action to reconcile.');
        return;
      }
      e.layout = result.layout; e.revision = result.revision;
      layoutPending = null;
      message('Folder preference saved. No photos or existing folders were moved.');
    } catch {
      if (currentLayout(request, session, actor, job))
        message('Connection outcome uncertain. Retry ONLY the same preference action.');
    } finally {
      if (currentLayout(request, session, actor, job)) {
        busy = false; updateLayoutButtons();
      }
    }
  }

  // Authorized company suggestions come from the selected job's scoped RPC.
  // This submits only an inactive, unverified candidate; no provider operation.
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const DRIVE=/^[A-Za-z0-9_-]{10,160}$/;
  const EMAIL=/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
  let proposalJob='',proposalActor='',proposalAuthEpoch=-1,proposalEpoch=0;
  let proposalCompanies=[],pending=null,confirmed=false,proposalBusy=false;
  const pe=name=>$('folder-proposal-'+name);
  const say=msg=>{pe('status').textContent=msg;};
  const sameSession=epoch=>epoch===proposalEpoch&&!!accessToken
    &&proposalAuthEpoch===adminSessionEpoch&&proposalActor===currentUser?.id
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
    proposalEpoch++;proposalJob='';proposalActor='';proposalAuthEpoch=-1;
    proposalCompanies=[];pending=null;confirmed=false;proposalBusy=false;
    pe('area').hidden=true;
    pe('company').replaceChildren(new Option('Choose authorized client',''));
    pe('email').value='';pe('root').value='';say('');buttons();
  }
  function bindProposal(choice,token){
    if(!UUID.test(choice?.work_order_id||'')||!Array.isArray(choice?.companies)
      ||!currentUser?.id||token!==accessToken){resetProposal();return;}
    if(proposalJob!==choice.work_order_id||proposalActor!==currentUser.id||proposalAuthEpoch!==adminSessionEpoch)
      resetProposal();
    proposalJob=choice.work_order_id;proposalActor=currentUser.id;proposalAuthEpoch=adminSessionEpoch;
    proposalCompanies=choice.companies.filter(c=>UUID.test(c?.id||'')
      &&typeof c.name==='string'&&c.name.length<=320).slice(0,100);
    if(pending&&!proposalCompanies.some(c=>c.id===pending.company)){resetProposal();return;}
    const existing=pe('company').value;
    pe('company').replaceChildren(new Option('Choose authorized client',''),
      ...proposalCompanies.map(c=>new Option(c.name,c.id)));
    const want=pending?.company||existing||choice.client_company_id||'';
    pe('company').value=proposalCompanies.some(c=>c.id===want)?want:'';
    pe('area').hidden=false;
    if(!pending&&!confirmed) say('For a NEW, unregistered client root only. Saves an INACTIVE, UNVERIFIED candidate; no delivery is enabled. Existing inactive destinations are not listed above.');
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
          Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
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
    reset();
    $('folder-layout-destination')?.addEventListener('change',renderSelection);
    $('folder-layout-save')?.addEventListener('click',save);
    $('folder-layout-choice')?.addEventListener('change', updateLayoutButtons);
  }
  return {init,load,bindProposal,resetProposal,reset};
})();
if(typeof document!=='undefined') ClientFolderLayout.init();
if(typeof module!=='undefined'&&module.exports)module.exports=ClientFolderLayout;

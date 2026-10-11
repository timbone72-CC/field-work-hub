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
  function init() {
    $('folder-layout-refresh')?.addEventListener('click',load);
    $('folder-layout-destination')?.addEventListener('change',renderSelection);
    $('folder-layout-save')?.addEventListener('click',save);
    $('folder-layout-choice')?.addEventListener('change',()=>{
      $('folder-layout-save').disabled=busy||!selected()||
        selected().layout===$('folder-layout-choice').value;
    });
  }
  return {init,load};
})();
if(typeof document!=='undefined') ClientFolderLayout.init();
if(typeof module!=='undefined'&&module.exports)module.exports=ClientFolderLayout;

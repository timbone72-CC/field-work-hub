/* One Admin correction draft and server checked dispatch; not a second work or delivery owner. */
const CorrectionDraft=(()=>{
  let wo='',generation=0,data=null,editor=null,baseline=null,refs=new Set(),maps=new Map();
  let releaseRev='',preview=null,busy=false,uncertain=false;
  const el=id=>document.getElementById(id);
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function valid(g,id,token){return g===generation&&wo===id&&!!token&&accessToken===token&&editWorkOrderIdInput.value===id;}
  async function rpc(name,payload,token){
    const response=await adminFetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{
      method:'POST',headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify(payload)});
    if(!response.ok)throw Error(await readableError(response,'Correction request unavailable; nothing confirmed.'));
    return response.json();
  }
  function status(s,bad=false){el('correction-status').textContent=s;el('correction-status').classList.toggle('error',bad);}
  function reset(){
    generation++;wo='';data=null;baseline=null;refs=new Set();maps=new Map();
    releaseRev='';preview=null;busy=false;uncertain=false;
    el('correction-details').hidden=true;el('correction-details').open=false;
    el('correction-summary').hidden=true;el('correction-summary').textContent='';
    el('correction-references').textContent='';status('');
    if(editor)editor.load(null);
  }
  function hasReference(id){return refs.has(id);}
  function reference(id,checked){
    if(!data||!UUID.test(id)||busy)return;
    if(checked&&refs.size>=200){status('Maximum 200 photo references.',true);return;}
    if(checked)refs.add(id);else refs.delete(id);
    el('correction-references').textContent=refs.size+' earlier photo reference(s) selected.';
    invalidate();
  }
  function invalidate(){preview=null;el('correction-summary').hidden=true;buttons();}
  function drawMaps(){
    const host=el('correction-item-mapping');host.replaceChildren();
    if(!data||!editor)return;
    const ids=new Set(editor.value.items.map(i=>i.id));
    for(const id of [...maps.keys()])if(!ids.has(id))maps.delete(id);
    for(const item of editor.value.items){
      const label=document.createElement('label');
      label.textContent='New photo '+(item.label.trim()||'(unnamed)')+' fulfills ';
      const input=document.createElement('select');
      input.setAttribute('aria-label','Release goal for '+item.id);
      input.add(new Option('Extra (not a named client requirement)',''));
      for(const goal of data.release_requirements.items.filter(i=>i.enabled))
        input.add(new Option(goal.label,goal.id));
      input.add(new Option('New client release goal','NEW'));
      input.value=maps.get(item.id)||'';
      input.addEventListener('change',()=>{
        maps.set(item.id,input.value);releaseRev=crypto.randomUUID();invalidate();});
      label.append(input);host.append(label);
    }
    invalidate();
  }
  function inputData(){
    if(!data||!editor)throw Error('Open a verified completed work order first.');
    const capture=structuredClone(editor.value);
    const release=structuredClone(data.release_requirements);
    release.revision=releaseRev;
    const itemMapping=capture.items.map(item=>{
      const target=maps.get(item.id)||null;
      if(target==='NEW'&&!release.items.some(i=>i.id===item.id)){
        const next=structuredClone(item);next.order=release.items.length;release.items.push(next);
      }
      return {capture_item_id:item.id,release_item_id:target==='NEW'?item.id:target};
    });
    return {
      p_wo:wo,p_expected_run:data.origin_run_id,
      p_expected_wo_updated_at:data.expected_wo_updated_at,
      p_expected_revision:data.draft?.revision||null,
      p_reason:el('correction-reason').value.trim(),
      p_reference_photos:[...refs].sort(),p_assigned_user:el('correction-assignee').value||null,
      p_due_date:el('correction-due').value||null,
      p_instructions:el('correction-instructions').value.trim(),
      p_capture_requirements:capture,p_item_mapping:itemMapping,p_release_requirements:release
    };
  }
  function fingerprint(){return data?JSON.stringify(inputData()):'';}
  function dirty(){return !!data&&baseline!==null&&fingerprint()!==baseline;}
  function buttons(){
    el('correction-save').disabled=busy||!data||uncertain;
    el('correction-preview').disabled=busy||!data?.draft||dirty()||uncertain;
    el('correction-dispatch').disabled=busy||!preview||dirty()||uncertain;
  }
  function fill(source){
    data=source;const d=source.draft?.status==='DRAFT'?source.draft:null;
    refs=new Set((d?.reference_photos||[]).filter(x=>UUID.test(x)));
    releaseRev=d?.release_requirements?.revision||crypto.randomUUID();
    el('correction-kind').textContent=source.kind==='CLIENT_RETURN'?
      'Client return: an earlier client package was delivered. A new corrected submission will be needed.':
      'Internal correction: no client package has yet been delivered.';
    el('correction-reason').value=d?.reason||'';
    el('correction-due').value=d?.due_date||source.current_due_date||'';
    el('correction-instructions').value=d?.instructions||'';
    const select=el('correction-assignee');select.replaceChildren(new Option('Choose authorized contractor',''));
    for(const user of assignableUsers)if(UUID.test(user.user_id)&&user.role==='CONTRACTOR')
      select.add(new Option(user.email||'Contractor',user.user_id));
    const chosen=d?.assigned_user_id||source.current_assignee;
    select.value=[...select.options].some(option=>option.value===chosen)?chosen:'';
    editor.load(d?.capture_requirements||PhotoRules.empty());
    maps=new Map((d?.item_mapping||[]).map(m=>[m.capture_item_id,
      m.release_item_id===null?'':source.release_requirements.items.some(i=>i.id===m.release_item_id)?m.release_item_id:'NEW']));
    drawMaps();
    el('correction-references').textContent=refs.size+' earlier photo reference(s) selected.';
    el('correction-details').hidden=false;
    baseline=fingerprint();preview=null;uncertain=false;buttons();
    status(d?'Saved server correction draft loaded.':'Set up this correction, then Save. No dispatch has happened.');
  }
  async function open(id,fieldStatus){
    if(fieldStatus!=='FIELD_COMPLETE'||!UUID.test(id)){reset();return;}
    if(wo===id&&data&&dirty()){buttons();return;}
    const gen=++generation,token=accessToken;
    wo=id;data=null;baseline=null;preview=null;uncertain=false;
    el('correction-details').hidden=true;status('Checking correction eligibility…');
    try{
      const source=await rpc('admin_correction_state',{p_wo:id},token);
      if(!valid(gen,id,token))return;
      if(source.work_order_id!==id||!UUID.test(source.origin_run_id)||
        !['CLIENT_RETURN','INTERNAL_CORRECTION'].includes(source.kind)||
        !source.release_requirements)throw Error('Invalid server correction context.');
      fill(source);
    }catch(err){if(valid(gen,id,token)){data=null;el('correction-details').hidden=true;
      status('Follow-up unavailable: '+err.message,true);}}
  }
  async function save(){
    if(!data||busy||uncertain)return false;
    const gen=generation,id=wo,token=accessToken;
    try{
      if(JobWorkspace.detailsDirty()||ClientRelease.dirty()||JobWorkspace.needsReload())
        throw Error('Save or reload other job changes first.');
      const body=inputData();
      if(!body.p_reason||!body.p_assigned_user||!body.p_due_date)
        throw Error('Reason, contractor and due date required.');
      PhotoRules.validate(body.p_capture_requirements);
      PhotoRules.validate(body.p_release_requirements);
      busy=true;buttons();status('Saving correction draft…');
      const result=await rpc('admin_save_correction_draft',body,token);
      if(!valid(gen,id,token))return false;
      if(!UUID.test(result.revision)||result.status!=='DRAFT')
        throw Error('Server did not confirm a new draft revision.');
      const updated=await rpc('admin_correction_state',{p_wo:id},token);
      if(!valid(gen,id,token))return false;
      if(updated.draft?.revision!==result.revision)
        throw Error('Saved draft changed during verification. Reload.');
      fill(updated);status('Draft saved. Review exact summary before Dispatch.');
      return true;
    }catch(err){if(valid(gen,id,token)){preview=null;status('Draft not confirmed: '+err.message,true);}return false;}
    finally{if(valid(gen,id,token)){busy=false;buttons();}}
  }
  async function showPreview(){
    if(!data?.draft||dirty()||busy||uncertain)return;
    const gen=generation,id=wo,token=accessToken;
    try{
      if(JobWorkspace.detailsDirty()||ClientRelease.dirty()||JobWorkspace.needsReload())
        throw Error('Other job changes must be saved and reloaded first.');
      busy=true;buttons();status('Checking saved correction…');
      const response=await rpc('admin_preview_correction_draft',{
        p_wo:id,p_revision:data.draft.revision},token);
      if(!valid(gen,id,token))return;
      if(response.draft_revision!==data.draft.revision||
         !/^[a-f0-9]{64}$/.test(response.preview_sha256)||
         response.summary?.work_order_id!==id)throw Error('Wrong checked preview identity.');
      preview=response;
      const s=response.summary,person=assignableUsers.find(u=>u.user_id===s.assigned_user_id);
      const mapped=(s.item_mapping||[]).map(m=>{
        const from=s.capture_requirements.items.find(x=>x.id===m.capture_item_id);
        const to=s.release_requirements.items.find(x=>x.id===m.release_item_id);
        return (from?.label||'New photo')+' → '+(to?.label||'Extra');
      });
      el('correction-summary').textContent=[
        'Same client WO: '+s.wo_number,
        'Follow-up: '+(s.kind==='CLIENT_RETURN'?'Client return':'Internal correction'),
        'Due: '+s.due_date,'Contractor: '+(person?.email||s.assigned_user_id),
        'Reason: '+s.reason,'Instructions: '+(s.instructions||'(none)'),
        'New visit photos: '+PhotoRules.summary(s.capture_requirements),
        'Earlier verified photo references: '+s.reference_photos.length,
        ...mapped.map(x=>'Release mapping: '+x),
        'Existing Finish, photo ownership and client delivery history are preserved.',
        'Dispatch creates a NEW run; it does NOT send client photos.'
      ].join('\n');
      el('correction-summary').hidden=false;
      status('Exact server preview checked. Only the separate Dispatch button creates a new run.');
    }catch(err){if(valid(gen,id,token)){preview=null;status('Preview failed: '+err.message,true);}}
    finally{if(valid(gen,id,token)){busy=false;buttons();}}
  }
  async function dispatch(){
    if(!preview||!data?.draft||dirty()||busy||uncertain)return;
    if(!window.confirm('Dispatch this exact follow-up as a NEW run under the SAME client work order?'))return;
    const gen=generation,id=wo,token=accessToken,hash=preview.preview_sha256,rev=data.draft.revision;
    busy=true;buttons();status('Dispatching this checked correction once…');
    try{
      const result=await rpc('admin_dispatch_correction_draft',{
        p_action:crypto.randomUUID(),p_wo:id,p_revision:rev,p_preview_sha256:hash},token);
      if(!valid(gen,id,token))return;
      if(result.work_order_id!==id||!UUID.test(result.run_id)||
        result.run_id===data.origin_run_id||result.status!=='ASSIGNED')
        throw Error('Server result needs re-verification.');
      data=null;baseline=null;preview=null;uncertain=false;
      status('New follow-up run dispatched. No client photo delivery occurred.');
      try{
        await JobWorkspace.reconcileSaved(id);
        await refreshWorkOrders();
      }catch{setEditStatus('Correction was accepted. Reload this job to view the fresh assignment.',false);}
    }catch(err){
      if(valid(gen,id,token)){uncertain=true;preview=null;
        status('Dispatch result uncertain. DO NOT repeat it. Reload and inspect the server job before another attempt. '+err.message,true);}
    }finally{if(valid(gen,id,token)){busy=false;buttons();}}
  }
  function init(){
    editor=new PhotoRequirementEditor(el('correction-photo-requirements'),
      ()=>editWorkTypeInput.value,null,false);
    const host=el('correction-photo-requirements');
    host.addEventListener('click',()=>queueMicrotask(drawMaps));
    host.addEventListener('change',()=>queueMicrotask(drawMaps));
    for(const id of ['correction-reason','correction-assignee','correction-due','correction-instructions'])
      el(id).addEventListener('input',invalidate);
    el('correction-save').addEventListener('click',()=>save());
    el('correction-preview').addEventListener('click',()=>showPreview());
    el('correction-dispatch').addEventListener('click',()=>dispatch());
  }
  return {init,reset,open,dirty,save,hasReference,reference};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=CorrectionDraft;

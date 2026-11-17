/* One server-backed Create & Assign draft; the existing create RPC owns dispatch. */
const CreateJobDrafts=(()=>{
  const el=id=>document.getElementById(id);
  let provenance=null,provenanceRequirements='',pending=null,creationAttempt=null;
  let companyGeneration=0,companyLoad=null,companies=new Map(),companySelection='';
  const resetProvenance=()=>{provenance=null;provenanceRequirements='';};
  const editor=JobDraftEditor({prefix:'create-draft-',isNew:true,editor:()=>createPhotos,form:()=>createForm,
    fields:{woNumber:'wo-number',propertyAddress:'property-address',workType:'work-type',
      instructions:'instructions',dueDate:'due-date',assignedUserId:'assignee'},matches:()=>true,
    extra:()=>({clientCompanyId:el('create-company').value,numberMode:currentWoNumberMode(),rememberNumberMode:rememberWoNumberMode.checked,
      sourceTemplateId:createPhotos.selectedId||(JSON.stringify(createPhotos.value)===provenanceRequirements?provenance:null)}),
    restored:p=>{companySelection=p.clientCompanyId||'';el('create-company').value=companies.has(companySelection)?companySelection:'';
      createPhotos.setCompany(el('create-company').value||null);
      if(p.clientCompanyId&&!companies.has(p.clientCompanyId))el('create-company-status').textContent='Saved client is unavailable. Choose an active client before creating; other draft fields are retained.';
      applyWoNumberMode(p.numberMode);rememberWoNumberMode.checked=p.rememberNumberMode;
      provenance=p.sourceTemplateId;provenanceRequirements=JSON.stringify(createPhotos.value);fillWorkTypes();},
    hasContent:()=>!!(el('create-company').value||woNumberInput.value.trim()||propertyAddressInput.value.trim()||workTypeInput.value.trim()
      ||instructionsInput.value.trim()||dueDateInput.value||assigneeSelect.value
      ||createPhotos.value.items.length||createPhotos.value.total.enabled)});
  async function loadCompanies(){
    if(companyLoad)return companyLoad;
    const gen=companyGeneration,epoch=adminSessionEpoch,actor=currentUser?.id,org=currentUser?.app_metadata?.organization_id;
    if(!accessToken||!actor||currentUser?.app_metadata?.role!=='ADMIN')return;
    const current=()=>gen===companyGeneration&&!!accessToken&&epoch===adminSessionEpoch&&actor===currentUser?.id&&org===currentUser?.app_metadata?.organization_id;
    const select=el('create-company'),message=el('create-company-status'),chosen=select.value||companySelection;
    select.disabled=true;message.textContent='Loading client companies…';
    const task=(async()=>{try{
      const response=await adminFetch(SUPABASE_URL+'/rest/v1/rpc/admin_creation_client_choices',{
        method:'POST',headers:authHeaders(true),body:'{}'});
      if(!current())return;
      if(!response.ok)throw Error(await readableError(response,'Client companies could not load.'));
      const data=await response.json();if(!current())return;
      const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
      if(data.organization_id!==org||!Array.isArray(data.companies)||data.companies.some(c=>!uuid.test(c.id)||typeof c.name!=='string')
        ||new Set(data.companies.map(c=>c.id)).size!==data.companies.length)throw Error('Client company list could not be verified.');
      companies=new Map(data.companies.map(c=>[c.id,c.name]));
      select.replaceChildren(new Option('Choose client company',''));
      for(const c of data.companies)select.add(new Option(c.name,c.id));
      select.value=companies.has(chosen)?chosen:'';select.disabled=false;createPhotos.setCompany(select.value||null);
      message.textContent=companies.size?'Choose a client company before Create & Assign. Save draft can keep an unfinished entry.':'No active client companies are configured. Save your draft; a client company must be configured before dispatch.';
    }catch(error){if(current())message.textContent=error.message+' Your draft is retained. Use Reload client companies before creating.';}
    finally{if(current())companyLoad=null;}})();
    companyLoad=task;return task;
  }
  function ensure(){if(!accessToken||currentUser?.app_metadata?.role!=='ADMIN')return;
    if(!companies.size&&!companyLoad)void loadCompanies();
    if(!editor.active()){resetProvenance();return editor.open({id:null,updated_at:null});}}
  function reset(){companyGeneration++;companyLoad=null;companies.clear();companySelection='';
    const select=el('create-company');select.replaceChildren(new Option('Choose client company',''));select.value='';select.disabled=true;
    el('create-company-status').textContent='Choose a client company before Create & Assign.';creationAttempt=null;editor.reset();resetProvenance();pending=null;const node=el('create-draft-unsaved');if(node)node.hidden=true;}
  function clearForm(){companySelection='';createForm.reset();createPhotos.load(null);fillWorkTypes();restoreWoNumberModePreference();
    fillAssigneeSelect(assigneeSelect,assignableUsers,'Choose Team user');resetProvenance();}
  function guard(action){if(!editor.active()){action();return;}
    if(editor.busy())return;
    if(!editor.dirty()){action();return;}
    pending=action;el('create-draft-unsaved').hidden=false;el('create-draft-stay').focus();}
  function finish(){const action=pending;pending=null;el('create-draft-unsaved').hidden=true;if(action)action();}
  async function submit(){
    await ensure();
    if(!editor.active())throw Error('Current creator session required.');
    const company=el('create-company').value;
    if(el('create-company').disabled||!companies.has(company))throw Error('Choose a client company before Create & Assign. You can Save draft without one.');
    if(creationAttempt&&creationAttempt.fingerprint!==editor.fingerprint())
      throw Error('Earlier creation is unconfirmed. Check Work Orders, keep new input with Save draft, then reload before creating different work. Your input is retained.');
    if(!creationAttempt){
      if(!editor.isSaved()&&!await editor.save())throw Error('Save draft was not confirmed. Nothing was created.');
      creationAttempt={revision:editor.revision(),fingerprint:editor.fingerprint(),company};
    }
    const epoch=adminSessionEpoch,actor=currentUser.id,org=currentUser.app_metadata.organization_id;
    const response=await adminFetch(SUPABASE_URL+'/rest/v1/rpc/admin_create_work_order_from_draft',{
      method:'POST',headers:authHeaders(true),body:JSON.stringify({p_revision:creationAttempt.revision})});
    if(!accessToken||epoch!==adminSessionEpoch||currentUser?.id!==actor||currentUser?.app_metadata?.organization_id!==org)
      throw Error('Creator account changed.');
    if(!response.ok)throw Error(await readableError(response,'Creation was not confirmed. Retry the same entry to check the exact result.'));
    const result=await response.json();
    if(!Array.isArray(result)||result.length!==1||result[0].client_company_id!==creationAttempt.company)
      throw Error('Created client assignment was not confirmed. Check Work Orders before retrying.');
    return result;
  }
  function created(){reset();}
  function refreshed(){return ensure();}
  function init(){editor.init();
    el('create-company-refresh').addEventListener('click',()=>loadCompanies());
    el('create-company').addEventListener('change',()=>{companySelection=el('create-company').value;createPhotos.setCompany(companySelection||null);});
    el('create-wo-details').addEventListener('toggle',()=>{if(el('create-wo-details').open)ensure();});
    for(const button of document.querySelectorAll('[data-fwh-go="create"]'))button.addEventListener('click',()=>ensure());
    el('create-draft-save-continue').addEventListener('click',async()=>{if(await editor.save())finish();});
    el('create-draft-stay').addEventListener('click',()=>{pending=null;el('create-draft-unsaved').hidden=true;});
    el('create-draft-discard-local').addEventListener('click',()=>{if(!editor.resume(true))clearForm();finish();});
    window.addEventListener('beforeunload',event=>{if(editor.dirty()){event.preventDefault();event.returnValue='';}});
  }
  return {init,ensure,reset,guard,submit,created,refreshed,isSaved:editor.isSaved,dirty:editor.dirty,busy:editor.busy};
})();

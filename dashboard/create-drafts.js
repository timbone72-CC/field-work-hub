/* One server-backed Create & Assign draft; the existing create RPC owns dispatch. */
const CreateJobDrafts=(()=>{
  const el=id=>document.getElementById(id);
  let provenance=null,provenanceRequirements='',pending=null,creationAttempt=null;
  const resetProvenance=()=>{provenance=null;provenanceRequirements='';};
  const editor=JobDraftEditor({prefix:'create-draft-',isNew:true,editor:()=>createPhotos,form:()=>createForm,
    fields:{woNumber:'wo-number',propertyAddress:'property-address',workType:'work-type',
      instructions:'instructions',dueDate:'due-date',assignedUserId:'assignee'},matches:()=>true,
    extra:()=>({numberMode:currentWoNumberMode(),rememberNumberMode:rememberWoNumberMode.checked,
      sourceTemplateId:createPhotos.selectedId||(JSON.stringify(createPhotos.value)===provenanceRequirements?provenance:null)}),
    restored:p=>{applyWoNumberMode(p.numberMode);rememberWoNumberMode.checked=p.rememberNumberMode;
      provenance=p.sourceTemplateId;provenanceRequirements=JSON.stringify(createPhotos.value);fillWorkTypes();},
    hasContent:()=>!!(woNumberInput.value.trim()||propertyAddressInput.value.trim()||workTypeInput.value.trim()
      ||instructionsInput.value.trim()||dueDateInput.value||assigneeSelect.value
      ||createPhotos.value.items.length||createPhotos.value.total.enabled)});
  function ensure(){if(!accessToken||currentUser?.app_metadata?.role!=='ADMIN')return;
    if(!editor.active()){resetProvenance();return editor.open({id:null,updated_at:null});}}
  function reset(){creationAttempt=null;editor.reset();resetProvenance();pending=null;const node=el('create-draft-unsaved');if(node)node.hidden=true;}
  function clearForm(){createForm.reset();createPhotos.load(null);fillWorkTypes();restoreWoNumberModePreference();
    fillAssigneeSelect(assigneeSelect,assignableUsers,'Choose Team user');resetProvenance();}
  function guard(action){if(!editor.active()){action();return;}
    if(editor.busy())return;
    if(!editor.dirty()){action();return;}
    pending=action;el('create-draft-unsaved').hidden=false;el('create-draft-stay').focus();}
  function finish(){const action=pending;pending=null;el('create-draft-unsaved').hidden=true;if(action)action();}
  async function submit(){
    await ensure();
    if(!editor.active())throw Error('Current creator session required.');
    if(creationAttempt&&creationAttempt.fingerprint!==editor.fingerprint())
      throw Error('Earlier creation is unconfirmed. Check Work Orders, keep new input with Save draft, then reload before creating different work. Your input is retained.');
    if(!creationAttempt){
      if(!editor.isSaved()&&!await editor.save())throw Error('Save draft was not confirmed. Nothing was created.');
      creationAttempt={revision:editor.revision(),fingerprint:editor.fingerprint()};
    }
    const epoch=adminSessionEpoch,actor=currentUser.id,org=currentUser.app_metadata.organization_id;
    const response=await adminFetch(SUPABASE_URL+'/rest/v1/rpc/admin_create_work_order_from_draft',{
      method:'POST',headers:authHeaders(true),body:JSON.stringify({p_revision:creationAttempt.revision})});
    if(!accessToken||epoch!==adminSessionEpoch||currentUser?.id!==actor||currentUser?.app_metadata?.organization_id!==org)
      throw Error('Creator account changed.');
    if(!response.ok)throw Error(await readableError(response,'Creation was not confirmed. Retry the same entry to check the exact result.'));
    return response.json();
  }
  function created(){reset();}
  function refreshed(){return ensure();}
  function init(){editor.init();
    el('create-wo-details').addEventListener('toggle',()=>{if(el('create-wo-details').open)ensure();});
    for(const button of document.querySelectorAll('[data-fwh-go="create"]'))button.addEventListener('click',()=>ensure());
    el('create-draft-save-continue').addEventListener('click',async()=>{if(await editor.save())finish();});
    el('create-draft-stay').addEventListener('click',()=>{pending=null;el('create-draft-unsaved').hidden=true;});
    el('create-draft-discard-local').addEventListener('click',()=>{if(!editor.resume(true))clearForm();finish();});
    window.addEventListener('beforeunload',event=>{if(editor.dirty()){event.preventDefault();event.returnValue='';}});
  }
  return {init,ensure,reset,guard,submit,created,refreshed,isSaved:editor.isSaved,dirty:editor.dirty,busy:editor.busy};
})();

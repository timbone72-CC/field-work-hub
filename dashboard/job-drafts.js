/* Ordinary existing-job drafts. Work-order application remains Save Changes. */
const JobDrafts=(()=>{
  let generation=0,row=null,identity=null,draft=null,loaded=false,busy=false,savedValue=null,attempt=null;
  const el=id=>document.getElementById(id);
  const fields={woNumber:'edit-wo-number',propertyAddress:'edit-property-address',workType:'edit-work-type',
    instructions:'edit-instructions',dueDate:'edit-due-date',assignedUserId:'edit-assignee'};
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function payload(){return {...Object.fromEntries(Object.entries(fields).map(([key,id])=>[key,el(id).value])),
    requirements:structuredClone(editPhotos.value),expectedRevision:editPhotos.expectedRevision||null};}
  function value(p=payload()) {
    const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'
      ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
    return JSON.stringify(canonical(p));
  }
  function owner(){return {actor:currentUser?.id,org:currentUser?.app_metadata?.organization_id,epoch:adminSessionEpoch};}
  function current(g){const now=owner();return g===generation&&!!accessToken&&!!row&&identity?.actor===now.actor
    &&identity.org===now.org&&identity.epoch===now.epoch&&editWorkOrderIdInput.value===row.id;}
  function status(message,bad=false){const node=el('job-draft-status');if(node){node.textContent=message;node.classList.toggle('error',bad);}}
  function buttons(){if(!el('job-draft-save'))return;
    el('job-draft-save').disabled=busy||!loaded||!row;
    el('job-draft-check').disabled=busy||!row;
    el('job-draft-resume').hidden=!draft;el('job-draft-resume').disabled=busy||!loaded;
    el('job-draft-discard').hidden=!draft;el('job-draft-discard').disabled=busy||!loaded;
  }
  function reset(){generation++;row=null;identity=null;draft=null;loaded=false;busy=false;savedValue=null;attempt=null;status('');buttons();}
  async function rpc(name,data){const response=await adminFetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{
    method:'POST',headers:authHeaders(true),body:JSON.stringify(data)});
    if(!response.ok)throw Error(await readableError(response,'Draft request failed; edits retained.'));
    return response.json();}
  function verified(result){if(result?.work_order_id!==row.id||result.organization_id!==identity.org
    ||result.owner_user_id!==identity.actor || (result.draft&&(!uuid.test(result.draft.id)
      ||!uuid.test(result.draft.revision)||!result.draft.payload||typeof result.draft.stale!=='boolean')))
      throw Error('Unexpected saved draft response; edits retained.');
    return result.draft;}
  function isSaved(){return !!row&&loaded&&savedValue!==null&&value()===savedValue;}
  function resume(force=false){if(!draft||busy)return false;
    if(!force&&!window.confirm('Replace the editor contents with your saved draft?'))return false;
    const p=draft.payload;
    PhotoRules.validate(p.requirements);
    for(const [key,id] of Object.entries(fields)){
      if(typeof p[key]!=='string')throw Error('Saved draft fields unavailable; current edits retained.');
    }
    // Set the same raw requirements the editor saved; requirements remain a
    // draft and are validated by the existing active-work owner on application.
    for(const [key,id] of Object.entries(fields))el(id).value=p[key];
    editPhotos.load(p.requirements,row.field_status!=='ASSIGNED');
    editPhotos.expectedRevision=p.expectedRevision;
    savedValue=value();
    if(draft.stale){JobWorkspace.saveUnverified();status('Saved draft restored. Job changed since this draft; reload the job before applying changes. Draft remains saved.',true);}
    else status('Saved draft restored. Save Changes applies it to the work order.');
    return true;
  }
  async function check(restore=false){if(!row||busy)return false;
    const g=generation,starting=value();busy=true;buttons();status('Checking saved draft…');
    try{const result=await rpc('admin_job_draft_state',{p_wo:row.id});if(!current(g))return false;
      draft=verified(result);loaded=true;
      if(draft&&value(draft.payload)===value()){savedValue=value();attempt=null;}
      status(draft?'Saved draft available. Resume it, or keep editing.':'No saved draft. Changes here are unsaved until Save draft or Save Changes.');
      if(restore&&draft&&value()===starting&&!draft.stale){busy=false;resume(true);}
      else if(draft?.stale)status('Saved draft uses an older job revision. Current job kept. Resume to inspect the draft, or discard the saved draft.',true);
      return true;
    }catch(error){if(current(g)){loaded=false;status(error.message,true);}return false;}
    finally{if(current(g)){busy=false;buttons();}}
  }
  function open(source){reset();row=structuredClone(source);identity=owner();buttons();return check(true);}
  async function save(){if(!row||busy||!loaded)return false;
    const g=generation,p=payload(),fingerprint=value(p);
    try{PhotoRules.validate(p.requirements);}catch(error){status(error.message,true);return false;}
    if(!attempt||attempt.fingerprint!==fingerprint)attempt={fingerprint,id:crypto.randomUUID()};
    const request={p_wo:row.id,p_payload:p,p_expected_revision:draft?.revision||null,
      p_base_updated_at:row.updated_at,p_write_id:attempt.id};
    busy=true;buttons();status('Saving draft…');
    try{const result=await rpc('admin_save_job_draft',request);if(!current(g))return false;
      const saved=verified(result);if(!saved||saved.write_id!==request.p_write_id
        ||value(saved.payload)!==fingerprint)throw Error('Draft save was not confirmed; edits retained.');
      draft=saved;savedValue=fingerprint;attempt=null;
      status(value()===fingerprint?'Draft saved on server. Work order unchanged.':'Earlier draft saved. Newer edits are still unsaved.');
      return isSaved();
    }catch(error){if(current(g))status('Draft save not confirmed. Your edits are still here. Check saved draft or retry the unchanged draft. '+error.message,true);return false;}
    finally{if(current(g)){busy=false;buttons();}}
  }
  async function discard(confirm=true){if(!row||busy||!draft)return false;
    if(confirm&&!window.confirm('Discard your saved draft? This does not change the work order or delete photos.'))return false;
    const g=generation;busy=true;buttons();
    try{const result=await rpc('admin_discard_job_draft',{p_wo:row.id,p_expected_revision:draft.revision});
      if(!current(g))return false;if(verified(result)!==null)throw Error('Draft discard not confirmed.');
      draft=null;savedValue=null;attempt=null;status('Saved draft discarded. Current editor contents were kept.');return true;
    }catch(error){if(current(g))status(error.message,true);return false;}
    finally{if(current(g)){busy=false;buttons();}}
  }
  async function applied(){if(draft)return discard(false);return true;}
  function init(){el('job-draft-save').addEventListener('click',()=>save());
    el('job-draft-check').addEventListener('click',()=>check());
    el('job-draft-resume').addEventListener('click',()=>resume());
    el('job-draft-discard').addEventListener('click',()=>discard());
    for(const type of ['input','change'])editForm.addEventListener(type,()=>{
      if(row&&!busy&&!isSaved())status('Unsaved draft changes. Save draft to keep them without applying the work order.');});
  }
  return {init,open,reset,save,check,resume,discard,applied,isSaved,busy:()=>busy};
})();

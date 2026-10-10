/* Phase 5 office controls share the selected job. The server owns all release
 * authority, revisions, manifest content, worker permissions and idempotency. */
const ClientRelease = (() => {
  let wo = '', seq = 0, config = null, pkg = null, chosen = new Set(), photoFacts = [];
  let savedNotes = '', busy = false, loaded = false, previewedHash = null, tooMany = false;
  const el = id => document.getElementById(id);
  const status = (id, message) => { el(id).textContent = message; };
  const valid = (n, id, token) => n === seq && wo === id && token && token === accessToken
    && editWorkOrderIdInput.value === id;
  const rpc = async (method, data, token) => {
    const result = await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/${method}`, {
      method:'POST', headers:{ apikey:SUPABASE_PUBLISHABLE_KEY, Authorization:`Bearer ${token}`,
        'Content-Type':'application/json' }, body:JSON.stringify(data)
    });
    if (!result.ok) throw new Error(await readableError(result,'Office operation unavailable; no delivery confirmed.'));
    return result.json();
  };
  function reset() {
    seq++; wo=''; config=null; pkg=null; chosen.clear(); photoFacts=[];
    busy=false; loaded=false; savedNotes=''; previewedHash=null; tooMany=false;
    el('release-exact-preview').hidden=true; el('release-exact-preview').textContent='';
    for(const id of ['release-status','review-policy-status','release-coverage','release-target']) {
      const node=el(id);if(node)node.textContent='';
    }
    el('review-policy-reason').value=''; el('review-policy-reason').disabled=true;
    el('release-notes').value=''; el('release-notes').disabled=true;
    el('release-company').replaceChildren(new Option('Not assigned',''));
    el('release-company').disabled=true; el('release-photo-list').replaceChildren();
    el('release-send').disabled=true;
    el('release-approve').disabled=true;
    el('release-preview').disabled=true;
    el('release-save').disabled=true;
  }
  function dirty() { return wo && (el('release-notes').value!==savedNotes
    || (pkg && JSON.stringify([...chosen])!==JSON.stringify(pkg.photos.map(x=>x.photo_id)))); }
  function setBusy(yes) { busy=yes; buttons(); }
  function buttons() {
    const assigned=!!config?.client_company_id, frozen=pkg && !['DRAFT'].includes(pkg.status);
    el('review-required').disabled=!loaded||busy;
    el('review-policy-reason').disabled=!loaded||busy;
    el('review-policy-save').disabled=!loaded||busy||!el('review-policy-reason').value.trim()
      ||config?.review_required===el('review-required').checked;
    el('release-company').disabled=!loaded||busy||assigned;
    el('release-assign-company').disabled=!loaded||busy||assigned||!el('release-company').value;
    el('release-new-company').disabled=!loaded||busy||assigned;
    el('release-notes').disabled=!loaded||busy||!!frozen;
    el('release-save').disabled=!loaded||busy||!assigned||!!frozen||tooMany;
    el('release-preview').disabled=!loaded||busy||!pkg||pkg.status!=='DRAFT'||dirty();
    el('release-approve').disabled=!loaded||busy||!pkg||pkg.status!=='DRAFT'||!pkg.ready_to_approve||dirty()
      || !previewedHash || previewedHash!==pkg.manifest_sha256;
    // Backend returns can_send only for the exact currently approved manifest.
    el('release-send').disabled=!loaded||busy||!pkg||pkg.status!=='APPROVED'||pkg.can_send!==true||dirty();
  }
  async function load(id, tab='delivery') {
    if (!id || !accessToken) return;
    if (wo!==id) reset();
    previewedHash=null; el('release-exact-preview').hidden=true;
    wo=id; const n=++seq, token=accessToken;
    loaded=false; buttons();
    status('release-status','Loading current client and package state…');
    try {
      const choice=await rpc('admin_client_choices',{p_wo:id},token);
      if(!valid(n,id,token))return;
      if(choice.work_order_id!==id || !Array.isArray(choice.companies)) throw Error('Client scope mismatch');
      config=choice;
      const options=el('release-company');options.replaceChildren(new Option('Choose company',''));
      for(const company of choice.companies)options.add(new Option(company.name,company.id));
      options.value=choice.client_company_id||'';
      el('review-required').checked=choice.review_required===true;
      const response=await rpc('admin_package_state',{p_wo:id},token);
      if(!valid(n,id,token))return;
      if(response.work_order_id!==id||!Array.isArray(response.available_photos)) throw Error('Package scope mismatch');
      pkg=response.package||null;photoFacts=response.available_photos;tooMany=response.too_many_photos===true;
      chosen=new Set(pkg?.photos?.map(p=>p.photo_id)||[]);
      savedNotes=pkg?.notes||'';el('release-notes').value=savedNotes;
      renderPhotos();
      el('release-target').textContent=response.destination?.verified===true
        ? `Destination verified for ${response.destination.company_name} (company private configuration)`
        : 'No verified active destination. Package approval and Send remain blocked.';
      el('release-coverage').textContent=(tooMany?'More than 200 photos: selection is blocked until paging is available. ':'')
        +(response.coverage_message||'Select only privately received photos.');
      status('release-status',pkg ? `Package ${pkg.status}; explicit Send is separate.`
        : 'No package saved. Choose your photos and save a draft.');
      loaded=true;buttons();
    }catch(error){if(valid(n,id,token)){status('release-status',error.message);loaded=false;buttons();}}
  }
  function renderPhotos() {
    const list=el('release-photo-list');list.replaceChildren();
    if(photoFacts.length===0) {list.textContent='No privately verified photos are available for this package.';return;}
    for(const p of photoFacts){
      const label=document.createElement('label');label.className='check';
      const cb=document.createElement('input');cb.type='checkbox';cb.checked=chosen.has(p.photo_id);
      cb.disabled=busy||(pkg&&pkg.status!=='DRAFT');
      cb.addEventListener('change',()=>{if(cb.checked)chosen.add(p.photo_id);else chosen.delete(p.photo_id);buttons();});
      const text=document.createElement('span');
      text.textContent=`Photo ${p.photo_id.slice(0,8)} · ${p.decision} · ${p.requirement_label||'Extra'}`;
      label.append(cb,text);list.append(label);
    }
  }
  async function transact(kind, data, reload=true) {
    if(busy||!wo||!accessToken)return;
    const id=wo,n=seq,token=accessToken;setBusy(true);
    status('release-status','Checking current permissions and revisions…');
    try {
      const result=await rpc(kind,data,token);
      if(!valid(n,id,token))return;
      status('release-status',kind==='admin_queue_package'
        ? 'Send request queued. Delivery is NOT confirmed until the provider receipt is verified.'
        : 'Saved. Refreshing the exact server revision.');
      if(reload)await load(id);
      return result;
    }catch(error){if(valid(n,id,token))status('release-status',error.message+' Reload current job before retrying.');}
    finally{if(wo===id && token===accessToken)setBusy(false);}
  }
  function init(){
    el('review-policy-reason').addEventListener('input',buttons);
    el('review-required').addEventListener('change',buttons);
    el('review-policy-save').addEventListener('click',async()=>{
      if(!config||!el('review-policy-reason').value.trim())return;
      await transact('admin_set_review_required',{p_action:crypto.randomUUID(),p_work_order:wo,
        p_expected_revision:config.revision,p_required:el('review-required').checked,
        p_reason:el('review-policy-reason').value.trim()});
      el('review-policy-reason').value='';
    });
    el('release-new-company').addEventListener('click',async()=>{
      if(busy||config?.client_company_id)return;
      const name=prompt('Client company name (do not enter a folder ID):');
      if(!name||!name.trim())return;
      await transact('admin_create_client_company',{p_wo:wo,p_name:name.trim()});
    });
    el('release-company').addEventListener('change',buttons);
    el('release-assign-company').addEventListener('click',()=>transact('admin_assign_client_company',
      {p_action:crypto.randomUUID(),p_work_order:wo,p_company:el('release-company').value,
        p_expected_policy_revision:config?.revision}));
    el('release-notes').addEventListener('input',buttons);
    el('release-save').addEventListener('click',()=>transact('admin_save_package_draft',
      {p_action:crypto.randomUUID(),p_wo:wo,p_expected_revision:pkg?.revision||null,
        p_notes:el('release-notes').value,
        p_photo_ids:photoFacts.filter(p=>chosen.has(p.photo_id)).map(p=>p.photo_id)}));
    el('release-preview').addEventListener('click',async()=>{
      if (busy||!wo||!pkg||dirty())return;
      const id=wo,token=accessToken,n=seq;setBusy(true);
      try {
        const exact=await rpc('admin_preview_package',{p_wo:id,p_package:pkg.id,
          p_expected_revision:pkg.revision},token);
        if(!valid(n,id,token))return;
        if(exact.package_id!==pkg.id||exact.revision!==pkg.revision
          ||exact.manifest_sha256!==pkg.manifest_sha256||!exact.manifest)
          throw new Error('Manifest changed; reload before approval.');
        previewedHash=exact.manifest_sha256;
        const m=exact.manifest;
        el('release-exact-preview').textContent=JSON.stringify({
          company_id:m.client_company_id,client_wo_number:m.client_wo_number,
          notes:m.client_notes,destination_root:m.destination_root,
          destination_provider:m.destination_provider,
          review_required:m.review_required,requirements:m.requirements,
          selected_photos:m.selected_photos,manifest_sha256:exact.manifest_sha256
        },null,2);
        el('release-exact-preview').hidden=false;
        status('release-status','Review this exact manifest. Approval does NOT send it.');
      }catch(error){if(valid(n,id,token)){previewedHash=null;status('release-status',error.message);}}
      finally{if(wo===id&&token===accessToken)setBusy(false);}
    });
    el('release-approve').addEventListener('click',()=>transact('admin_approve_package',
      {p_action:crypto.randomUUID(),p_wo:wo,p_package:pkg?.id,
        p_expected_revision:pkg?.revision,p_manifest_sha256:pkg?.manifest_sha256}));
    el('release-send').addEventListener('click',()=>{
      if(pkg?.can_send!==true||dirty()||!confirm('Queue this exact approved package for client delivery?'))return;
      transact('admin_queue_package',{p_action:crypto.randomUUID(),p_wo:wo,p_package:pkg?.id,
        p_expected_revision:pkg?.revision,p_manifest_sha256:pkg?.manifest_sha256});
    });
  }
  return {init,open:load,reset,dirty};
})();

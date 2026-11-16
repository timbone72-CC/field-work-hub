/* Phase 5 office controls share the selected job. The server owns all release
 * authority, revisions, manifest content, worker permissions and idempotency. */
const ClientRelease = (() => {
  let wo = '', seq = 0, config = null, pkg = null, chosen = new Set(), photoFacts = [];
  let savedNotes = '', savedPhotoIds = [], busy = false, loaded = false, previewedHash = null, tooMany = false;
  let paged=false, photoCursor=null, paging=false;
  const el = id => document.getElementById(id);
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    ClientFolderLayout.reset();
    busy=false; loaded=false; savedNotes=''; savedPhotoIds=[]; previewedHash=null; tooMany=false;
    paged=false;photoCursor=null;paging=false;
    el('release-photos-more').hidden=true;el('release-photo-count').textContent='No photos selected.';
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
    el('release-approve-send').disabled=true;
    el('release-preview').disabled=true;
    el('release-save').disabled=true;
  }
  function dirty() { return wo && (el('release-notes').value!==savedNotes
    || JSON.stringify([...chosen].sort())!==JSON.stringify(savedPhotoIds.slice().sort())); }
  function setBusy(yes) {
    busy=yes; buttons();
    // The photo checkboxes are created as elements, not covered by buttons().
    // A completed save must restore their current permitted state as well.
    if (loaded) renderPhotos();
  }
  function packageSummary(manifest) {
    const company=config?.companies?.find(c=>c.id===manifest.client_company_id);
    const goals=manifest.requirements?.items||[];
    const requirements=goals.filter(item=>item.enabled)
      .map(item=>item.label+': at least '+item.minimum);
    const photos=(manifest.selected_photos||[]).map((photo,index)=>{
      const facts=photoFacts.find(item=>item.photo_id===photo.photo_id);
      const goal=goals.find(item=>item.id===photo.release_item_id);
      const decision=photo.review_decision||facts?.decision;
      const review=decision==='APPROVED'?'Approved':decision==='PENDING'?'Review optional':'';
      return (index+1)+'. '+(goal?.label||'Extra photo')
        +(facts?.run_sequence?' · Visit '+facts.run_sequence:'')+(review?' · '+review:'');
    });
    const total=manifest.requirements?.total;
    return ['Work order: '+manifest.client_wo_number,
      'Client: '+(company?.name||'Configured client'),
      'Delivery: '+(manifest.destination_provider==='GOOGLE_DRIVE'?'Google Drive':'Configured storage')
        +' — verified client destination',
      '', 'Photos included: '+photos.length,...photos,
      '', 'Required photos: '+(requirements.length?requirements.join('; '):'None'),
      total?.enabled?'Minimum total photos: '+total.minimum:'No additional total-photo minimum.',
      'Required photo checks: Passed',
      ...(manifest.correction_obligations?.length?['Follow-up photo requirements: Passed']:[]),
      '', 'Client notes: '+(manifest.client_notes||'None'),
      '', 'Approve for later saves approval without sending. Approve & send now requests delivery.'
    ].join('\n');
  }
  function canApprove() {
    return loaded&&!busy&&pkg?.status==='DRAFT'&&pkg.ready_to_approve===true&&!dirty()
      &&!!previewedHash&&previewedHash===pkg.manifest_sha256;
  }
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
    el('release-approve').disabled=!canApprove();
    el('release-approve-send').disabled=!canApprove();
    // Backend returns can_send only for the exact currently approved manifest.
    el('release-send').disabled=!loaded||busy||!pkg||pkg.status!=='APPROVED'||pkg.can_send!==true||dirty();
    el('release-photos-more').disabled=!loaded||busy||paging||!photoCursor;
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
      ClientFolderLayout.bindProposal(choice,token);
      status('review-policy-status',choice.review_required ? 'Individual photo review is required.' : 'Individual photo review is optional; package approval and Send are still required.');
      const options=el('release-company');options.replaceChildren(new Option('Choose company',''));
      for(const company of choice.companies)options.add(new Option(company.name,company.id));
      options.value=choice.client_company_id||'';
      el('review-required').checked=choice.review_required===true;
      const response=await rpc('admin_package_state',{p_wo:id},token);
      if(!valid(n,id,token))return;
      if(response.work_order_id!==id||!Array.isArray(response.available_photos)) throw Error('Package scope mismatch');
      pkg=response.package||null;photoFacts=response.available_photos;tooMany=response.too_many_photos===true;
      paged=response.paged_selection===true;photoCursor=null;
      chosen=new Set(pkg?.photos?.map(p=>p.photo_id)||[]);savedPhotoIds=[...chosen];
      if(paged){
        const page=await rpc('admin_package_photo_page',{
          p_wo:id,p_limit:25,p_after_sequence:null,p_after_photo:null},token);
        if(!valid(n,id,token))return;
        if(page.work_order_id!==id||!Array.isArray(page.photos)||page.photos.length>25
           ||page.photos.some(p=>!UUID.test(p.photo_id)||!UUID.test(p.run_id)
             ||!Number.isInteger(p.run_sequence)))
          throw Error('Invalid bounded package photo page.');
        photoFacts=page.photos;
        photoCursor=page.next_photo&&Number.isInteger(page.next_sequence)
          ?{photo:page.next_photo,sequence:page.next_sequence}:null;
      }
      el('release-photos-more').hidden=!photoCursor;
      savedNotes=pkg?.notes||'';el('release-notes').value=savedNotes;
      renderPhotos();
      el('release-target').textContent=response.destination?.verified===true
        ? `Destination verified for ${response.destination.company_name} (company private configuration)`
        : 'No verified active destination. Package approval and Send remain blocked.';
      el('release-coverage').textContent=(tooMany?'Photo selection is unavailable until paging is verified. ':'')
        +(response.coverage_message||'Select eligible verified photos from original and corrective visits; all selected photos must pass exact package coverage.');
      status('release-status',pkg?.status==='APPROVED' && pkg.send_blocked_reason
        ? `Package APPROVED. ${pkg.send_blocked_reason}`
        : pkg?.status==='DRAFT' ? 'Package DRAFT. Preview it, then approve for later or approve and send now.'
        : pkg?.status==='APPROVED' ? 'Package APPROVED. Saved for later; delivery has not been requested.'
        : pkg?.status==='DELIVERED' ? 'Package DELIVERED. Client delivery receipt confirmed.'
        : pkg ? `Package ${pkg.status}. Delivery is not confirmed until a verified receipt is recorded.`
        : 'No package saved. Choose your photos and save a draft.');
      loaded=true;buttons();
    }catch(error){if(valid(n,id,token)){status('release-status',error.message);status('review-policy-status',error.message);loaded=false;buttons();}}
  }
  function renderPhotos() {
    const list=el('release-photo-list');list.replaceChildren();
    el('release-photo-count').textContent=chosen.size+' photos selected for client package'+
      (paged?' · '+photoFacts.length+' verified photos loaded in bounded pages':'')+
      (savedPhotoIds.length?' · '+savedPhotoIds.length+' previously saved':'');
    if(photoFacts.length===0) {list.textContent='No privately verified photos are available for this package.';return;}
    for(const p of photoFacts){
      const label=document.createElement('label');label.className='check';
      const cb=document.createElement('input');cb.type='checkbox';cb.checked=chosen.has(p.photo_id);
      cb.disabled=busy||(pkg&&pkg.status!=='DRAFT');
      cb.addEventListener('change',()=>{
        if(cb.checked)chosen.add(p.photo_id);else chosen.delete(p.photo_id);
        el('release-photo-count').textContent=chosen.size+' photos selected for client package'+
          ' · '+photoFacts.length+' verified photos currently loaded.';
        buttons();
      });
      const text=document.createElement('span');
      text.textContent='Run '+(p.run_sequence||'current')+' · Photo '+p.photo_id.slice(0,8)+
        ' · '+p.decision+' · '+(p.release_item_id?
          'Release goal '+p.release_item_id.slice(0,8):'Extra')+
        (p.run_sequence>1?' (corrective visit)':'');
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
    }catch(error){if(valid(n,id,token)){status('release-status',error.message+' Reload current job before retrying.');
      if(kind==='admin_set_review_required')status('review-policy-status',error.message+' No policy change was confirmed.');}}
    finally{if(wo===id && token===accessToken)setBusy(false);}
  }
  async function saveDraft() {
    if(!loaded||busy||tooMany||!config?.client_company_id||pkg&&pkg.status!=='DRAFT')return false;
    const result=await transact('admin_save_package_draft',
      {p_action:crypto.randomUUID(),p_wo:wo,p_expected_revision:pkg?.revision||null,
        p_notes:el('release-notes').value,
        p_photo_ids:[...chosen]});
    return !!result;
  }
  async function approveAndSend(){
    if(!canApprove())return;
    const id=wo,n=seq,token=accessToken,packageId=pkg.id;
    const revision=pkg.revision,hash=previewedHash;
    if(!confirm('Approve this exact reviewed package and queue it for client delivery now?'))return;
    if(!valid(n,id,token)||!canApprove()||pkg.id!==packageId||pkg.revision!==revision)return;
    setBusy(true);
    let approved=false;
    try {
      status('release-status','Approving the reviewed package…');
      const result=await rpc('admin_approve_package',{p_action:crypto.randomUUID(),
        p_wo:id,p_package:packageId,p_expected_revision:revision,p_manifest_sha256:hash},token);
      if(!valid(n,id,token))return;
      if(result.package_id!==packageId||result.status!=='APPROVED'
          ||!UUID.test(result.revision)||result.manifest_sha256!==hash)
        throw Error('Approval result could not be confirmed.');
      approved=true;
      const checked=await rpc('admin_package_state',{p_wo:id},token);
      if(!valid(n,id,token))return;
      const current=checked.package;
      if(checked.work_order_id!==id||current?.id!==packageId
          ||current.status!=='APPROVED'||current.revision!==result.revision
          ||current.manifest_sha256!==hash)
        throw Error('The approved package changed before Send.');
      if(current.can_send!==true)
        throw Error(current.send_blocked_reason||'Client delivery is currently unavailable.');
      status('release-status','Approval saved. Requesting delivery…');
      const queued=await rpc('admin_queue_package',{p_action:crypto.randomUUID(),
        p_wo:id,p_package:packageId,p_expected_revision:result.revision,
        p_manifest_sha256:hash},token);
      if(!valid(n,id,token))return;
      if(queued.package_id!==packageId||queued.status!=='QUEUED'
          ||!UUID.test(queued.revision)||queued.manifest_sha256!==hash)
        throw Error('Send result could not be confirmed.');
      await load(id);
    }catch(error){
      if(valid(n,id,token)){
        loaded=false;
        status('release-status',(approved?'Approval saved; delivery not confirmed. '
          :'Approve and send not confirmed. ')+error.message
          +' Reload the current job to check its saved state before trying again.');
      }
    }finally{if(wo===id&&token===accessToken)setBusy(false);}
  }
  async function loadNextPhotos(){
    if(!paged||!photoCursor||paging||busy||!loaded||!wo||!accessToken)return;
    const n=seq,id=wo,token=accessToken,cursor=photoCursor;
    paging=true;buttons();
    try{
      const page=await rpc('admin_package_photo_page',{
        p_wo:id,p_limit:25,p_after_sequence:cursor.sequence,
        p_after_photo:cursor.photo},token);
      if(!valid(n,id,token))return;
      if(page.work_order_id!==id||!Array.isArray(page.photos)||page.photos.length>25
        ||page.photos.some(p=>!UUID.test(p.photo_id)||!UUID.test(p.run_id)
             ||!Number.isInteger(p.run_sequence))
        ||page.photos.some(p=>photoFacts.some(prev=>prev.photo_id===p.photo_id)))
        throw Error('Paged selection changed; reload job.');
      photoFacts=[...photoFacts,...page.photos];
      photoCursor=page.next_photo&&Number.isInteger(page.next_sequence)
        ?{photo:page.next_photo,sequence:page.next_sequence}:null;
      el('release-photos-more').hidden=!photoCursor;renderPhotos();
    }catch(err){if(valid(n,id,token)){
      photoCursor=null;el('release-photos-more').hidden=true;
      status('release-status','Photo paging changed. Reload before saving: '+err.message);
      tooMany=true;
    }}finally{if(valid(n,id,token)){paging=false;buttons();}}
  }
  function init(){
    el('release-photos-more').addEventListener('click',loadNextPhotos);
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
    el('release-save').addEventListener('click',()=>saveDraft());
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
        el('release-exact-preview').textContent=packageSummary(m);
        el('release-exact-preview').hidden=false;
        status('release-status','Review this package summary, then choose approve for later or approve and send now.');
      }catch(error){if(valid(n,id,token)){previewedHash=null;status('release-status',error.message);}}
      finally{if(wo===id&&token===accessToken)setBusy(false);}
    });
    el('release-approve').addEventListener('click',()=>transact('admin_approve_package',
      {p_action:crypto.randomUUID(),p_wo:wo,p_package:pkg?.id,
        p_expected_revision:pkg?.revision,p_manifest_sha256:pkg?.manifest_sha256}));
    el('release-approve-send').addEventListener('click',approveAndSend);
    el('release-send').addEventListener('click',()=>{
      if(pkg?.can_send!==true||dirty()||!confirm('Queue this exact approved package for client delivery?'))return;
      transact('admin_queue_package',{p_action:crypto.randomUUID(),p_wo:wo,p_package:pkg?.id,
        p_expected_revision:pkg?.revision,p_manifest_sha256:pkg?.manifest_sha256});
    });
  }
  return {init,open:load,reset,dirty,saveDraft};
})();

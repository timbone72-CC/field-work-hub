/* Phase 6F Supervisor presentation only: reuse existing private review/page/preview/action owners.
 * Server checks current Auth + exact team/work scope on every request. No Send path. */
const SupervisorPhotoReview = (() => {
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let generation=0, selected='', cursor=null, rows=[], inspected=new Map();
  let pending=null,busy=false;
  const panel=()=>document.getElementById('supervisor-photo-review');
  const status=(message,error=false)=>{
    const node=panel()?.querySelector('#supervisor-photo-status');
    if(node){node.textContent=message;node.classList.toggle('error',error)}
  };
  const current=(gen,wo,identity)=>generation===gen && selected===wo
    && staffingStillCurrent(identity) && staffingWorkDetail?.work_order_id===wo
    && staffingWork?.rows.some(row=>row.work_order_id===wo && row.team_id===staffingWorkDetail.team_id);
  const rpc=async(name,body)=>{
    const response=await adminFetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{
      method:'POST',headers:authHeaders(true),body:JSON.stringify(body)});
    return response;
  };
  function reset(){
    generation++;selected='';cursor=null;rows=[];inspected.clear();pending=null;busy=false;
    panel()?.remove();
  }
  function mount(section){
    if(!staffingWorkDetail || panel())return;
    selected=staffingWorkDetail.work_order_id;
    const root=document.createElement('section');root.id='supervisor-photo-review';
    root.className='subsection';
    const heading=document.createElement('h4');heading.textContent='Verified private photo review';
    const note=document.createElement('p');note.className='muted';
    note.textContent='Inspect an exact verified photo before approving or rejecting it. No client Send happens here.';
    const load=document.createElement('button');load.type='button';load.className='secondary';
    load.textContent='Load private photos';load.addEventListener('click',()=>void loadPage(false));
    const info=document.createElement('p');info.id='supervisor-photo-status';info.className='muted';
    info.setAttribute('role','status');info.setAttribute('aria-live','polite');
    const list=document.createElement('div');list.id='supervisor-photo-rows';
    const more=document.createElement('button');more.type='button';more.className='secondary hidden';
    more.id='supervisor-photo-more';more.textContent='More private photos';
    more.addEventListener('click',()=>void loadPage(true));
    root.append(heading,note,load,info,list,more);
    section.append(root);
  }
  async function loadPage(append){
    const identity=staffingIdentity(),gen=generation,wo=selected;
    if(!current(gen,wo,identity)||busy||pending||(append&&!cursor))return;
    const old=append?rows:[],after=append?cursor:null;
    busy=true;status('Loading current verified private photo decisions…');
    try{
      const response=await rpc('admin_review_photo_page',{
        p_wo:wo,p_limit:25,p_after_sequence:after?.sequence||null,
        p_after_photo:after?.photo||null,p_run:null,p_item:null,p_extra:false,
        p_stage:null,p_decision:null});
      if(!current(gen,wo,identity))return;
      if(!response.ok){
        if([401,403].includes(response.status)){
          signOutButton.click();setLoginStatus('Supervisor photo review permission changed.',true);return;
        }
        throw Error(await readableError(response,'Private photos unavailable.'));
      }
      const result=await response.json();
      if(!current(gen,wo,identity))return;
      if(result?.work_order_id!==wo||!Array.isArray(result.photos)||result.photos.length>25
        ||result.photos.some(p=>!UUID.test(p.photo_id||'')||!UUID.test(p.run_id||'')
          ||!UUID.test(p.transfer_version||'')||!Number.isInteger(p.run_sequence)
          ||!['PENDING','APPROVED','REJECTED'].includes(p.decision)
          ||old.some(o=>o.photo_id===p.photo_id)))
        throw Error('Private photo page or authorized work identity changed.');
      if(Boolean(result.next_photo)!==Number.isInteger(result.next_sequence))
        throw Error('Invalid server photo cursor.');
      rows=[...old,...result.photos];
      cursor=result.next_photo?{photo:result.next_photo,sequence:result.next_sequence}:null;
      inspected.clear();render();
      status(rows.length?'Private photos are verified. Inspect each version to review it.':
        'No verified private photos have been received for this job.');
    }catch(error){
      if(current(gen,wo,identity)){rows=[];cursor=null;inspected.clear();render();status(error.message,true)}
    }finally{busy=false}
  }
  function render(){
    const p=panel();if(!p)return;
    const list=p.querySelector('#supervisor-photo-rows');list.replaceChildren();
    p.querySelector('#supervisor-photo-more').classList.toggle('hidden',!cursor);
    for(const item of rows){
      const card=document.createElement('article');card.className='private-review-photo';
      const heading=document.createElement('strong');
      heading.textContent='Photo '+item.photo_id.slice(0,8)+' · '+item.decision;
      const details=document.createElement('p');details.className='muted';
      details.textContent='Run '+item.run_sequence+' · '+(item.requirement_label||'Extra')+
        ' · '+(item.stage||'NONE');
      const media=document.createElement('div');media.className='private-review-preview';
      const controls=document.createElement('div');controls.className='workspace-navigation';
      const preview=document.createElement('button');preview.type='button';preview.className='secondary';
      preview.textContent='Inspect photo';
      const approve=document.createElement('button');approve.type='button';approve.textContent='Approve';
      const reject=document.createElement('button');reject.type='button';reject.textContent='Reject';
      approve.disabled=true;reject.disabled=true;
      const reason=document.createElement('input');reason.type='text';reason.maxLength=1000;
      reason.placeholder='Reason required for rejection';
      reason.setAttribute('aria-label','Supervisor photo rejection reason');
      const valid=(id,g,w)=>current(g,w,id)&&rows.some(p=>p.photo_id===item.photo_id
        &&p.transfer_version===item.transfer_version);
      preview.addEventListener('click',async()=>{
        const id=staffingIdentity(),g=generation,w=selected;
        if(!valid(id,g,w)||busy||pending)return;
        preview.disabled=true;approve.disabled=true;reject.disabled=true;
        inspected.delete(item.photo_id);media.replaceChildren();
        status('Checking exact private image and current photo permission…');
        try{
          const response=await adminFetch(SUPABASE_URL+'/functions/v1/admin-private-photo',{
            method:'POST',headers:authHeaders(true),body:JSON.stringify({
              photo_id:item.photo_id,transfer_version:item.transfer_version})});
          if(!valid(id,g,w))return;
          if(!response.ok)throw Error('Verified photo preview denied.');
          const signed=await response.json();
          if(!valid(id,g,w))return;
          const path='/storage/v1/object/sign/fwh-review-private/'+
            [id.org,w,item.run_id,item.photo_id+'.jpg'].map(encodeURIComponent).join('/');
          const url=new URL(signed.url);
          if(signed.photo_id!==item.photo_id||signed.transfer_version!==item.transfer_version
            ||!Number.isInteger(signed.expires_in)||signed.expires_in<1||signed.expires_in>300
            ||url.protocol!=='https:'||url.origin!==SUPABASE_URL||url.pathname!==path
            ||url.searchParams.size!==1||!url.searchParams.get('token'))
            throw Error('Untrusted private photo identity.');
          const image=document.createElement('img');image.alt='Verified private field photo';
          image.referrerPolicy='no-referrer';
          image.addEventListener('load',()=>{
            if(!valid(id,g,w))return;
            inspected.set(item.photo_id,item.transfer_version);
            approve.disabled=false;reject.disabled=false;
            status('Photo inspected. You can review only this exact private version.');
          },{once:true});
          image.addEventListener('error',()=>{
            if(valid(id,g,w))status('Could not load private photo; review blocked.',true)
          },{once:true});
          media.replaceChildren(image);image.src=url.toString();
        }catch(error){if(valid(id,g,w))status(error.message,true)}
        finally{if(valid(id,g,w))preview.disabled=false}
      });
      const review=async decision=>{
        const id=staffingIdentity(),g=generation,w=selected;
        if(!valid(id,g,w)||busy||inspected.get(item.photo_id)!==item.transfer_version)return;
        const explanation=decision==='REJECTED'?reason.value.trim():'';
        if(decision==='REJECTED'&&!explanation){status('A rejection reason is required.',true);return}
        const request={p_work_order:w,p_photo:item.photo_id,p_transfer_version:item.transfer_version,
          p_expected_revision:item.decision_revision||null,p_decision:decision,p_reason:explanation};
        if(pending&&JSON.stringify(pending.request)!==JSON.stringify(request)){
          status('Uncertain review: retry only its exact photo, decision and reason.',true);return;
        }
        pending||={action:crypto.randomUUID(),request};
        busy=true;approve.disabled=true;reject.disabled=true;
        status('Saving exact inspected private review…');
        try{
          const response=await rpc('admin_review_photo',{...request,p_action:pending.action});
          if(!valid(id,g,w))return;
          if(!response.ok){
            if([401,403,409].includes(response.status)){
              signOutButton.click();setLoginStatus('Photo review authority or version changed.',true);return;
            }
            if(response.status>=500)throw Error('Photo decision outcome uncertain.');
            const error=await readableError(response,'Photo review rejected.');
            pending=null;throw Error(error);
          }
          const saved=await response.json();
          if(!valid(id,g,w))return;
          if(saved.action_id!==pending.action||saved.photo_id!==item.photo_id
            ||saved.work_order_id!==w||saved.transfer_version!==item.transfer_version
            ||saved.decision!==decision||!UUID.test(saved.decision_revision||'')){
            signOutButton.click();setLoginStatus('Photo review receipt identity mismatch.',true);return;
          }
          pending=null;inspected.clear();busy=false;
          await loadPage(false);
          if(valid(id,g,w))status('Exact private decision saved. No client package was sent.');
        }catch(error){
          if(valid(id,g,w))status(error.message+
            (pending?' Retry the same inspected photo, decision and reason.':''),true);
        }finally{
          busy=false;
          if(valid(id,g,w)&&pending&&inspected.get(item.photo_id)===item.transfer_version){
            approve.disabled=false;reject.disabled=false;
          }
        }
      };
      approve.addEventListener('click',()=>void review('APPROVED'));
      reject.addEventListener('click',()=>void review('REJECTED'));
      controls.append(preview,approve,reject);
      card.append(heading,details,media,controls,reason);list.append(card);
    }
  }
  return {mount,reset,get blocked(){return busy||Boolean(pending)}};
})();

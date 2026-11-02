// Trusted single-worker identity preallocation only. NO Drive create, upload,
// provider Send, cleanup, extra queue or retry with replacement IDs.
// Approved hierarchy: client root -> selected frozen parents -> PACKAGE.
// Each transition is fenced by the current Supabase delivery lease and its
// frozen company/destination identity, not by a browser/phone address string.
import {DriveUncertain} from './drive-client.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9_-]{10,160}$/;
function fail(code){throw new DriveUncertain(code);}
export async function reserveProviderIdentities({
 ledger,drive,workerId,expectedEmail,expectedDriveId=null
}={}){
 if(!UUID.test(workerId??'')||!ledger||!drive||!expectedEmail
   ||typeof ledger.claim!=='function'||typeof ledger.heartbeat!=='function'
   ||typeof ledger.readParent!=='function'||typeof ledger.reserveParent!=='function'
)
   fail('TRUSTED_WORKER_NOT_CONFIGURED');
 const claim=await ledger.claim(workerId);
 if(!claim||claim.claimed===false)return {claimed:false};
 if(claim.claimed!==true||!UUID.test(claim.package_id??'')
   ||!Number.isSafeInteger(claim.generation)||claim.generation<1
   ||!HASH.test(claim.approved_sha256??'')
   ||!claim.manifest||claim.manifest.package_id!==claim.package_id
   ||claim.manifest.destination_id!==claim.destination_id
   ||claim.manifest.review_policy_revision==null
   ||!ID.test(claim.manifest.destination_root??'')
   ||!Array.isArray(claim.manifest.selected_photos)
   ||claim.manifest.selected_photos.length>200)
   fail('FROZEN_CLAIM_INVALID');
 const layout=claim.manifest.folder_layout??'ADDRESS_WORK_ORDER';
 if(!['ADDRESS_WORK_ORDER','STATE_COUNTY_CITY_ADDRESS','STATE_CITY_ADDRESS'].includes(layout))
   fail('FROZEN_FOLDER_LAYOUT_UNSUPPORTED');
 const geographic=layout!=='ADDRESS_WORK_ORDER';
 if(geographic && (!claim.manifest.geographic_path
   ||typeof ledger.readGeographicLeaf!=='function'
   ||typeof ledger.reserveGeographicLeaf!=='function'))
   fail('FROZEN_GEOGRAPHIC_PATH_UNAVAILABLE');
 const photos=claim.manifest.selected_photos;
 const ids=new Set();
 for(const p of photos){
   if(!UUID.test(p.photo_id??'')||!HASH.test(p.observed_sha256??'')
     ||!Number.isSafeInteger(p.observed_size)||p.observed_size<=0
     ||ids.has(p.photo_id))fail('FROZEN_PHOTO_INVALID');
   ids.add(p.photo_id);
 }
 // Never generate a remote ID until both the OAuth account and exact
 // client-designated destination root have been independently verified.
 const verified=await drive.verifyProviderIdentity(expectedEmail);
 if(verified.account.toLowerCase()!==expectedEmail.toLowerCase())
   fail('WORKSPACE_ACCOUNT_MISMATCH');
 const destination=await drive.verifyDestination({
   folderId:claim.manifest.destination_root,expectedDriveId
 });
 if(destination.id!==claim.manifest.destination_root)
   fail('DESTINATION_NOT_VERIFIED');
 const pkg=claim.package_id,gen=claim.generation;
 const heartbeat=()=>ledger.heartbeat(pkg,workerId,gen);
 const stage=(kind,n)=>({
   claimed:true,package_id:pkg,generation:gen,reserved_count:n,
   next_parent_kind:kind,ready_for_provider_reconciliation:true,
   provider_writes_performed:false
 });
 // The backend owns all scope checks. Lookup BEFORE generateIds is critical
 // for reuse across packages and safe restart after unknown provider writes.
 async function reserveOneParent(kind,parentId){
   await heartbeat();
   const geoLeaf=geographic&&['ADDRESS','WORK_ORDER'].includes(kind);
   const existing=geoLeaf
     ? await ledger.readGeographicLeaf(pkg,workerId,gen,kind)
     : await ledger.readParent(pkg,workerId,gen,kind);
   if(existing?.exists===true){
     if(existing.kind!==kind||!ID.test(existing.remote_folder_id??'')
       ||existing.parent_remote_id!==parentId
       ||!['RESERVED','ATTEMPTED','VERIFIED'].includes(existing.state))
       fail('FROZEN_PARENT_IDENTITY_UNCERTAIN');
     return {id:existing.remote_folder_id,state:existing.state,newCount:0};
   }
   if(existing?.exists!==false)fail('FROZEN_PARENT_IDENTITY_UNCERTAIN');
   await heartbeat();
   const generated=await drive.generateIds(1);
   if(!Array.isArray(generated)||generated.length!==1||!ID.test(generated[0]))
     fail('REMOTE_IDS_UNAVAILABLE');
   await heartbeat();
   const saved=geoLeaf
     ? await ledger.reserveGeographicLeaf(pkg,workerId,gen,kind,generated[0],parentId)
     : await ledger.reserveParent(pkg,workerId,gen,kind,generated[0],parentId);
   if(saved?.kind!==kind||saved.remote_folder_id!==generated[0]
     ||saved.parent_remote_id!==parentId||saved.state!=='RESERVED')
     fail('FROZEN_PARENT_IDENTITY_UNCERTAIN');
   return {id:generated[0],state:'RESERVED',newCount:1};
 }
 const kinds=layout==='STATE_COUNTY_CITY_ADDRESS'
   ? ['STATE','COUNTY','CITY','ADDRESS','WORK_ORDER']
   : layout==='STATE_CITY_ADDRESS'
     ? ['STATE','CITY','ADDRESS','WORK_ORDER']
     : ['ADDRESS','WORK_ORDER'];
 let parentId=destination.id;
 const usedParentIds=new Set([parentId]);
 for(const kind of kinds){
   const parent=await reserveOneParent(kind,parentId);
   if(usedParentIds.has(parent.id))fail('FROZEN_PARENT_IDENTITY_UNCERTAIN');
   usedParentIds.add(parent.id);
   if(parent.state!=='VERIFIED')return stage(kind,parent.newCount);
   parentId=parent.id;
 }
 const wo={id:parentId};
 // Even after both database receipts, the current provider token must
 // independently prove the saved exact client WORK_ORDER destination.
 await drive.verifyDestination({folderId:wo.id,expectedDriveId});
 if(typeof ledger.reserveBatch!=='function'
   ||typeof ledger.nextReservedItem!=='function')
   fail('TRUSTED_WORKER_NOT_CONFIGURED');
 // Read the original durable set under this exact lease BEFORE allocating.
 // Existing complete or partially saved IDs must not be replaced after a
 // lost response. With zero rows, a new Google generateIds is harmless:
 // no provider object creation can yet have occurred for those unused IDs.
 await heartbeat();
 const next=await ledger.nextReservedItem(pkg,workerId,gen);
 if(next?.state!=='UNRESERVED')
   fail('ORIGINAL_FILE_RESERVATION_REQUIRES_RECONCILIATION');
 await heartbeat();
 const preallocated=await drive.generateIds(photos.length+2);
 if(!Array.isArray(preallocated)||preallocated.length!==photos.length+2
   ||preallocated.some(id=>!ID.test(id))
   ||new Set(preallocated).size!==preallocated.length
   ||preallocated.some(id=>usedParentIds.has(id)))
   fail('REMOTE_IDS_UNAVAILABLE');
 const folder=preallocated[0],manifestFile=preallocated.at(-1);
 await heartbeat();
 const receipt=await ledger.reserveBatch(pkg,workerId,gen,folder,wo.id,
   photos.map((p,i)=>({photo_id:p.photo_id,file_id:preallocated[i+1]})),
   manifestFile);
 if(receipt?.reserved!==true||receipt.package_id!==pkg
   ||receipt.folder_id!==folder||receipt.manifest_id!==manifestFile
   ||receipt.reserved_count!==photos.length+2)
   fail('ATOMIC_FILE_RESERVATION_UNCONFIRMED');
 return {claimed:true,package_id:pkg,generation:gen,
   reserved_count:photos.length+2,
   ready_for_provider_reconciliation:true,provider_writes_performed:false};
}

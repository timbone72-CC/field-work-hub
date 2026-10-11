// Service-only source candidate: one immutable ADDRESS or WORK_ORDER parent.
// A trusted SQL lease supplies the saved map and its full company scope.
// Never replay a Google POST after a recorded ATTEMPTED state.
import {DriveUncertain} from './drive-client.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9_-]{10,160}$/;
function deny(){throw new DriveUncertain('PARENT_FOLDER_IDENTITY_UNCERTAIN');}
export async function reconcileOnePreallocatedParent({
 map,packageId,workerId,generation,drive,ledger,expectedDriveId
}={}){
 if(!map||!UUID.test(packageId??'')||!UUID.test(workerId??'')
  ||!Number.isSafeInteger(generation)||generation<1
  ||!UUID.test(map.map_id??'')||!['ADDRESS','WORK_ORDER'].includes(map.kind)
  ||!ID.test(map.remote_folder_id??'')||!ID.test(map.parent_remote_id??'')
  ||map.remote_folder_id===map.parent_remote_id
  ||typeof map.remote_name!=='string'||map.remote_name.length<3
  ||!['RESERVED','ATTEMPTED','VERIFIED'].includes(map.state)
  ||!map.appProperties||Object.keys(map.appProperties).sort().join(',')!==
    ['fwh_company','fwh_destination','fwh_key','fwh_kind','fwh_org'].sort().join(',')
  ||map.appProperties.fwh_kind!==map.kind
  ||!ID.test(expectedDriveId??'')
  ||!['verifyFile','verifyDestination','createPreallocatedFolder'].every(k=>typeof drive?.[k]==='function')
  ||!['heartbeat','readParent','beginParentCreate','confirmParent'].every(k=>typeof ledger?.[k]==='function'))
  deny();
 const heartbeat=()=>ledger.heartbeat(packageId,workerId,generation);
 await heartbeat();
 const fresh=await ledger.readParent(packageId,workerId,generation,map.kind);
 if(fresh?.exists!==true||fresh.map_id!==map.map_id
  ||fresh.remote_folder_id!==map.remote_folder_id
  ||fresh.parent_remote_id!==map.parent_remote_id
  ||fresh.remote_name!==map.remote_name
  ||fresh.state!==map.state)deny();
 const receipt={id:map.remote_folder_id,parent:map.parent_remote_id,
  mime:'application/vnd.google-apps.folder',name:map.remote_name,
  expectedDriveId,sha256:null,size:null,appProperties:map.appProperties};
 const confirm=async()=>{
  await heartbeat();
  const proof=await drive.verifyFile(receipt);
  await heartbeat();
  await ledger.confirmParent(packageId,workerId,generation,map.map_id,proof);
  return {state:'PARENT_VERIFIED',map_id:map.map_id,kind:map.kind};
 };
 if(map.state!=='RESERVED')return confirm();
 await drive.verifyDestination({folderId:map.parent_remote_id,expectedDriveId});
 await heartbeat();
 const decision=await ledger.beginParentCreate(packageId,workerId,generation,map.map_id);
 if(decision?.map_id!==map.map_id||decision.file_id!==map.remote_folder_id
  ||decision.parent_id!==map.parent_remote_id
  ||!['MAY_CREATE','VERIFY_EXISTING'].includes(decision.state))deny();
 if(decision.state==='VERIFY_EXISTING')return confirm();
 await heartbeat();
 await drive.createPreallocatedFolder({
  id:map.remote_folder_id,parent:map.parent_remote_id,name:map.remote_name,
  mime:'application/vnd.google-apps.folder',appProperties:map.appProperties
 });
 return confirm();
}

/* Local preparation only. Deploying this web app requires separate approval. */
ACP_TECH._BridgeOperations=['operation_id','actor_id','digest','phase','result_json','updated_at'];
function acpBridgeHex_(bytes) {return bytes.map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function acpBridgeEqual_(a,b) {
  if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;
  var different=0;for(var i=0;i<64;i++)different|=a.charCodeAt(i)^b.charCodeAt(i);return different===0;
}
function acpBridgeAuth_(e) {
  var props=PropertiesService.getScriptProperties(),secret=props.getProperty('GOOGLE_BRIDGE_SECRET');
  var mode=props.getProperty('BRIDGE_MODE');
  if(['preview','public'].indexOf(mode)<0||!secret||secret.length<32)throw new Error('DISABLED');
  if(!e||!e.postData||typeof e.postData.contents!=='string'||e.postData.contents.length>100000)throw new Error('UNAUTHORIZED');
  var envelope=JSON.parse(e.postData.contents);
  if(envelope.version!=='v1'||typeof envelope.payload!=='string'||!Number.isSafeInteger(envelope.timestamp)||Math.abs(Date.now()-envelope.timestamp)>300000)throw new Error('UNAUTHORIZED');
  var signature=acpBridgeHex_(Utilities.computeHmacSha256Signature('v1\n'+envelope.timestamp+'\n'+envelope.payload,secret,Utilities.Charset.UTF_8));
  if(!acpBridgeEqual_(signature,envelope.signature))throw new Error('UNAUTHORIZED');
  var request=JSON.parse(envelope.payload),actor=props.getProperty('TEST_TELEGRAM_USER_ID');
  if(typeof request.actor!=='string'||!/^\d+$/.test(request.actor)||(mode==='preview'&&request.actor!==actor))throw new Error('UNAUTHORIZED');
  if(['snapshot','commit'].indexOf(request.action)<0)throw new Error('INVALID_ACTION');
  return request;
}
function acpBridgeContext_(actor) {
  var all=acpContext_(actor,actor,'',acpNow_());
  var suppliers=all.suppliers.filter(function(s){return String(s.telegram_user_id)===actor;});
  var ids=suppliers.map(function(s){return s.supplier_id;});
  var offers=all.offers.filter(function(o){return ids.indexOf(o.supplier_id)>=0;});
  var offerIds=offers.map(function(o){return o.offer_id;});
  var materials=all.materials.filter(function(m){return offerIds.indexOf(m.offer_id)>=0;});
  function clean(rows){return rows.map(function(r){var c=acpClone_(r);delete c._row;return c;});}
  return {suppliers:clean(suppliers),offers:clean(offers),materials:clean(materials)};
}
function acpBridgeValidate_(plan,actor) {
  if(!plan||!plan.effect||!plan.before||!plan.state||!plan.reply||typeof plan.reply.text!=='string'||isNaN(Date.parse(plan.now)))throw new Error('INVALID_PLAN');
  acpJSON_(plan);
  var effect=plan.effect,ctx=acpContext_(actor,actor,'',plan.now);
  if(effect.type==='profile') {
    acpOwn_(ctx,effect.supplier.supplier_id);
    if(!acpNonempty_(effect.supplier.company_name)||!acpNonempty_(effect.supplier.contact))throw new Error('INVALID_PROFILE');
    return;
  }
  if(effect.type!=='offer')throw new Error('INVALID_EFFECT');
  var d=effect.draft,p=d&&d.supplier;
  if(!p||!/^s\d+$/.test(p.supplier_id)||!/^o\d+$/.test(d.offer_id)||String(p.telegram_user_id)!==actor||String(p.telegram_chat_id)!==actor||!acpNonempty_(p.company_name)||!acpNonempty_(p.contact)||!acpHasContent_(d)||d.materials.length>15)throw new Error('INVALID_DRAFT');
  var existing=ctx.suppliers.find(function(s){return s.supplier_id===p.supplier_id;});
  if(existing&&String(existing.telegram_user_id)!==actor)throw new Error('SUPPLIER_NOT_ACCESSIBLE');
  if(!d.newCompany) {
    var own=acpOwn_(ctx,p.supplier_id);
    if(own.drive_folder_id!==p.drive_folder_id)throw new Error('FOLDER_MISMATCH');
  } else if(p.drive_folder_id)throw new Error('NEW_FOLDER_FORBIDDEN');
  var offer=ctx.offers.find(function(o){return o.offer_id===d.offer_id;});
  if(offer&&offer.supplier_id!==p.supplier_id)throw new Error('OFFER_NOT_ACCESSIBLE');
  d.materials.forEach(function(m){
    var previous=ctx.materials.find(function(r){return r.material_id===m.material_id;});
    if(previous&&previous.offer_id!==d.offer_id)throw new Error('MATERIAL_NOT_ACCESSIBLE');
    if(m.drive_file_id&&(!previous||previous.drive_file_id!==m.drive_file_id))throw new Error('FILE_NOT_ACCESSIBLE');
    if(['file','link'].indexOf(m.kind)<0)throw new Error('INVALID_MATERIAL');
  });
}
function acpBridgeSnapshot_(actor) {
  if(acpRows_('_Updates').some(function(r){return String(r.actor_id)===actor&&r.phase==='planned';})||acpRows_('_Outbox').some(function(r){return String(r.chat_id)===actor&&r.status==='pending';}))throw new Error('FINISH_LEGACY_OPERATIONS');
  var saved=acpRows_('_Sessions').find(function(r){return String(r.actor_id)===actor;});
  return {context:acpBridgeContext_(actor),state:saved?JSON.parse(saved.state_json):acpEmpty_(),touchedAt:saved?Date.parse(saved.updated_at):0};
}
function acpBridgeCommit_(request) {
  if(!Number.isSafeInteger(request.update_id)||request.update_id<0)throw new Error('INVALID_ID');
  var key='w'+request.update_id,actor=request.actor,plan=request.plan;
  var digest=acpBridgeHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(plan),Utilities.Charset.UTF_8));
  var rows=acpRows_('_BridgeOperations'),known=rows.find(function(r){return r.operation_id===key;});
  if(known&&(known.actor_id!==actor||known.digest!==digest))throw new Error('OPERATION_CONFLICT');
  if(known&&known.phase==='applied')return {view:JSON.parse(known.result_json),context:acpBridgeContext_(actor)};
  if(rows.some(function(r){return String(r.actor_id)===actor&&r.phase==='planned'&&r.operation_id!==key;}))throw new Error('EARLIER_OPERATION_PENDING');
  acpBridgeValidate_(plan,actor);
  if(!known)acpPut_('_BridgeOperations',{operation_id:key,actor_id:actor,digest:digest,phase:'planned',result_json:acpJSON_(plan),updated_at:acpNow_()});
  var view={state:plan.state,reply:plan.reply};
  try {acpCommit_(plan.effect,actor,plan.now);}
  catch(error) {
    if(!error.materialId)throw error;
    var retry=acpClone_(plan.before);retry.draft.failed=[error.materialId];retry.step='review';
    var fallback=acpView_(retry,{id:request.update_id},'Не вдалося зберегти один із файлів. Попередні матеріали залишилися актуальними. Повторіть збереження або продовжте без невдалого файлу.',[['Повторити збереження','save'],['Без невдалого файлу','omitFailed'],['Виправити','draftMaterials'],['Скасувати','cancel']]);
    view={state:fallback.state,reply:fallback.reply};
  }
  // Journal completion follows both the business writes and session checkpoint.
  acpPut_('_Sessions',{actor_id:actor,state_json:acpJSON_(view.state),updated_at:acpNow_()});
  acpPut_('_BridgeOperations',{operation_id:key,actor_id:actor,digest:digest,phase:'applied',result_json:acpJSON_(view),updated_at:acpNow_()});
  return {view:view,context:acpBridgeContext_(actor)};
}
function doPost(e) {
  var result,lock;
  try {
    var request=acpBridgeAuth_(e);acpRequireOwner_();
    lock=LockService.getScriptLock();
    if(!lock.tryLock(15000)){lock=null;throw new Error('BUSY');}
    result={ok:true,...(request.action==='snapshot'?acpBridgeSnapshot_(request.actor):acpBridgeCommit_(request))};
  } catch(error) {
    // Never return/log native exception details, Google URLs, payloads or tokens.
    var allowed=['DISABLED','UNAUTHORIZED','BUSY','FINISH_LEGACY_OPERATIONS','OPERATION_CONFLICT','EARLIER_OPERATION_PENDING'];
    result={ok:false,error:allowed.indexOf(error.message)>=0?error.message:'BRIDGE_RETRY'};
  } finally {if(lock)lock.releaseLock();}
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

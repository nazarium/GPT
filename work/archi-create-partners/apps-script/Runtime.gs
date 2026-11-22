/* Durable manual worker. No time trigger is created by this file. */
var ACP_TECH = {
  '_Sessions':['actor_id','state_json','updated_at'],
  '_Updates':['update_id','actor_id','chat_id','phase','plan_json','updated_at'],
  '_Outbox':['reply_id','chat_id','text','markup_json','status','updated_at']
};
function acpNow_() { return new Date().toISOString(); }
function acpBook_() { return SpreadsheetApp.openById(PARTNERS.spreadsheetId); }
function acpRequireOwner_() {
  if(Session.getEffectiveUser().getEmail()!==PARTNERS.owner)throw new Error('WRONG_GOOGLE_ACCOUNT');
}
function prepareBotStorage() {
  acpRequireOwner_();return partnersWithLock_(function(){
    var ss=acpBook_();Object.keys(PARTNERS.headers).forEach(function(n){partnersSheet_(ss,n);});
    Object.keys(ACP_TECH).forEach(function(n){
      var s=ss.getSheetByName(n);
      if(!s){s=ss.insertSheet(n);partnersWriteLiteral_(s.getRange(1,1,1,ACP_TECH[n].length),[ACP_TECH[n]]);s.setFrozenRows(1);s.hideSheet();}
      if(JSON.stringify(s.getRange(1,1,1,ACP_TECH[n].length).getValues()[0])!==JSON.stringify(ACP_TECH[n]))throw new Error('TECH_SCHEMA_MISMATCH');
    });console.log('Bot storage ready. Polling and triggers remain OFF.');
  });
}
function acpRows_(name) {
  var ss=acpBook_(),s=ss.getSheetByName(name),fields=PARTNERS.headers[name]||ACP_TECH[name];
  if(!s||!fields)throw new Error('RUN_prepareBotStorage_FIRST');
  if(s.getLastRow()>15000)throw new Error('REGISTRY_CAPACITY_REVIEW_REQUIRED');
  if(JSON.stringify(s.getRange(1,1,1,fields.length).getValues()[0])!==JSON.stringify(fields))throw new Error('SCHEMA_MISMATCH');
  if(s.getLastRow()<2)return [];
  return s.getRange(2,1,s.getLastRow()-1,fields.length).getValues().map(function(row,index){
    var x={_row:index+2};fields.forEach(function(f,i){x[f]=row[i];});return x;
  }).filter(function(r){return r[fields[0]]!=='';});
}
/* Only called while holding the script lock. */
function acpPut_(name,record) {
  var fields=PARTNERS.headers[name]||ACP_TECH[name],sheet=acpBook_().getSheetByName(name);
  if(!sheet||!fields)throw new Error('MISSING_STORAGE');
  var all=acpRows_(name),matches=[];
  all.forEach(function(r){if(String(r[fields[0]])===String(record[fields[0]]))matches.push(r._row);});
  if(matches.length>1)throw new Error('DUPLICATE_PRIMARY_KEY');
  var row=matches.length?matches[0]:Math.max(2,sheet.getLastRow()+1);
  if(row>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),100);
  partnersWriteLiteral_(sheet.getRange(row,1,1,fields.length),[fields.map(function(f){return record[f]==null?'':record[f];})]);
  SpreadsheetApp.flush();
}
function acpJSON_(x) {var str=JSON.stringify(x);if(str.length>43000)throw new Error('STATE_TOO_LARGE');return str;}
function acpContext_(actor,chat,username,now) {
  return {actor:actor,chat:chat,username:username||'',now:now,suppliers:acpRows_('Постачальники'),offers:acpRows_('Пропозиції'),materials:acpRows_('Матеріали')};
}
function acpPrivateFolder_(folder) {
  if(!folder.getOwner()||folder.getOwner().getEmail()!==PARTNERS.owner||folder.getSharingAccess()!==DriveApp.Access.PRIVATE||folder.getEditors().length||folder.getViewers().length)throw new Error('FOLDER_NOT_PRIVATE');
}
function acpChild_(parent,name) {
  acpPrivateFolder_(parent);var it=parent.getFoldersByName(name),folder=it.hasNext()?it.next():parent.createFolder(name);
  if(it.hasNext())throw new Error('DUPLICATE_FOLDER');acpPrivateFolder_(folder);return folder;
}
function acpSupplierFolder_(root,p) {
  acpPrivateFolder_(root);
  var folder=null,marker='partners-supplier:'+p.supplier_id;
  if(p.drive_folder_id)folder=DriveApp.getFolderById(p.drive_folder_id);
  else {
    var all=root.getFolders();
    while(all.hasNext()) {var candidate=all.next();if(candidate.getDescription()===marker||candidate.getName()===p.supplier_id){if(folder)throw new Error('DUPLICATE_SUPPLIER_FOLDER');folder=candidate;}}
  }
  if(folder) {
    acpPrivateFolder_(folder);var parents=folder.getParents(),found=false;
    while(parents.hasNext())if(parents.next().getId()===root.getId())found=true;
    if(!found)throw new Error('WRONG_SUPPLIER_FOLDER');
  }
  var base=String(p.company_name||'').trim();if(!base)throw new Error('COMPANY_NAME_REQUIRED');
  function taken(name) {var it=root.getFoldersByName(name);while(it.hasNext()){var item=it.next();if(!folder||item.getId()!==folder.getId())return true;}return false;}
  var name=base;
  // Keep an already assigned dated name stable on retries and later updates.
  if(folder&&folder.getName().indexOf(base+' — ')===0&&/^\d{4}-\d{2}-\d{2}( — \d+)?$/.test(folder.getName().slice(base.length+3)))name=folder.getName();
  else if(taken(name)) {
    var dated=base+' — '+Utilities.formatDate(new Date(),'Europe/Kyiv','yyyy-MM-dd');name=dated;var suffix=2;
    while(taken(name)){name=dated+' — '+suffix++;if(suffix>15000)throw new Error('FOLDER_NAME_CAPACITY');}
  }
  if(!folder){folder=root.createFolder(name);folder.setDescription(marker);}
  else if(folder.getName()!==name)folder.setName(name);
  acpPrivateFolder_(folder);return folder;
}
function renameSupplierFolders() {
  acpRequireOwner_();return partnersWithLock_(function(){
    var root=DriveApp.getFolderById(PARTNERS.suppliersFolderId),count=0;
    acpRows_('Постачальники').forEach(function(p){if(p.drive_folder_id){acpSupplierFolder_(root,p);count++;}});
    console.log(JSON.stringify({supplierFoldersUpdated:count}));
  });
}
function flattenSupplierFolders() {
  acpRequireOwner_();return partnersWithLock_(function(){
    var root=DriveApp.getFolderById(PARTNERS.suppliersFolderId),moved=0,removed=0;
    acpRows_('Постачальники').forEach(function(p){
      if(!p.drive_folder_id)return;
      var folder=acpSupplierFolder_(root,p),it=folder.getFoldersByName('Актуальні');
      if(!it.hasNext())return;
      var active=it.next();if(it.hasNext())throw new Error('DUPLICATE_ACTIVE_FOLDER');
      acpPrivateFolder_(active);
      if(active.getFolders().hasNext())throw new Error('UNEXPECTED_NESTED_FOLDER');
      var files=active.getFiles();
      while(files.hasNext()){var file=files.next();file.moveTo(folder);moved++;}
      if(active.getFiles().hasNext()||active.getFolders().hasNext())throw new Error('ACTIVE_FOLDER_NOT_EMPTY');
      active.setTrashed(true);removed++;
    });
    console.log(JSON.stringify({filesMoved:moved,emptyFoldersTrashed:removed}));
  });
}
function acpOfferTextFile_(folder,offerId,text) {
  acpPrivateFolder_(folder);
  var marker='partners-offer-text:'+offerId,it=folder.getFiles(),file=null;
  while(it.hasNext()){var item=it.next();if(item.getDescription()===marker){if(file)throw new Error('DUPLICATE_OFFER_TEXT');file=item;}}
  var content=String(text||'');
  if(!content.trim()){if(file)file.setContent('Текст пропозиції очищено. Актуальні матеріали — у реєстрі та папці компанії.');return;}
  if(file){file.setContent(content);return;}
  var name='Пропозиція — '+offerId+'.txt';
  // Recover a file created immediately before an interrupted description write.
  var names=folder.getFilesByName(name);
  if(names.hasNext()){file=names.next();if(names.hasNext()||file.getDescription())throw new Error('OFFER_TEXT_NAME_CONFLICT');file.setDescription(marker);file.setContent(content);return;}
  file=folder.createFile(name,content,MimeType.PLAIN_TEXT);file.setDescription(marker);
}
function exportExistingOfferTexts() {
  acpRequireOwner_();return partnersWithLock_(function(){
    var suppliers=acpRows_('Постачальники'),count=0;
    acpRows_('Пропозиції').forEach(function(offer){
      if(offer.status!=='active'||!String(offer.text||'').trim())return;
      var p=suppliers.find(function(s){return s.supplier_id===offer.supplier_id;});
      if(!p||!p.drive_folder_id)throw new Error('SUPPLIER_FOLDER_MISSING');
      var folder=acpSupplierFolder_(DriveApp.getFolderById(PARTNERS.suppliersFolderId),p);
      acpOfferTextFile_(folder,offer.offer_id,offer.text);count++;
    });console.log(JSON.stringify({offerTextsExported:count}));
  });
}
function acpDownload_(folder,m) {
  acpPrivateFolder_(folder);
  var name=m.material_id+'__'+String(m.original_name||'document').replace(/[\\/\u0000-\u001f]/g,'_').slice(0,150);
  var it=folder.getFilesByName(name);
  if(it.hasNext()) {
    var old=it.next();if(it.hasNext())throw new Error('DUPLICATE_FILE');
    if(old.getDescription()!=='partners-material:'+m.material_id)throw new Error('FILE_KEY_CONFLICT');
    return old.getId();
  }
  partnersValidateFile_(m.telegram_file);
  var info=partnersTelegram_('getFile',{file_id:m.telegram_file.file_id});partnersValidateFile_(info);
  if(!info.file_path||!/^[A-Za-z0-9_./-]+$/.test(info.file_path)||info.file_path.charAt(0)==='/'||info.file_path.split('/').indexOf('..')>=0)throw new Error('INVALID_FILE_PATH');
  var response=partnersFetch_('https://api.telegram.org/file/bot'+partnersToken_()+'/'+info.file_path,{muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw new Error('FILE_DOWNLOAD_FAILED');
  var blob=response.getBlob();if(blob.getBytes().length>PARTNERS.maxFileBytes)throw new Error('FILE_TOO_LARGE');
  blob.setName(name);var file=folder.createFile(blob);
  try {file.setDescription('partners-material:'+m.material_id);}catch(e){file.setTrashed(true);throw new Error('FILE_DESCRIPTION_FAILED');}
  return file.getId();
}
function acpCommit_(effect,actor,now) {
  var ctx=acpContext_(actor,'','',now);
  var bound=acpSingleCompany_(ctx);
  var target=effect.type==='profile'?effect.supplier:effect.draft.supplier;
  if(bound&&bound.supplier_id!==target.supplier_id)throw new Error('ACCOUNT_ALREADY_BOUND');
  if(effect.type==='profile') {
    var previous=acpOwn_(ctx,effect.supplier.supplier_id),changed=acpClone_(effect.supplier);
    changed.created_at=previous.created_at;changed.telegram_user_id=previous.telegram_user_id;changed.telegram_chat_id=previous.telegram_chat_id;
    changed.drive_folder_id=previous.drive_folder_id;changed.updated_at=now;
    if(changed.drive_folder_id)acpSupplierFolder_(DriveApp.getFolderById(PARTNERS.suppliersFolderId),changed);
    acpPut_('Постачальники',changed);return;
  }
  var d=effect.draft,p=acpClone_(d.supplier),existing=ctx.suppliers.filter(function(x){return x.supplier_id===p.supplier_id;});
  if(!d.newCompany)acpOwn_(ctx,p.supplier_id);
  else if(existing.length&&String(existing[0].telegram_user_id)!==actor)throw new Error('SUPPLIER_NOT_ACCESSIBLE');
  if(d.mode==='edit')acpOffer_(ctx,d.offer_id,p.supplier_id);
  var root=DriveApp.getFolderById(PARTNERS.suppliersFolderId),folder=acpSupplierFolder_(root,p);
  var active=folder;
  /* Download every new file before modifying live proposal rows. Failures preserve old data. */
  var ready=d.materials.map(function(m){
    var copy=acpClone_(m);
    if(m.kind==='file'&&!m.drive_file_id) {
      try {copy.drive_file_id=acpDownload_(active,m);}
      catch(e){var err=new Error('MATERIAL_DOWNLOAD_FAILED');err.materialId=m.material_id;throw err;}
    }
    return copy;
  });
  p.drive_folder_id=folder.getId();p.updated_at=now;p.telegram_user_id=actor;
  var oldMaterials=ctx.materials.filter(function(m){return m.offer_id===d.offer_id;});
  ready.forEach(function(m){
    var old=oldMaterials.find(function(o){return o.material_id===m.material_id;});
    acpPut_('Матеріали',{material_id:m.material_id,offer_id:d.offer_id,kind:m.kind,original_name:m.original_name||'',drive_file_id:m.drive_file_id||'',source_url:m.source_url||'',mime_type:m.mime_type||'',size_bytes:m.size_bytes==null?'':m.size_bytes,status:'active',created_at:old?old.created_at:now,updated_at:now});
  });
  oldMaterials.filter(function(m){return m.status==='active'&&!ready.some(function(n){return n.material_id===m.material_id;});}).forEach(function(m){m.status='archived';m.updated_at=now;acpPut_('Матеріали',m);});
  acpPut_('Постачальники',p);
  var oldOffer=ctx.offers.find(function(o){return o.offer_id===d.offer_id;});
  acpOfferTextFile_(folder,d.offer_id,d.text||'');
  acpPut_('Пропозиції',{offer_id:d.offer_id,supplier_id:p.supplier_id,text:d.text||'',status:'active',created_at:oldOffer?oldOffer.created_at:(d.created_at||now),updated_at:now});
}
function acpReplyRecord_(update,plan) {
  return {reply_id:'r'+update.update_id,chat_id:String(update.chat_id),text:plan.reply.text.slice(0,4000),markup_json:acpJSON_(plan.reply.markup),status:'pending',updated_at:acpNow_()};
}
function acpApply_(update) {
  var plan=JSON.parse(update.plan_json);
  if(update.phase==='planned') {
    if(plan.effect) {
      try {acpCommit_(plan.effect,String(update.actor_id),plan.now);}
      catch(e) {
        if(!e.materialId)throw e;
        /* Expected file failures become an actionable review; no live rows were changed. */
        var retry=acpClone_(plan.before);retry.draft.failed=[e.materialId];retry.step='review';
        var fallback=acpView_(retry,{id:update.update_id},'Не вдалося зберегти один із файлів. Попередні матеріали залишилися актуальними. Повторіть збереження або продовжте без невдалого файлу.',[['Повторити збереження','save'],['Без невдалого файлу','omitFailed'],['Виправити','draftMaterials'],['Скасувати','cancel']]);
        fallback.now=plan.now;fallback.before=plan.before;plan=fallback;
      }
    }
    /* Replays replace these same keys, never append another supplier/proposal. */
    acpPut_('_Sessions',{actor_id:String(update.actor_id),state_json:acpJSON_(plan.state),updated_at:acpNow_()});
    acpPut_('_Outbox',acpReplyRecord_(update,plan));
    update.phase='applied';update.plan_json=acpJSON_(plan);update.updated_at=acpNow_();acpPut_('_Updates',update);
  }
}
function acpEvent_(update) {
  var m=update.message,cb=update.callback_query;
  if(cb)m=cb.message;
  if(!m||m.chat.type!=='private')return null;
  var sender=cb?cb.from:m.from;
  if(!sender||sender.is_bot)return null;
  return {id:update.update_id,actor:String(sender.id),chat:String(m.chat.id),username:sender.username||'',date:m.date,
    text:cb?'':(m.text||m.caption||''),document:cb?null:m.document,contact:cb?null:m.contact,callback:cb?cb.data:null,callbackId:cb?cb.id:null};
}
function acpHandle_(raw,allowedActor) {
  var event=acpEvent_(raw);if(!event||event.actor!==allowedActor)return;
  var known=acpRows_('_Updates').find(function(u){return String(u.update_id)===String(raw.update_id);});
  if(known){acpApply_(known);return;}
  var saved=acpRows_('_Sessions').find(function(s){return String(s.actor_id)===event.actor;});
  var state=saved?JSON.parse(saved.state_json):acpEmpty_();
  if(saved && Date.now()-new Date(saved.updated_at).getTime()>7*86400000)state=acpEmpty_();
  var ctx=acpContext_(event.actor,event.chat,event.username,acpNow_()),plan;
  try {plan=acpReducer_(state,event,ctx);}
  catch(e) {plan={state:state,reply:{text:'Не вдалося виконати дію. Відкрийте головне меню та оберіть власну компанію.',markup:{}},effect:null};}
  if(plan.effect&&['profile','offer'].indexOf(plan.effect.type)<0)throw new Error('INVALID_EFFECT_TYPE');
  plan.now=ctx.now;plan.before=state;
  if(JSON.stringify(plan).length>40000)plan={state:state,before:state,now:ctx.now,effect:null,reply:{text:'Анкета завелика для одного подання. Скоротіть текст або замініть добірку файлів посиланням на каталог.',markup:{}}};
  var row={update_id:String(raw.update_id),actor_id:event.actor,chat_id:event.chat,phase:'planned',plan_json:acpJSON_(plan),updated_at:acpNow_()};
  acpPut_('_Updates',row);acpApply_(row);
}
function acpFlushOutbox_(actorChat) {
  var pending=acpRows_('_Outbox').filter(function(r){return r.status==='pending'&&String(r.chat_id)===actorChat;}).slice(0,5);
  pending.forEach(function(r){
    partnersTelegram_('sendMessage',{chat_id:String(r.chat_id),text:r.text,reply_markup:JSON.parse(r.markup_json),link_preview_options:{is_disabled:true}});
    r.status='sent';r.updated_at=acpNow_();acpPut_('_Outbox',r);
    Utilities.sleep(1100);
  });
}
/** Read-only: discovers possible tester IDs without acknowledging updates or printing messages. */
function previewTestUsers() {
  acpRequireOwner_();var updates=partnersTelegram_('getUpdates',{timeout:0,limit:100,allowed_updates:['message','callback_query']});
  var ids={};updates.forEach(function(u){var e=acpEvent_(u);if(e)ids[e.actor]=true;});
  var result={pendingPrivateUserIds:Object.keys(ids)};console.log(JSON.stringify(result));return result;
}
/** Manual, allowlisted test only. Requires TEST_TELEGRAM_USER_ID in Script properties. */
function registerPrivateTest() {
  acpRequireOwner_();return partnersWithLock_(function(){
    var updates=partnersTelegram_('getUpdates',{timeout:0,limit:100,allowed_updates:['message','callback_query']});
    var ids={};updates.forEach(function(u){var e=acpEvent_(u);if(e&&e.text==='/start acp_test_7f29c1'&&!e.callback)ids[e.actor]=true;});
    var actors=Object.keys(ids);if(actors.length!==1)throw new Error('SEND_UNIQUE_TEST_START_COMMAND_FIRST');
    var props=PropertiesService.getScriptProperties(),existing=props.getProperty('TEST_TELEGRAM_USER_ID');
    if(existing&&existing!==actors[0])throw new Error('TEST_USER_ALREADY_CONFIGURED');
    props.setProperty('TEST_TELEGRAM_USER_ID',actors[0]);
    console.log('Private tester configured. No messages sent; automatic polling remains OFF.');
    return {tester:'configured',automatic:false};
  });
}
function pollTestOnce() {
  acpRequireOwner_();var props=PropertiesService.getScriptProperties(),actor=props.getProperty('TEST_TELEGRAM_USER_ID');
  if(!actor||!/^\d+$/.test(actor))throw new Error('SET_TEST_TELEGRAM_USER_ID_IN_SCRIPT_PROPERTIES');
  return partnersWithLock_(function(){
    var hook=partnersTelegram_('getWebhookInfo',{});if(hook.url)throw new Error('WEBHOOK_EXISTS');
    var queued=acpRows_('_Updates').filter(function(u){return u.phase==='planned';});
    queued.forEach(function(u){if(String(u.actor_id)!==actor)throw new Error('PENDING_OTHER_ACTOR');acpApply_(u);});
    acpFlushOutbox_(actor);
    var offset=Number(props.getProperty('TEST_UPDATE_OFFSET')||0);
    var updates=partnersTelegram_('getUpdates',{offset:offset,timeout:0,limit:10,allowed_updates:['message','callback_query']});
    updates.forEach(function(raw){
      acpHandle_(raw,actor);
      props.setProperty('TEST_UPDATE_OFFSET',String(raw.update_id+1));
      var event=acpEvent_(raw);
      if(event&&event.actor===actor&&event.callbackId) {
        try {partnersTelegram_('answerCallbackQuery',{callback_query_id:event.callbackId});}catch(e){/* Expired callbacks do not roll back saved work. */}
      }
    });
    acpFlushOutbox_(actor);console.log(JSON.stringify({updates:updates.length,mode:'manual-test',automatic:false}));
  });
}
/** Idempotently resumes the private tester, then runs one finite manual test window. */
function resumePrivateTestDraft() {
  acpRequireOwner_();partnersWithLock_(function(){
    var actor=PropertiesService.getScriptProperties().getProperty('TEST_TELEGRAM_USER_ID');
    if(!actor)throw new Error('TEST_USER_NOT_CONFIGURED');
    var saved=acpRows_('_Sessions').find(function(s){return String(s.actor_id)===actor;});
    if(!saved)throw new Error('TEST_DRAFT_MISSING');
    var s=JSON.parse(saved.state_json);
    if(s.step!=='interrupt'){console.log('Private test state already resumed; no draft fields changed.');return;}
    if(s.step!=='interrupt'||!s.resume||s.resume.step!=='name'||!s.resume.draft)throw new Error('TEST_DRAFT_NOT_AT_COMPANY_NAME');
    var resumed=s.resume,chat=String(resumed.draft.supplier.telegram_chat_id);
    if(chat!==actor)throw new Error('PRIVATE_CHAT_MISMATCH');
    var key='recovery'+Date.now();
    var view=acpView_(resumed,{id:key},'Відновлено тестову анкету. Як називається ваша компанія або бренд, який ви представляєте?',resumed.buttons);
    acpPut_('_Sessions',{actor_id:actor,state_json:acpJSON_(view.state),updated_at:acpNow_()});
    acpPut_('_Outbox',{reply_id:key,chat_id:chat,text:view.reply.text,markup_json:acpJSON_(view.reply.markup),status:'pending',updated_at:acpNow_()});
    acpFlushOutbox_(chat);console.log('Private draft resumed at company name; existing proposals unchanged.');
  });
  runPrivateTestWindow();
}
/** One manually started, finite test window. Never creates a trigger or enables public processing. */
function runPrivateTestWindow() {
  acpRequireOwner_();var until=Date.now()+180000;
  console.log('Private test window started for 3 minutes. No trigger created.');
  while(Date.now()<until){pollTestOnce();if(Date.now()+10000<until)Utilities.sleep(10000);else break;}
  console.log('Private test window finished; automatic polling remains OFF.');
}

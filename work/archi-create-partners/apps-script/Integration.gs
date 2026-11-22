/** Archi-Create Partners: connection and storage layer. No triggers or public endpoints. */
var PARTNERS = Object.freeze({
  owner: 'archicreate.partners@gmail.com',
  spreadsheetId: '1zBYdU8OnlWLwiAiE9EMTNQmLmI1ORS8KCxHm5Zk390k',
  suppliersFolderId: '1PhbAMaI88jqcbWQCDeofudf-Xb0FIYqS',
  systemFolderId: '1YWKDN1_pgV-YusDdaRG1NMovphollOV_',
  maxFileBytes: 20000000,
  headers: {
    'Постачальники': ['supplier_id','telegram_user_id','telegram_chat_id','telegram_username','company_name','contact','categories','brands','regions','terms','drive_folder_id','status','created_at','updated_at','confirmed_at'],
    'Пропозиції': ['offer_id','supplier_id','text','status','created_at','updated_at'],
    'Матеріали': ['material_id','offer_id','kind','original_name','drive_file_id','source_url','mime_type','size_bytes','status','created_at','updated_at']
  }
});

/** Run manually first. Checks connection; does not send messages or change the bot. */
function verifyConnection() {
  var actor = Session.getEffectiveUser().getEmail();
  if (actor !== PARTNERS.owner) throw new Error('WRONG_GOOGLE_ACCOUNT');
  var ss = SpreadsheetApp.openById(PARTNERS.spreadsheetId);
  Object.keys(PARTNERS.headers).forEach(function(name) { partnersSheet_(ss, name); });
  [PARTNERS.suppliersFolderId, PARTNERS.systemFolderId].forEach(function(id) {
    var folder = DriveApp.getFolderById(id);
    if (!folder.getOwner() || folder.getOwner().getEmail() !== PARTNERS.owner) {
      throw new Error('WRONG_FOLDER_OWNER');
    }
    if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE ||
        folder.getEditors().length || folder.getViewers().length) {
      throw new Error('FOLDER_NOT_OWNER_ONLY');
    }
  });
  var me = partnersTelegram_('getMe', {});
  if (me.username !== 'ArchiCreatePartnersBot') throw new Error('WRONG_TELEGRAM_BOT');
  var hook = partnersTelegram_('getWebhookInfo', {});
  if (hook.url) throw new Error('WEBHOOK_ALREADY_SET_DO_NOT_START_POLLING');
  var result = {googleAccount: actor, botUsername: me.username,
    spreadsheet: 'OK', folders: 'OK', webhook: 'absent', maxFileBytes: PARTNERS.maxFileBytes};
  console.log(JSON.stringify(result));
  return result;
}

/** Optional manual test. Creates temporary resources, verifies them, then cleans up. */
function testStorage() {
  if (Session.getEffectiveUser().getEmail() !== PARTNERS.owner) throw new Error('WRONG_GOOGLE_ACCOUNT');
  return partnersWithLock_(function() {
    var ss = SpreadsheetApp.openById(PARTNERS.spreadsheetId);
    var sheet = null, file = null;
    try {
      sheet = ss.insertSheet('_Test_' + Utilities.getUuid().slice(0,8));
      partnersWriteLiteral_(sheet.getRange(1,1,1,3), [['000000000001','=1+1','test@example.invalid']]);
      SpreadsheetApp.flush();
      var read = sheet.getRange(1,1,1,3).getValues()[0];
      if (read[0] !== '000000000001' || read[1] !== '=1+1' ||
          sheet.getRange(1,2).getFormula()) throw new Error('LITERAL_STORAGE_FAILED');
      file = DriveApp.getFolderById(PARTNERS.systemFolderId)
        .createFile(Utilities.newBlob('Archi-Create storage test', 'text/plain', '_storage-test.txt'));
      if (file.getSharingAccess() !== DriveApp.Access.PRIVATE ||
          file.getBlob().getDataAsString() !== 'Archi-Create storage test') {
        throw new Error('PRIVATE_FILE_STORAGE_FAILED');
      }
    } finally {
      try { if (file) file.setTrashed(true); }
      finally { if (sheet) ss.deleteSheet(sheet); }
    }
    console.log('Storage test passed; test sheet removed and test file moved to trash.');
    return {literalText: 'OK', privateFile: 'OK', cleanup: 'OK'};
  });
}

function partnersWithLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('BUSY_RETRY_LATER');
  try { return fn(); } finally { lock.releaseLock(); }
}

function partnersSheet_(ss, name) {
  var expected = PARTNERS.headers[name];
  if (!expected) throw new Error('UNKNOWN_DATA_SHEET');
  var sheet = ss.getSheetByName(name);
  if (!sheet || JSON.stringify(sheet.getRange(1,1,1,expected.length).getValues()[0]) !== JSON.stringify(expected)) {
    throw new Error('SCHEMA_MISMATCH_' + name);
  }
  return sheet;
}

/** User strings are never evaluated as spreadsheet formulas. */
function partnersWriteLiteral_(range, rows) {
  var safe = rows.map(function(row) {
    return row.map(function(value) {
      if (value == null) return '';
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'boolean') return value;
      if (typeof value !== 'string') throw new Error('INVALID_CELL_VALUE');
      if (value.length > 45000) throw new Error('CELL_TEXT_TOO_LONG');
      return value.charAt(0) === '=' || value.charAt(0) === "'" ? "'" + value : value;
    });
  });
  range.setNumberFormat('@');
  range.setValues(safe);
}

/** Upsert a complete record by stable primary key, under one script lock. */
function partnersUpsert_(sheetName, record) {
  var fields = PARTNERS.headers[sheetName];
  if (!fields || Object.keys(record).some(function(k) { return fields.indexOf(k) < 0; })) {
    throw new Error('UNKNOWN_RECORD_FIELD');
  }
  if (fields.some(function(k) { return !Object.prototype.hasOwnProperty.call(record, k); })) {
    throw new Error('INCOMPLETE_RECORD');
  }
  var id = record[fields[0]];
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('INVALID_RECORD_ID');
  return partnersWithLock_(function() {
    var ss = SpreadsheetApp.openById(PARTNERS.spreadsheetId);
    var sheet = partnersSheet_(ss, sheetName);
    var last = sheet.getLastRow();
    var keys = last > 1 ? sheet.getRange(2,1,last-1,1).getValues() : [];
    var matches = [];
    keys.forEach(function(row, i) { if (String(row[0]) === id) matches.push(i+2); });
    if (matches.length > 1) throw new Error('DUPLICATE_PRIMARY_KEY');
    var target = matches.length ? matches[0] : Math.max(last+1, 2);
    if (target > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
    partnersWriteLiteral_(sheet.getRange(target,1,1,fields.length), [fields.map(function(k) { return record[k]; })]);
    SpreadsheetApp.flush();
    return target;
  });
}

/** Checks owner binding. Caller must use the Telegram-provided user ID, never a form value. */
function partnersOwnSupplier_(supplierId, actorTelegramId) {
  if (!actorTelegramId || typeof actorTelegramId !== 'string') throw new Error('INVALID_TELEGRAM_ACTOR');
  var sheet = partnersSheet_(SpreadsheetApp.openById(PARTNERS.spreadsheetId), 'Постачальники');
  if (sheet.getLastRow() < 2) throw new Error('SUPPLIER_NOT_ACCESSIBLE');
  var rows = sheet.getRange(2,1,sheet.getLastRow()-1,PARTNERS.headers['Постачальники'].length).getValues();
  var matches = rows.filter(function(r) { return String(r[0]) === supplierId; });
  if (matches.length !== 1 || String(matches[0][1]) !== actorTelegramId) throw new Error('SUPPLIER_NOT_ACCESSIBLE');
  return matches[0];
}

function partnersValidateFile_(file) {
  if (!file || typeof file.file_id !== 'string' || !file.file_id) throw new Error('INVALID_TELEGRAM_FILE');
  if (file.file_size != null && (!Number.isSafeInteger(file.file_size) || file.file_size < 0)) {
    throw new Error('INVALID_FILE_SIZE');
  }
  if (file.file_size > PARTNERS.maxFileBytes) throw new Error('FILE_TOO_LARGE_SEND_LINK');
}

/** Saves to a verified supplier folder, with deterministic file name for retry protection. */
function partnersSaveFile_(supplierId, actorId, materialId, telegramFile) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(materialId)) throw new Error('INVALID_MATERIAL_ID');
  partnersValidateFile_(telegramFile);
  return partnersWithLock_(function() {
    var supplier = partnersOwnSupplier_(supplierId, actorId);
    var folderId = supplier[10];
    if (!folderId) throw new Error('SUPPLIER_FOLDER_MISSING');
    var folder = DriveApp.getFolderById(folderId);
    var parents = folder.getParents(), inRoot = false;
    while (parents.hasNext()) if (parents.next().getId() === PARTNERS.suppliersFolderId) inRoot = true;
    if (!inRoot || folder.getSharingAccess() !== DriveApp.Access.PRIVATE ||
        folder.getEditors().length || folder.getViewers().length) throw new Error('INVALID_PRIVATE_SUPPLIER_FOLDER');
    var name = materialId + '__' + String(telegramFile.file_name || 'document').replace(/[\\/\u0000-\u001f]/g,'_').slice(0,150);
    var existing = folder.getFilesByName(name);
    if (existing.hasNext()) {
      var found = existing.next();
      if (existing.hasNext() || found.getDescription() !== 'partners-material:' + materialId) throw new Error('FILE_KEY_CONFLICT');
      return found.getId();
    }
    var info = partnersTelegram_('getFile', {file_id: telegramFile.file_id});
    partnersValidateFile_(info);
    var path = info.file_path;
    if (typeof path !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').indexOf('..') >= 0) {
      throw new Error('INVALID_TELEGRAM_FILE_PATH');
    }
    var response = partnersFetch_('https://api.telegram.org/file/bot' + partnersToken_() + '/' + path, {muteHttpExceptions:true});
    if (response.getResponseCode() !== 200) throw new Error('TELEGRAM_FILE_DOWNLOAD_FAILED');
    var blob = response.getBlob();
    if (blob.getBytes().length > PARTNERS.maxFileBytes) throw new Error('FILE_TOO_LARGE_SEND_LINK');
    blob.setName(name);
    var saved = folder.createFile(blob);
    try { saved.setDescription('partners-material:' + materialId); }
    catch (_) { saved.setTrashed(true); throw new Error('FILE_METADATA_FAILED'); }
    return saved.getId();
  });
}

function partnersToken_() {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error('SET_TELEGRAM_BOT_TOKEN_IN_SCRIPT_PROPERTIES');
  return token;
}

/** Suppress native network exceptions because their URLs can contain the bot token. */
function partnersFetch_(url, options) {
  try { return UrlFetchApp.fetch(url, options); }
  catch (_) { throw new Error('TELEGRAM_NETWORK_ERROR'); }
}

function partnersTelegram_(method, data) {
  var allowed = ['getMe','getWebhookInfo','getFile','getUpdates','sendMessage','answerCallbackQuery'];
  if (allowed.indexOf(method) < 0) throw new Error('TELEGRAM_METHOD_NOT_ENABLED');
  var response = partnersFetch_('https://api.telegram.org/bot' + partnersToken_() + '/' + method, {
    method:'post', contentType:'application/json', payload:JSON.stringify(data), muteHttpExceptions:true
  });
  var body;
  try { body = JSON.parse(response.getContentText()); }
  catch (_) { throw new Error('TELEGRAM_INVALID_RESPONSE'); }
  if (response.getResponseCode() !== 200 || !body.ok) {
    throw new Error('TELEGRAM_API_ERROR_' + response.getResponseCode());
  }
  return body.result;
}

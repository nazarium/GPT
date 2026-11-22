import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=readFileSync(new URL('./Integration.gs',import.meta.url),'utf8');
function context(mocks={}) {
 const c=vm.createContext({console, ...mocks});
 vm.runInContext(source,c);
 return c;
}
test('download guard accepts missing size but rejects known oversized/invalid values',()=>{
 const c=context();
 c.partnersValidateFile_({file_id:'abc'});
 c.partnersValidateFile_({file_id:'abc',file_size:20000000});
 for(const file_size of [20000001,-1,1.2,'100']) assert.throws(()=>c.partnersValidateFile_({file_id:'abc',file_size}));
});
test('literal writer preserves IDs and escapes formula and leading apostrophe text',()=>{
 const c=context(); let format, written;
 const range={setNumberFormat:x=>format=x,setValues:x=>written=x};
 c.partnersWriteLiteral_(range,[['0000123','=IMPORTXML("https://example.invalid")',"'quoted",100,true,null]]);
 assert.equal(format,'@');
 assert.deepEqual(JSON.parse(JSON.stringify(written)),[['0000123',"'=IMPORTXML(\"https://example.invalid\")","''quoted",100,true,'']]);
 assert.throws(()=>c.partnersWriteLiteral_(range,[[{}]]),/INVALID_CELL_VALUE/);
});
test('token is mandatory and never embedded in source',()=>{
 const c=context({PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})}});
 assert.throws(()=>c.partnersToken_(),/SET_TELEGRAM_BOT_TOKEN/);
 assert.doesNotMatch(source,/\d{6,}:[A-Za-z0-9_-]{20,}/);
});
test('native fetch errors cannot leak token URLs',()=>{
 const c=context({UrlFetchApp:{fetch:()=>{throw Error('https://api.telegram.org/bot123:private-token/getMe');}}});
 assert.throws(()=>c.partnersFetch_('url',{}),e=>e.message==='TELEGRAM_NETWORK_ERROR');
});
test('unknown Telegram operations are disabled',()=>{
 assert.throws(()=>context().partnersTelegram_('deleteWebhook',{}),/METHOD_NOT_ENABLED/);
 assert.throws(()=>context().partnersTelegram_('setWebhook',{}),/METHOD_NOT_ENABLED/);
});
test('script lock is released after error and overlapping work is refused',()=>{
 let released=0;
 const c=context({LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>released++})}});
 assert.throws(()=>c.partnersWithLock_(()=>{throw Error('test');}),/test/);
 assert.equal(released,1);
 const busy=context({LockService:{getScriptLock:()=>({tryLock:()=>false})}});
 assert.throws(()=>busy.partnersWithLock_(()=>{}),/BUSY/);
});
test('supplier binding rejects another actor and duplicate IDs',()=>{
 const headers=context().PARTNERS.headers['Постачальники'];
 let records=[['supplier-1','123']];
 const sheet={getLastRow:()=>records.length+1,getRange:(row)=>({getValues:()=>row===1?[headers]:records})};
 const c=context({SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet})}});
 assert.equal(c.partnersOwnSupplier_('supplier-1','123')[0],'supplier-1');
 assert.throws(()=>c.partnersOwnSupplier_('supplier-1','456'),/NOT_ACCESSIBLE/);
 records.push(['supplier-1','123']);
 assert.throws(()=>c.partnersOwnSupplier_('supplier-1','123'),/NOT_ACCESSIBLE/);
});
test('wrong Google account is rejected before API or storage access',()=>{
 const c=context({Session:{getEffectiveUser:()=>({getEmail:()=> 'wrong@example.invalid'})}});
 assert.throws(()=>c.verifyConnection(),/WRONG_GOOGLE_ACCOUNT/);
});

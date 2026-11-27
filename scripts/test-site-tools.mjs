import {createHash} from 'node:crypto';
class TestDigestStream extends WritableStream {constructor(){let resolve,reject;const hash=createHash('sha256');const digest=new Promise((a,b)=>{resolve=a;reject=b;});super({write:chunk=>{hash.update(chunk);},close:()=>resolve(hash.digest()),abort:reject});this.digest=digest;digest.catch(()=>{});}}
Object.defineProperty(crypto,'DigestStream',{value:TestDigestStream});
async function snapshot(storage,secret,seeds=[]){const tasks=[];const response=snapshotResponse(storage,secret,async()=>seeds,task=>tasks.push(task));const data=await response.json();await Promise.all(tasks);return data;}
import assert from 'node:assert/strict';
import {snapshotResponse,restore} from '../cloudflare/site-backup.mjs';
import {defaultTools,validateTools} from '../cloudflare/site-tools.mjs';
const current=defaultTools();
assert.equal(validateTools({...current,revision:99},current),null);
assert.throws(()=>validateTools({...current,categories:{all:'All'}},current));
assert.throws(()=>validateTools({...current,analyticsToken:'bad'},current));
assert.throws(()=>validateTools({...current,categories:{residential:'Only'}},current));
assert.equal(validateTools({...current,categories:{...current.categories,custom:'Нова'}},current).categories.custom,'Нова');
class Storage{
 constructor(){this.data=new Map();}
 async list({limit=500,startAfter}={}){return new Map([...this.data].sort(([a],[b])=>a.localeCompare(b)).filter(([k])=>!startAfter||k>startAfter).slice(0,limit));}
 async put(k,v){this.data.set(k,structuredClone(v));}
 async delete(keys){for(const k of keys)this.data.delete(k);}
 async transaction(fn){const old=structuredClone(this.data);try{return await fn(this);}catch(e){this.data=old;throw e;}}
}
const source=new Storage();await source.put('photo:test',new Uint8Array([0,20,255]));await source.put('draft:project:1',{title:'Чернетка',revision:3});
for(let i=0;i<510;i++)await source.put('item:'+String(i).padStart(4,'0'),i);
const backup=await snapshot(source,'local-test-password',[['home-contacts',{phone:'test'}]]);
const target=new Storage();await target.put('obsolete',true);
await restore(target,'local-test-password',backup);
assert.equal(target.data.has('obsolete'),false);assert.deepEqual([...new Uint8Array(target.data.get('photo:test'))],[0,20,255]);assert.equal(target.data.get('draft:project:1').title,'Чернетка');assert.equal(target.data.size,513);
const before=structuredClone(target.data);
await assert.rejects(()=>restore(target,'wrong-password',backup));
await assert.rejects(()=>restore(target,'local-test-password',{...backup,payload:backup.payload+' '}));
assert.deepEqual(target.data,before);
console.log('Site tools checks passed: category validation, stale revision, paginated backup, binary photo, restore, tamper rejection');

// A backup above the old ceiling still uses the original format and restores binary data.
const large=new Storage();for(let i=0;i<140;i++)await large.put('photo:'+String(i).padStart(4,'0'),new Uint8Array(96*1024).fill(i%256));
const largeBackup=await snapshot(large,'local-test-password');
assert.ok(Buffer.byteLength(largeBackup.payload)>16*1024*1024);
const restoredLarge=new Storage();await restore(restoredLarge,'local-test-password',largeBackup);assert.equal(restoredLarge.data.size,140);assert.equal(new Uint8Array(restoredLarge.data.get('photo:0139'))[0],139);
console.log('Large backup restored: '+(Buffer.byteLength(largeBackup.payload)/1024/1024).toFixed(1)+' MiB payload.');
let changed=false;
const badResponse=snapshotResponse(source,'local-test-password',async()=>[],task=>task.catch(()=>{}),()=>{if(changed)throw Error('Concurrent edit');});
const reader=badResponse.body.getReader();await reader.read();changed=true;
await assert.rejects(async()=>{while(!(await reader.read()).done){}},/Concurrent edit/);
console.log('Concurrent edit aborts download instead of producing a mixed snapshot.');

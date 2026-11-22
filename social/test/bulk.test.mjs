import test from 'node:test';
import assert from 'node:assert/strict';
import {submitSelected,deliveryDisabledReason} from '../bulk.mjs';
test('bulk retains failed projects, removes successes immediately and does not resubmit them on retry',async()=>{
 const rows=['1','2','3'].map(id=>({id,active:true})),calls=[],selection=new Set(['1','2','3']);
 const first=await submitSelected([...selection],rows,async p=>{calls.push(p.id);if(p.id==='2')throw new Error('Server rejected');},id=>selection.delete(id));
 assert.deepEqual(first.succeeded,['1','3']);assert.deepEqual([...selection],['2']);assert.equal(first.failed[0].error,'Server rejected');
 await submitSelected([...selection],rows,async p=>calls.push(p.id),id=>selection.delete(id));assert.deepEqual(calls,['1','2','3','2']);assert.equal(selection.size,0);
});
test('bulk rejects hidden or missing projects and deduplicates selected IDs',async()=>{
 const calls=[],result=await submitSelected(['1','1','2','3'],[{id:'1',active:true},{id:'2',active:false}],async p=>calls.push(p.id));
 assert.deepEqual(calls,['1']);assert.equal(result.failed.length,2);
});
test('delivery control explains protected local mode, missing key and pending settings, while allowing live pause and resume',()=>{
 const data={live:false,environmentMode:'live',keyConfigured:true};assert.equal(deliveryDisabledReason(data,false,false),'');
 assert.match(deliveryDisabledReason({...data,environmentMode:'dry-run'},false,false),/Тестовий/);
 assert.match(deliveryDisabledReason({...data,keyConfigured:false},false,false),/Ключ/);
 assert.match(deliveryDisabledReason(data,false,true),/налаштувань/);
 assert.match(deliveryDisabledReason(data,true,false),/обробка/);
 assert.equal(deliveryDisabledReason({...data,live:true},false,false),'');
});

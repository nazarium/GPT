import test from 'node:test';
import assert from 'node:assert/strict';
import {describeConnection} from '../connection.mjs';
import {socialAdmin,verifyChannels} from '../engine.mjs';
import {database} from './helpers.mjs';
import {first} from '../store.mjs';
const mappings=[{id:'ig',platform:'instagram',mode:'automatic'},{id:'fb',platform:'facebook',mode:'automatic'},{id:'tt',platform:'tiktok',mode:'notification'}];
const rows=mappings.map(c=>({id:c.id,name:c.platform+' account',service:c.platform,type:c.platform==='facebook'?'page':'business',isDisconnected:false,isLocked:false,isQueuePaused:false,hasActiveMemberDevice:true}));
test('each platform reports account, connection, queue and mobile state independently',()=>{
 for(const channel of mappings){const info=describeConnection(channel,rows);assert.equal(info.state,'ok');assert.equal(info.account,channel.platform+' account');assert.match(info.queue,/не призупинена/);}
 assert.match(describeConnection(mappings[2],rows).mobile,/підключені/);
 assert.equal(describeConnection(mappings[0],[{...rows[0],isDisconnected:true}]).status,'Потрібне перепідключення в Buffer');
 assert.equal(describeConnection(mappings[1],[{...rows[1],isLocked:true}]).status,'Канал заблокований у Buffer');
 assert.equal(describeConnection(mappings[1],[{...rows[1],type:'profile'}]).state,'error');
 assert.equal(describeConnection(mappings[0],[{...rows[0],isQueuePaused:true}]).state,'warning');
 assert.match(describeConnection(mappings[2],[{...rows[2],hasActiveMemberDevice:false}]).mobile,/дозвольте/);
});
test('unverified, missing, mismapped and failed results never report an active connection',()=>{
 assert.equal(describeConnection(mappings[0],null).state,'unchecked');
 assert.equal(describeConnection(mappings[0],[]).status,'Канал відсутній у відповіді Buffer');
 assert.equal(describeConnection(mappings[0],[{...rows[0],service:'facebook'}]).state,'error');
 assert.equal(describeConnection(mappings[0],rows,'Network error').status,'Стан з’єднання невідомий');
});
test('diagnostic endpoint returns all three channels even when one is disconnected, and never activates delivery',async()=>{
 const db=database(),original=globalThis.fetch,requests=[],remote=[{...rows[0],isDisconnected:true},rows[1],{...rows[2],hasActiveMemberDevice:false}];
 const env={SOCIAL_DB:db,SOCIAL_MODE:'live',BUFFER_API_KEY:'not-a-real-key',BUFFER_ORGANIZATION_ID:'org',BUFFER_CHANNELS:JSON.stringify(mappings)};
 globalThis.fetch=async(url,init)=>{const body=JSON.parse(init.body);requests.push(body);return Response.json({data:{channels:remote}});};
 try {
  const response=await socialAdmin(new Request('https://example.com/api/admin/social/channels'),env,async()=>[]);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),remote);assert.ok(requests.every(body=>body.query.startsWith('query Channels')));
  assert.equal((await first(db,"SELECT value FROM social_meta WHERE key='live'")).value,'0');
  await assert.rejects(verifyChannels(env),/unavailable/); // actual delivery remains protected
 }finally{globalThis.fetch=original;db.close();}
});

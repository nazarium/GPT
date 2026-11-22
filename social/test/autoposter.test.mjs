import test from 'node:test';
import assert from 'node:assert/strict';
import { database,raw,channel,imageResponse,png } from './helpers.mjs';
import { normalizeCatalog,fingerprint,buildPost,archiveSlot,channels } from '../catalog.mjs';
import { all,first,run,syncCatalog,releaseProjects,markReady,claim } from '../store.mjs';
import { dispatchOne,tick,storedState,socialAdmin,verifyChannels } from '../engine.mjs';
import { BufferFailure,bufferRequest,retryAt } from '../buffer.mjs';
import { dimensions,inspectImage } from '../media.mjs';

async function setup(items=[raw()]) {
  const db=database(),catalog=normalizeCatalog(items),now=Date.parse('2026-11-17T08:00:00Z');
  await syncCatalog(db,catalog,now);
  for(const p of catalog) await markReady(db,p.id,await fingerprint(p),{},now);
  await releaseProjects(db,'2026-11-17',now,[channel]);
  const env={SOCIAL_DB:db,SOCIAL_MODE:'live',BUFFER_API_KEY:'test-secret',BUFFER_CHANNELS:JSON.stringify([channel])};
  await run(db,"UPDATE social_meta SET value='1' WHERE key='live'");
  return {db,catalog,env,now,getCatalog:async()=>items};
}

test('initial catalog is archive; subsequent new projects are not automatically ready',async()=>{
  const db=database();await syncCatalog(db,normalizeCatalog([raw()]),1);
  await syncCatalog(db,normalizeCatalog([raw(),raw('456','02')]),2);
  assert.equal((await first(db,"SELECT kind FROM social_projects WHERE id='123'")).kind,'archive');
  assert.deepEqual({...await first(db,"SELECT kind,ready_hash FROM social_projects WHERE id='456'")},{kind:'new',ready_hash:null});
  db.close();
});
test('archive slot selects one project and repeated or concurrent invocations do not duplicate',async()=>{
  const {db,catalog,now}=await setup([raw(),raw('456','02')]);
  await Promise.all([releaseProjects(db,'2026-11-17',now,[channel]),releaseProjects(db,'2026-11-17',now,[channel])]);
  assert.equal((await all(db,'SELECT * FROM social_slots')).length,1);
  assert.equal((await all(db,'SELECT * FROM social_publications')).length,1);
  await releaseProjects(db,'2026-11-20',now,[channel]);assert.equal((await all(db,'SELECT * FROM social_publications')).length,2);db.close();
});
test('new ready project releases without waiting for archive slot',async()=>{
  const {db,now}=await setup();const p=normalizeCatalog([raw('456','02')])[0];
  await syncCatalog(db,normalizeCatalog([raw(),raw('456','02')]),now);
  await markReady(db,p.id,await fingerprint(p),{},now);await releaseProjects(db,null,now,[channel]);
  assert.equal((await all(db,'SELECT * FROM social_publications')).length,2);db.close();
});
test('content edits revoke readiness; missing projects become inactive; stale ready fails',async()=>{
  const {db,catalog,now}=await setup();
  const changed=normalizeCatalog([{...raw(),title:'Змінений'}]);await syncCatalog(db,changed,now+1);
  assert.equal((await first(db,'SELECT ready_hash FROM social_projects')).ready_hash,null);
  await assert.rejects(markReady(db,'123',await fingerprint(catalog[0]),{},now));
  await syncCatalog(db,[],now+2);assert.equal((await first(db,'SELECT active FROM social_projects')).active,0);db.close();
});
test('atomic claim allows only one sender; per-platform states remain independent',async()=>{
  const {db,now}=await setup();await releaseProjects(db,null,now,[{platform:'facebook',id:'fb'}]);
  const r=await Promise.all([claim(db,'123','instagram','a',{},now),claim(db,'123','instagram','b',{},now)]);
  assert.equal(r.filter(Boolean).length,1);assert.equal((await first(db,"SELECT state FROM social_publications WHERE platform='facebook'")).state,'pending');db.close();
});
test('dry run makes no Buffer requests and does not claim a publication',async()=>{
  const {db,env,now,getCatalog}=await setup();env.SOCIAL_MODE='dry-run';let calls=0;
  assert.equal((await dispatchOne(env,getCatalog,now,async()=>{calls++;throw Error();})).mode,'dry-run');
  assert.equal(calls,0);assert.equal((await first(db,'SELECT state FROM social_publications')).state,'pending');db.close();
});
test('success stores Buffer id and sent state; next run cannot resubmit',async()=>{
  const {db,env,now,getCatalog}=await setup();let mutations=0;
  const fetcher=async(url,options)=>{
    if(url.startsWith('https://archi-create.com.ua')) return imageResponse();
    assert.equal(options.headers.Authorization,'Bearer test-secret');mutations++;
    const input=JSON.parse(options.body).variables.input;assert.equal(input.needsApproval,false);assert.equal(input.assets.length,1);
    return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'post-1',status:'sent',schedulingType:'automatic',externalLink:'https://instagram.com/p/abc/'}}}});
  };
  assert.equal((await dispatchOne(env,getCatalog,now,fetcher)).mode,'sent');
  assert.equal((await dispatchOne(env,getCatalog,now,fetcher)).mode,'idle');assert.equal(mutations,1);
  assert.equal((await first(db,'SELECT buffer_id FROM social_publications')).buffer_id,'post-1');db.close();
});
test('network timeout after mutation enters uncertain; never blindly retries',async()=>{
  const {db,env,now,getCatalog}=await setup();let calls=0;
  const fetcher=async(url)=>{if(url.startsWith('https://archi-create.com.ua'))return imageResponse();calls++;throw Error('timeout with secret');};
  assert.equal((await dispatchOne(env,getCatalog,now,fetcher)).mode,'uncertain');
  assert.equal((await dispatchOne(env,getCatalog,now+999999,fetcher)).mode,'idle');assert.equal(calls,1);
  assert.doesNotMatch((await first(db,'SELECT error FROM social_publications')).error,/secret/);db.close();
});
test('429 respects Retry-After and only retries rejected requests',async()=>{
  const {db,env,now,getCatalog}=await setup();let mutations=0;
  const fetcher=async(url)=>{if(url.startsWith('https://archi-create.com.ua'))return imageResponse();mutations++;return new Response('',{status:429,headers:{'Retry-After':'7200'}});};
  assert.equal((await dispatchOne(env,getCatalog,now,fetcher)).mode,'retry');
  assert.equal((await first(db,'SELECT next_attempt FROM social_publications')).next_attempt,now+7200000);
  assert.equal((await dispatchOne(env,getCatalog,now+3600000,fetcher)).mode,'idle');assert.equal(mutations,1);db.close();
});
test('5xx and GraphQL execution errors are ambiguous, not automatic retries',async()=>{
  for(const response of [new Response('',{status:500}),Response.json({errors:[{message:'internal'}]})])
    await assert.rejects(bufferRequest({BUFFER_API_KEY:'x'},'mutation',{},async()=>response),e=>e instanceof BufferFailure&&e.kind==='uncertain');
});
test('notification sent is a manual task, not proof of publication',()=>{
  assert.equal(storedState({status:'sent',schedulingType:'notification'}),'manual_required');
  assert.equal(storedState({status:'error',schedulingType:'automatic'}),'failed');
});
test('large galleries default to first ten for Facebook; explicit selection is preserved',()=>{
  const p=normalizeCatalog([{...raw(),images:Array.from({length:18},(_,i)=>`assets/projects/123/${i}.png`)}])[0];
  const fb={platform:'facebook',id:'fb',mode:'automatic'};
  assert.deepEqual(buildPost(p,fb).images,p.images.slice(0,10));assert.equal(buildPost(p,fb).issues.length,0);
  assert.deepEqual(buildPost(p,{platform:'tiktok',id:'tt',mode:'notification'}).images,p.images.slice(0,10));
  assert.equal(buildPost(p,channel).images.length,18);
  assert.ok(buildPost(p,fb,{facebook:p.images.map((_,i)=>i)}).issues.length);
  const plan=buildPost(p,fb,{facebook:[0,2,4]});assert.equal(plan.images.length,3);assert.equal(plan.issues.length,0);
  assert.throws(()=>buildPost(p,fb,{facebook:[99]}));
});
test('Instagram ratio validation is exact and caption is never fabricated',()=>{
  const p=normalizeCatalog([raw()])[0];p.description='';
  assert.equal(buildPost(p,channel,{},[{url:p.images[0],width:1200,height:628,size:100}]).issues.length,1);
  assert.equal(buildPost(p,channel,{},[{url:p.images[0],width:1200,height:629,size:100}]).issues.length,0);
  assert.doesNotMatch(buildPost(p,channel).input.text,/Опис із сайту/);
});
test('Kyiv schedule handles winter and summer DST, never fires on other days',()=>{
  assert.equal(archiveSlot(Date.parse('2026-11-17T08:00:00Z')),'2026-11-17');
  assert.equal(archiveSlot(Date.parse('2026-07-14T07:00:00Z')),'2026-07-14');
  assert.equal(archiveSlot(Date.parse('2026-11-17T07:00:00Z')),null);
  assert.equal(archiveSlot(Date.parse('2026-11-18T08:00:00Z')),null);
});
test('reject foreign photos, duplicate projects and unverified TikTok automatic mode',()=>{
  assert.throws(()=>normalizeCatalog([{...raw(),images:['https://evil.test/a.jpg']}]));
  assert.throws(()=>normalizeCatalog([raw(),raw()]));
  assert.throws(()=>channels({BUFFER_CHANNELS:JSON.stringify([{platform:'tiktok',id:'tt',mode:'automatic'}])}));
});
test('image header inspection supports PNG, rejects non-images, bounds downloads',async()=>{
  assert.deepEqual(dimensions(png()),{width:1000,height:800,format:'png'});
  assert.equal((await inspectImage('https://archi-create.com.ua/a.png',async()=>imageResponse())).size,40);
  await assert.rejects(inspectImage('https://archi-create.com.ua/a.png',async()=>new Response('<html>',{headers:{'Content-Type':'text/html'}})));
});
test('activation requires explicit approval; pause leaves a visible warning',async()=>{
  const {db,env,getCatalog}=await setup();env.SOCIAL_MODE='dry-run';
  const make=(action,data)=>new Request('https://archi-create.com.ua/api/admin/social/'+action,{method:'POST',body:JSON.stringify(data)});
  assert.equal((await socialAdmin(make('activate',{confirm:'APPROVE_FIRST_PUBLICATION'}),env,getCatalog)).status,400);
  const paused=await socialAdmin(make('pause',{}),env,getCatalog);assert.match((await paused.json()).warning,/Already scheduled/);
  assert.equal((await first(db,"SELECT value FROM social_meta WHERE key='live'")).value,'0');db.close();
});
test('failure to save a successful Buffer response leaves a non-retryable durable attempt',async()=>{
  const {db,env,now,getCatalog}=await setup();let calls=0;
  const fetcher=async url=>{
    if(url.startsWith('https://archi-create.com.ua'))return imageResponse();calls++;
    return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'remote-created',status:'scheduled',schedulingType:'automatic'}}}});
  };
  const originalBatch=db.batch;db.batch=async()=>{throw Error('database interruption');};
  await assert.rejects(dispatchOne(env,getCatalog,now,fetcher));db.batch=originalBatch;
  assert.equal((await first(db,'SELECT state FROM social_publications')).state,'sending');
  assert.equal((await dispatchOne(env,getCatalog,now+999999,fetcher)).mode,'idle');assert.equal(calls,1);
  env.SOCIAL_MODE='dry-run';await tick(env,getCatalog,now+11*60000,fetcher);
  assert.equal((await first(db,'SELECT state FROM social_publications')).state,'uncertain');db.close();
});
test('changed or hidden project after media checks is not submitted',async()=>{
  const {db,env,now}=await setup();let calls=0;
  const result=await dispatchOne(env,async()=>[],now,async url=>{if(url.startsWith('https://archi-create.com.ua'))return imageResponse();calls++;throw Error();});
  assert.equal(result.mode,'changed');assert.equal(calls,0);assert.equal((await first(db,'SELECT state FROM social_publications')).state,'pending');db.close();
});
test('tick lock prevents overlapping sync and dispatch work',async()=>{
  const {db,env,now}=await setup();await run(db,"INSERT INTO social_locks VALUES('tick','owner',?)",now+60000);
  const result=await tick(env,async()=>{throw Error('must not read catalog');},now);
  assert.equal(result.mode,'locked');db.close();
});
test('D1-style batch rolls back all statements on constraint failure',async()=>{
  const db=database();await assert.rejects(db.batch([
    db.prepare("UPDATE social_meta SET value='1' WHERE key='live'"),
    db.prepare("INSERT INTO social_meta VALUES('live','duplicate')"),
  ]));
  assert.equal((await first(db,"SELECT value FROM social_meta WHERE key='live'")).value,'0');db.close();
});


test('Buffer requests use Workers-compatible manual redirects and never follow credentials',async()=>{
  let calls=0;
  await assert.rejects(bufferRequest({BUFFER_API_KEY:' test-secret '},'query Channels',{},async(url,options)=>{
    calls++;assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer test-secret');
    return new Response('',{status:302,headers:{Location:'https://other.invalid/'}});
  }),e=>e.kind==='blocked' && /not forwarded/.test(e.message));
  assert.equal(calls,1);
});
test('read connection failures are safe to retry; mutation outcomes remain uncertain',async()=>{
  for(const [query,kind] of [['query Channels','retry'],['mutation CreatePost','uncertain']]) {
    await assert.rejects(bufferRequest({BUFFER_API_KEY:'x'},query,{},async()=>{throw Error('network');}),e=>e.kind===kind);
  }
});
test('invalid copied key is rejected before fetch without exposing it',async()=>{
  let calls=0;
  await assert.rejects(bufferRequest({BUFFER_API_KEY:'secret\ninvalid'},'query Channels',{},async()=>{calls++;}),e=>e.kind==='blocked' && !e.message.includes('secret\ninvalid'));
  assert.equal(calls,0);
});


test('channel discovery succeeds without mobile device; activation still requires notification setup',async()=>{
  const env={BUFFER_API_KEY:'test',BUFFER_ORGANIZATION_ID:'org',BUFFER_CHANNELS:JSON.stringify([{platform:'tiktok',id:'tt',mode:'notification'}])};
  const fetcher=async()=>Response.json({data:{channels:[{id:'tt',service:'tiktok',hasActiveMemberDevice:false,isDisconnected:false,isLocked:false,isQueuePaused:false}]}});
  assert.equal((await verifyChannels(env,fetcher,false)).length,1);
  await assert.rejects(verifyChannels(env,fetcher),/Register Buffer mobile notifications/);
});

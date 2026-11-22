import test from 'node:test';
import assert from 'node:assert/strict';
import {database,raw,channel,imageResponse} from './helpers.mjs';
import {defaults,validateSettings,saveSettings,readSettings,runtimeEnv,applyCaption} from '../settings.mjs';
import {normalizeCatalog,fingerprint,buildPost,archiveSlot} from '../catalog.mjs';
import {syncCatalog,markReady,releaseProjects,first,run} from '../store.mjs';
import {management} from '../management.mjs';
test('settings save is revisioned, pauses delivery and revokes readiness without deleting drafts',async()=>{
 const db=database(),p=normalizeCatalog([raw()])[0];await syncCatalog(db,[p],1);await markReady(db,p.id,await fingerprint(p),{},1);
 await run(db,"UPDATE social_meta SET value='1' WHERE key='live'");
 await run(db,"INSERT INTO social_drafts(project_id,platform,buffer_id,state,fingerprint,updated_at) VALUES('123','instagram','existing','draft',?,1)",await fingerprint(p));
 const saved=await saveSettings(db,{...defaults(),archiveDays:[1,4],archiveMinute:30}, {},2);
 assert.equal(saved.revision,1);assert.deepEqual((await readSettings(db)).archiveDays,[1,4]);
 assert.equal((await first(db,"SELECT value FROM social_meta WHERE key='live'")).value,'0');
 assert.equal((await first(db,'SELECT ready_hash FROM social_projects')).ready_hash,null);
 assert.equal((await first(db,'SELECT buffer_id FROM social_drafts')).buffer_id,'existing');
 await assert.rejects(saveSettings(db,defaults()),/іншій вкладці/);db.close();
});
test('concurrent settings saves cannot overwrite a newer revision',async()=>{
 const db=database();const result=await Promise.allSettled([saveSettings(db,{...defaults(),archiveHour:9}),saveSettings(db,{...defaults(),archiveHour:11})]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await readSettings(db)).revision,1);db.close();
});
test('settings reject unsupported schedules, modes, templates and platform caps',()=>{
 for(const change of [{timezone:'Invalid/Zone'},{archiveDays:[]},{archiveMinute:7},{retryLimit:6},{captionTemplate:'{unknown}'},{platforms:{...defaults().platforms,facebook:{enabled:true,mode:'automatic',maxPhotos:11}}},{platforms:{...defaults().platforms,tiktok:{enabled:true,mode:'automatic',maxPhotos:10}}}])assert.throws(()=>validateSettings({...defaults(),...change}));
});
test('effective mapping honors enabled platforms and saved notification mode',()=>{
 const env={BUFFER_CHANNELS:JSON.stringify([channel,{platform:'facebook',id:'fb',mode:'automatic'}])};
 const s=defaults();s.platforms.instagram.enabled=false;s.platforms.facebook.mode='notification';
 assert.deepEqual(JSON.parse(runtimeEnv(env,s).BUFFER_CHANNELS),[{platform:'facebook',id:'fb',mode:'notification'}]);
});
test('quarter-hour archive slots use selected timezone and days',()=>{
 assert.equal(archiveSlot(Date.parse('2026-11-16T08:30:00Z'),10,[1],'Europe/Kyiv',30),'2026-11-16');
 assert.equal(archiveSlot(Date.parse('2026-11-16T08:15:00Z'),10,[1],'Europe/Kyiv',30),null);
 assert.equal(archiveSlot(Date.parse('2026-07-13T07:30:00Z'),10,[1],'Europe/Kyiv',30),'2026-07-13');
});
test('caption template and lower photo limit affect the real plan without dropping photos',()=>{
 const p=normalizeCatalog([{...raw(),images:['assets/projects/123/1.png','assets/projects/123/2.png']}])[0];
 const s=defaults();s.captionTemplate='{title}\n{url}';s.platforms.instagram.maxPhotos=1;
 const plan=applyCaption(buildPost(p,channel),p,s);
 assert.equal(plan.images.length,2);assert.ok(plan.issues.some(i=>i.includes('ліміт')));assert.equal(plan.input.saveToDraft,true);assert.equal(plan.input.text,p.title+'\n'+p.url);
});
test('archive release skips existing Buffer drafts for the same project and platform',async()=>{
 const db=database(),p=normalizeCatalog([raw()])[0];await syncCatalog(db,[p],1);await markReady(db,p.id,await fingerprint(p),{},1);
 await run(db,"INSERT INTO social_drafts(project_id,platform,buffer_id,state,fingerprint,updated_at) VALUES('123','instagram','old','draft',?,1)",await fingerprint(p));
 await releaseProjects(db,'2026-11-17',1,[channel]);
 assert.equal(await first(db,'SELECT * FROM social_publications'),null);db.close();
});
test('new projects respect disable switch and first-seen delay',async()=>{
 const db=database();await syncCatalog(db,[],1);const p=normalizeCatalog([raw()])[0];await syncCatalog(db,[p],1000);await markReady(db,p.id,await fingerprint(p),{},1000);
 await releaseProjects(db,null,1001,[channel],{newProjectsEnabled:false});assert.equal(await first(db,'SELECT * FROM social_publications'),null);
 await releaseProjects(db,null,1001,[channel],{newProjectDelayHours:1});assert.equal(await first(db,'SELECT * FROM social_publications'),null);
 await releaseProjects(db,null,3601000,[channel],{newProjectDelayHours:1});assert.ok(await first(db,'SELECT * FROM social_publications'));db.close();
});
test('dashboard contains public project data and never includes the secret value',async()=>{
 const db=database();await syncCatalog(db,normalizeCatalog([raw()]),1);const env={SOCIAL_DB:db,BUFFER_API_KEY:'private-test-key',BUFFER_CHANNELS:JSON.stringify([channel]),SOCIAL_MODE:'dry-run'};
 const r=await management(new Request('https://example.com/api/admin/social/dashboard'),env,async()=>[raw()],r=>r.json());
 assert.equal(r.status,200);const text=await r.text();assert.equal(text.includes('private-test-key'),false);assert.equal(JSON.parse(text).projects.length,1);db.close();
});
test('manual create always saves to draft and a repeated click reuses the same Buffer id',async()=>{
 const db=database(),p=normalizeCatalog([raw()])[0];await syncCatalog(db,[p],1);
 const env={SOCIAL_DB:db,BUFFER_API_KEY:'test-only',BUFFER_CHANNELS:JSON.stringify([channel]),SOCIAL_MODE:'dry-run'};
 const original=globalThis.fetch;let mutations=0;
 globalThis.fetch=async(url,init)=>{
   if(url.startsWith('https://archi-create.com.ua'))return imageResponse();
   assert.equal(url,'https://api.buffer.com');mutations++;
   const input=JSON.parse(init.body).variables.input;assert.equal(input.saveToDraft,true);
   return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'draft-123',status:'draft',schedulingType:'automatic'}}}});
 };
 try {
   const make=async()=>new Request('https://example.com/api/admin/social/draft',{method:'POST',body:JSON.stringify({id:p.id,platform:'instagram',fingerprint:await fingerprint(p),settingsRevision:0,selection:{},dueAt:'2026-11-17T08:00:00Z',saveToDraft:false})});
   const one=await management(await make(),env,async()=>[raw()],r=>r.json());assert.equal(one.status,200);
   const two=await management(await make(),env,async()=>[raw()],r=>r.json());assert.equal((await two.json()).existing,true);assert.equal(mutations,1);
   assert.equal((await first(db,'SELECT state FROM social_drafts')).state,'draft');
   assert.equal((await first(db,"SELECT value FROM social_meta WHERE key='live'")).value,'0');
 }finally{globalThis.fetch=original;db.close();}
});

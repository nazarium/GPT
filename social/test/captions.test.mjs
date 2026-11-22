import test from 'node:test';
import assert from 'node:assert/strict';
import {database,raw,imageResponse} from './helpers.mjs';
import {normalizeCatalog,fingerprint} from '../catalog.mjs';
import {defaults} from '../settings.mjs';
import {syncCatalog,releaseProjects,first,run} from '../store.mjs';
import {socialAdmin,dispatchOne} from '../engine.mjs';
import {management} from '../management.mjs';
import {validateCaptions} from '../captions.mjs';
const mappings=[{platform:'instagram',id:'ig',mode:'automatic'},{platform:'facebook',id:'fb',mode:'automatic'},{platform:'tiktok',id:'tt',mode:'notification'}];

test('caption validation preserves exact platform text including empty captions and rejects wrong types and limits',()=>{
 assert.deepEqual(validateCaptions({instagram:'  Індивідуальний\nпідпис  ',facebook:'',tiktok:'TikTok'}),{instagram:'  Індивідуальний\nпідпис  ',facebook:'',tiktok:'TikTok'});
 assert.throws(()=>validateCaptions({instagram:'x'.repeat(2197)}),/ліміт/);
 assert.throws(()=>validateCaptions({unknown:'text'}),/платформи/);
 assert.throws(()=>validateCaptions({facebook:12}),/платформи/);
});
test('shared description, edited title and date reach all three drafts; repeat restores individual descriptions',async()=>{
 const db=database(),p=normalizeCatalog([raw()])[0],hash=await fingerprint(p),settings={...defaults(),archiveEnabled:false,allowRepeatDrafts:true};
 await syncCatalog(db,[p],1);assert.equal((await first(db,'SELECT ready_hash FROM social_projects')).ready_hash,null);
 await run(db,"INSERT INTO social_meta(key,value) VALUES('settings',?)",JSON.stringify(settings));
 await run(db,"UPDATE social_meta SET value='1' WHERE key='live'");
 const env={SOCIAL_DB:db,SOCIAL_MODE:'live',BUFFER_API_KEY:'test',BUFFER_ORGANIZATION_ID:'org',BUFFER_CHANNELS:JSON.stringify(mappings)};
 const original=globalThis.fetch,inputs=[];
 globalThis.fetch=async(url,init)=>{
  if(String(url).startsWith('https://archi-create.com.ua'))return imageResponse();
  const b=JSON.parse(init.body);
  if(b.query.includes('query Channels'))return Response.json({data:{channels:mappings.map(c=>({...c,service:c.platform,type:c.platform==='facebook'?'page':'business',hasActiveMemberDevice:true}))}});
  inputs.push(b.variables.input);return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'draft-'+inputs.length,status:'draft',schedulingType:b.variables.input.schedulingType}}}});
 };
 const submit=async (captions,options)=>socialAdmin(new Request('https://example.com/api/admin/social/submit',{method:'POST',body:JSON.stringify({id:p.id,fingerprint:hash,settingsRevision:0,selection:{},captions,options})}),env,async()=>[raw()]);
 try {
  const captions={instagram:'Текст Instagram',facebook:'Окремий текст Facebook',tiktok:'Текст TikTok'};
  const options={title:'Нова назва',composeTitle:true,useCommonCaption:true,commonCaption:'Спільний опис',useCommonTags:true,commonTags:'архітектура, #Дизайн архітектура',platformTags:{instagram:'інстаграм',facebook:'фейсбук',tiktok:'тікток'},dueAt:'2026-11-20T08:00:00.000Z'};
  assert.equal((await submit(captions,options)).status,200);
  await releaseProjects(db,null,2,mappings,settings);
  for(let i=0;i<3;i++)await dispatchOne(env,async()=>[raw()],3+i);
  assert.deepEqual(Object.fromEntries(inputs.map(v=>[v.channelId,v.text])),{ig:'Нова назва\n\nСпільний опис\n\n#архітектура #Дизайн',fb:'Нова назва\n\nСпільний опис\n\n#архітектура #Дизайн',tt:'Нова назва\n\nСпільний опис\n\n#архітектура #Дизайн'});
  assert.ok(inputs.every(v=>v.saveToDraft===true&&v.dueAt===options.dueAt));
  assert.equal(inputs.find(v=>v.channelId==='tt').metadata.tiktok.title,options.title);
  assert.deepEqual(JSON.parse((await first(db,'SELECT options FROM social_projects')).options),options);
  await syncCatalog(db,[p],10);assert.deepEqual(JSON.parse((await first(db,'SELECT captions FROM social_projects')).captions),captions);
  assert.equal((await submit({...captions,instagram:'Новий Instagram'},{...options,useCommonCaption:false,useCommonTags:false})).status,200);
  await releaseProjects(db,null,11,mappings,settings);
  for(let i=0;i<3;i++)await dispatchOne(env,async()=>[raw()],12+i);
  assert.equal(inputs.findLast(v=>v.channelId==='tt').text,'Нова назва\n\n'+captions.tiktok+'\n\n#тікток');
  assert.equal(inputs.length,6);assert.equal(inputs.findLast(v=>v.channelId==='ig').text,'Нова назва\n\nНовий Instagram\n\n#інстаграм');
  assert.equal(inputs.findLast(v=>v.channelId==='fb').text,'Нова назва\n\n'+captions.facebook+'\n\n#фейсбук');
  assert.equal((await first(db,'SELECT payload FROM social_projects')).payload,JSON.stringify(p));
 }finally{globalThis.fetch=original;db.close();}
});
test('invalid custom caption cannot mark the project for delivery',async()=>{
 const db=database(),p=normalizeCatalog([raw()])[0];await syncCatalog(db,[p],1);
 const env={SOCIAL_DB:db,SOCIAL_MODE:'live',BUFFER_CHANNELS:JSON.stringify(mappings)};
 const response=await socialAdmin(new Request('https://example.com/api/admin/social/submit',{method:'POST',body:JSON.stringify({id:p.id,fingerprint:await fingerprint(p),settingsRevision:0,captions:{instagram:'x'.repeat(2197)}})}),env,async()=>[raw()]);
 assert.equal(response.status,400);assert.equal((await first(db,'SELECT ready_hash FROM social_projects')).ready_hash,null);db.close();
});
test('manual draft receives its edited caption instead of the site description',async()=>{
 const db=database(),p=normalizeCatalog([raw()])[0];await syncCatalog(db,[p],1);
 const env={SOCIAL_DB:db,BUFFER_API_KEY:'test',BUFFER_CHANNELS:JSON.stringify([mappings[0]])},original=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{
  if(String(url).startsWith('https://archi-create.com.ua'))return imageResponse();
  const v=JSON.parse(init.body).variables.input;assert.equal(v.text,'Власний опис');assert.equal(v.saveToDraft,true);
  return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'manual-caption',status:'draft'}}}});
 };
 try {
  const response=await management(new Request('https://example.com/api/admin/social/draft',{method:'POST',body:JSON.stringify({id:p.id,platform:'instagram',fingerprint:await fingerprint(p),settingsRevision:0,selection:{},captions:{instagram:'Власний опис'},dueAt:'2026-11-15T08:00:00Z'})}),env,async()=>[raw()],r=>r.json());
  assert.equal(response.status,200);assert.equal(JSON.parse((await first(db,'SELECT payload FROM social_drafts')).payload).text,'Власний опис');assert.equal(JSON.parse((await first(db,'SELECT captions FROM social_projects')).captions).instagram,'Власний опис');
 }finally{globalThis.fetch=original;db.close();}
});

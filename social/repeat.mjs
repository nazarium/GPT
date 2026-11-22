import {all,first,run,query} from './store.mjs';

export async function prepareRepeatDrafts(env,project,hash,selection,settings,now=Date.now(),captions,options) {
 if(!settings.allowRepeatDrafts||settings.deliveryMode!=='draft')throw new Error('Повторна передача чернеток вимкнена в налаштуваннях');
 const db=env.SOCIAL_DB,token=crypto.randomUUID(),platforms=JSON.parse(env.BUFFER_CHANNELS||'[]').map(c=>c.platform),encoded=JSON.stringify(platforms);
 const lock=await run(db,"INSERT INTO social_locks(name,token,expires_at) VALUES('tick',?,?) ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE social_locks.expires_at<?",token,now+60000,now);
 if(!lock.meta.changes)throw new Error('Черга зараз обробляється. Повторіть дію після завершення поточної передачі.');
 try {
  const current=await first(db,'SELECT * FROM social_projects WHERE id=?',project.id);
  if(!current?.active||current.fingerprint!==hash)throw new Error('Проєкт змінився; оновіть перегляд');
  const publications=await all(db,'SELECT * FROM social_publications WHERE project_id=? AND platform IN (SELECT value FROM json_each(?))',project.id,encoded);
  const drafts=await all(db,'SELECT * FROM social_drafts WHERE project_id=? AND platform IN (SELECT value FROM json_each(?))',project.id,encoded);
  if(publications.some(p=>['sending','uncertain'].includes(p.state))||drafts.some(d=>['saving','uncertain'].includes(d.state)))throw new Error('Попередня передача ще виконується або її результат невідомий. Спочатку звірте Buffer.');
  await db.batch([
   query(db,"INSERT INTO social_events(project_id,event,detail,created_at) VALUES(?,'repeat_drafts_requested',?,?)",project.id,JSON.stringify({publications,drafts,platforms}),now),
   query(db,'DELETE FROM social_publications WHERE project_id=? AND platform IN (SELECT value FROM json_each(?))',project.id,encoded),
   query(db,'DELETE FROM social_drafts WHERE project_id=? AND platform IN (SELECT value FROM json_each(?))',project.id,encoded),
   query(db,'UPDATE social_projects SET ready_hash=fingerprint,selection=?,captions=COALESCE(?,captions),options=COALESCE(?,options),released_at=? WHERE id=? AND fingerprint=? AND active=1',JSON.stringify(selection),captions===undefined?null:JSON.stringify(captions),options===undefined?null:JSON.stringify(options),now,project.id,hash),
  ]);
  return {repeat:true,previousDrafts:drafts.length};
 }finally{await run(db,"DELETE FROM social_locks WHERE name='tick' AND token=?",token);}
}

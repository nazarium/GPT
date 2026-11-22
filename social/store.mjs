import { fingerprint } from './catalog.mjs';

export const query = (db, sql, ...args) => db.prepare(sql).bind(...args);
export const all = async (db, sql, ...args) => (await query(db, sql, ...args).all()).results;
export const first = (db, sql, ...args) => query(db, sql, ...args).first();
export const run = (db, sql, ...args) => query(db, sql, ...args).run();
export async function event(db, projectId, platform, name, detail, now) {
  await run(db, 'INSERT INTO social_events(project_id,platform,event,detail,created_at) VALUES(?,?,?,?,?)', projectId, platform, name, detail, now);
}

export async function syncCatalog(db, projects, now) {
  const rows = await Promise.all(projects.map(async(p,i) => [p.id,JSON.stringify(p),await fingerprint(p),Number(p.number) || i,now,now]));
  const statements = [query(db, 'UPDATE social_projects SET active=0 WHERE active=1')];
  // Six bindings per row, below D1's bound-parameter limit. One batch transaction.
  for (let i=0; i<rows.length; i+=10) {
    const chunk=rows.slice(i,i+10);
    statements.push(query(db, `INSERT INTO social_projects(id,payload,fingerprint,queue_order,first_seen,updated_at,kind)
      VALUES ${chunk.map(()=>`(?,?,?,?,?,?,CASE WHEN (SELECT value FROM social_meta WHERE key='initialized')='0' THEN 'archive' ELSE 'new' END)`).join(',')}
      ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,fingerprint=excluded.fingerprint,
      ready_hash=CASE WHEN social_projects.fingerprint=excluded.fingerprint THEN social_projects.ready_hash ELSE NULL END,
      queue_order=excluded.queue_order,active=1,updated_at=excluded.updated_at`, ...chunk.flat()));
  }
  statements.push(query(db, "UPDATE social_meta SET value='1' WHERE key='initialized'"));
  await db.batch(statements);
}

export async function releaseProjects(db, slot, now, channelList, settings={}) {
  const statements = [];
  if (settings.archiveEnabled===false) {
    statements.push(query(db, "UPDATE social_projects SET released_at=? WHERE active=1 AND ready_hash=fingerprint AND kind='archive' AND released_at IS NULL",now));
  } else if (slot) {
    statements.push(query(db, `INSERT OR IGNORE INTO social_slots(slot,project_id)
      SELECT ?,id FROM social_projects WHERE active=1 AND ready_hash=fingerprint AND kind='archive' AND released_at IS NULL
      ORDER BY queue_order ${settings.archiveOrder==='newest'?'DESC':'ASC'},id LIMIT 1`,slot));
    statements.push(query(db, `UPDATE social_projects SET released_at=? WHERE id=(SELECT project_id FROM social_slots WHERE slot=?) AND released_at IS NULL`, now,slot));
  }
  if(settings.newProjectsEnabled!==false)statements.push(query(db, "UPDATE social_projects SET released_at=? WHERE kind='new' AND active=1 AND ready_hash=fingerprint AND released_at IS NULL AND first_seen<=?",now,now-(settings.newProjectDelayHours||0)*3600000));
  for (const channel of channelList) statements.push(query(db, `INSERT OR IGNORE INTO social_publications(project_id,platform,channel_id,updated_at)
    SELECT id,?,?,? FROM social_projects WHERE released_at IS NOT NULL AND active=1 AND ready_hash=fingerprint AND NOT EXISTS(SELECT 1 FROM social_drafts d WHERE d.project_id=social_projects.id AND d.platform=?)`,channel.platform,channel.id,now,channel.platform));
  await db.batch(statements);
}

export async function markReady(db, id, expectedHash, selection, now, captions, options) {
  const result = await run(db, `UPDATE social_projects SET ready_hash=fingerprint,selection=?,captions=COALESCE(?,captions),options=COALESCE(?,options)
    WHERE id=? AND fingerprint=? AND active=1
    AND NOT EXISTS(SELECT 1 FROM social_publications WHERE project_id=? AND state IN ('sending','scheduled','manual_required','uncertain','sent','failed'))`,JSON.stringify(selection),captions===undefined?null:JSON.stringify(captions),options===undefined?null:JSON.stringify(options),id,expectedHash,id);
  if (!result.meta.changes) {
    const project=await first(db,'SELECT active,fingerprint FROM social_projects WHERE id=?',id);
    if(!project||!project.active||project.fingerprint!==expectedHash)throw new Error('Проєкт змінився або прихований. Відкрийте його повторно для перегляду.');
    throw new Error('Допис уже надсилається, опублікований або потребує звіряння з Buffer. Повторне створення заблоковане.');
  }
  await run(db, "UPDATE social_publications SET state='pending',error=NULL,next_attempt=0 WHERE project_id=? AND state IN ('blocked','retry') AND buffer_id IS NULL",id);
  await event(db,id,null,'ready',expectedHash,now);
}

export async function claim(db, id, platform, token, payload, now, retryLimit=5) {
  const r = await run(db, `UPDATE social_publications SET state='sending',attempts=attempts+1,attempt_token=?,payload=?,updated_at=?
    WHERE project_id=? AND platform=? AND state IN ('pending','retry') AND next_attempt<=? AND attempts<? AND buffer_id IS NULL
    AND (SELECT value FROM social_meta WHERE key='live')='1'
    AND EXISTS(SELECT 1 FROM social_projects p WHERE p.id=project_id AND p.active=1 AND p.ready_hash=p.fingerprint)`,token,JSON.stringify(payload),now,id,platform,now,retryLimit);
  return r.meta.changes === 1;
}

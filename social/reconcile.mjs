import {all,query} from './store.mjs';
import {bufferRequest,GET_POST} from './buffer.mjs';

// Called only on an authenticated explicit ready action. Never infer absence
// from timeouts, authorization failures, null data or generic provider errors.
export async function reconcileProjectDrafts(env,projectId,now,fetcher=fetch) {
 const db=env.SOCIAL_DB;
 const rows=await all(db,`SELECT d.*,q.state AS publication_state,q.buffer_id AS publication_id,q.payload AS publication_payload
 FROM social_drafts d LEFT JOIN social_publications q ON q.project_id=d.project_id AND q.platform=d.platform
 WHERE d.project_id=? AND d.state='draft' AND d.buffer_id IS NOT NULL`,projectId);
 const decisions=[];
 for(const row of rows) {
  if(row.publication_state && (!['draft','blocked','manual_required'].includes(row.publication_state)||
    row.publication_id!==row.buffer_id||!JSON.parse(row.publication_payload||'{}').saveToDraft))continue;
  try {
   const {post}=await bufferRequest(env,GET_POST,{input:{id:row.buffer_id}},fetcher,now);
   if(!post||post.id!==row.buffer_id||post.channelId!==row.channel_id) {
    // Old imported draft rows did not store channel_id; use the configured ID.
    const channel=JSON.parse(env.BUFFER_CHANNELS||'[]').find(c=>c.platform===row.platform);
    if(!post||post.id!==row.buffer_id||post.channelId!==(row.channel_id||channel?.id))
     throw new Error('Канал чернетки не збігається. Звірте підключення Buffer.');
   }
   decisions.push({row,post});
  }catch(error) {
   if(error.kind!=='missing')throw error;
   decisions.push({row,missing:true});
  }
 }
 const statements=[];let missing=0;
 for(const {row,post,missing:absent} of decisions) {
  if(absent) {
   missing++;
   statements.push(query(db,"INSERT INTO social_events(project_id,platform,event,detail,created_at) VALUES(?,?,'draft_confirmed_absent',?,?)",projectId,row.platform,JSON.stringify({bufferId:row.buffer_id,previousDraft:row,reason:'Buffer explicitly returned Post not found on ready action'}),now));
   statements.push(query(db,"UPDATE social_publications SET state='pending',buffer_id=NULL,attempts=0,next_attempt=0,payload=NULL,attempt_token=NULL,error=NULL,updated_at=? WHERE project_id=? AND platform=? AND buffer_id=? AND state IN ('draft','blocked','manual_required')",now,projectId,row.platform,row.buffer_id));
   statements.push(query(db,"DELETE FROM social_drafts WHERE project_id=? AND platform=? AND buffer_id=? AND state='draft'",projectId,row.platform,row.buffer_id));
  }else if(row.publication_state) {
   const state=post.status==='draft'?'draft':post.schedulingType==='notification'?'manual_required':post.status==='sent'?'sent':post.status==='error'?'failed':['scheduled','sending'].includes(post.status)?'scheduled':'blocked';
   statements.push(query(db,"UPDATE social_publications SET state=?,updated_at=? WHERE project_id=? AND platform=? AND buffer_id=? AND state IN ('draft','blocked','manual_required')",state,now,projectId,row.platform,row.buffer_id));
  }
 }
 if(statements.length)await db.batch(statements);
 return {checked:decisions.length,missing};
}

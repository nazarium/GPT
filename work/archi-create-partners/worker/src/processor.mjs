import {acpReducer_, acpEmpty_} from './dialog.generated.mjs';
import {bridge, telegram} from './services.mjs';

export function normalize(update) {
  const cb = update.callback_query, m = cb?.message || update.message, sender = cb?.from || m?.from;
  if (!m || m.chat?.type !== 'private' || !sender || sender.is_bot || String(sender.id) !== String(m.chat.id)) throw new Error('INVALID_ACTOR');
  return {id: update.update_id, actor: String(sender.id), chat: String(m.chat.id), username: sender.username || '', date: m.date,
    text: cb ? '' : (m.text || m.caption || ''), document: cb ? null : m.document, contact: cb ? null : m.contact, callback: cb?.data || null, callbackId: cb?.id || null};
}
const read = (o, key) => {
  const r = o.sql.exec('SELECT body FROM processor WHERE key=?', key).toArray()[0];
  return r ? JSON.parse(r.body) : null;
};
const put = (o, key, data) => o.sql.exec('INSERT INTO processor(key,body) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body', key, JSON.stringify(data));

export async function processInbox(o, force = false) {
  if (!['preview','public'].includes(o.env.MODE) || o.env.DIALOG_ENABLED !== 'true') return;
  const retry = read(o, 'retry');
  if (!force && retry?.nextAt > Date.now()) return;
  try {
    for (let i = 0; i < 10; i++) {
      const head = await o.head();
      if (!head) break;
      const event = normalize(head.update);
      const identity = read(o, 'identity') || o.env.TEST_ACTOR_ID;
      if (event.actor !== identity) throw new Error('INVALID_ACTOR');
      let session = read(o, 'session');
      if (!session) {
        const initial = await bridge(o.env, {action: 'snapshot', actor: event.actor});
        session = {state: initial.state || acpEmpty_(), context: initial.context, touchedAt: initial.touchedAt || 0};
        put(o, 'session', session);
      }
      let job = read(o, 'job:' + event.id);
      if (!job) {
        if (event.text === 'Оновити матеріали') {
          const fresh = await bridge(o.env, {action: 'snapshot', actor: event.actor});
          session.context = fresh.context;
        }
        const now = new Date().toISOString();
        const before = Date.now() - session.touchedAt > 7 * 86400000 ? acpEmpty_() : session.state;
        const context = {...session.context, actor: event.actor, chat: event.chat, username: event.username, now};
        let plan;
        try { plan = acpReducer_(before, event, context); }
        catch { plan = {state: before, reply: {text: 'Не вдалося виконати дію. Відкрийте головне меню та оберіть власну компанію.', markup: {}}, effect: null}; }
        plan = {...plan, before, now};
        if (JSON.stringify(plan).length > 40000) plan = {state: before, before, now, effect: null, reply: {text: 'Анкета завелика. Скоротіть текст або використайте посилання на каталог.', markup: {}}};
        job = {plan, phase: 'planned', noticeSent: false};
        put(o, 'job:' + event.id, job);
      }
      if (job.phase === 'planned') {
        let view = job.plan, context = session.context;
        if (job.plan.effect) {
          if (!job.noticeSent) {
            await telegram(o.env, 'sendMessage', {chat_id: event.chat, text: 'Зберігаємо матеріали. Зачекайте на підтвердження.'});
            job.noticeSent = true; put(o, 'job:' + event.id, job);
          }
          const result = await bridge(o.env, {action: 'commit', actor: event.actor, update_id: event.id, plan: job.plan});
          view = result.view; context = result.context;
        }
        session = {state: view.state, context, touchedAt: Date.now()};
        job = {...job, phase: 'ready', reply: view.reply};
        // State and outbox advance atomically before any success response is sent.
        o.ctx.storage.transactionSync(() => { put(o, 'session', session); put(o, 'job:' + event.id, job); });
      }
      if (event.callbackId) {
        try { await telegram(o.env, 'answerCallbackQuery', {callback_query_id: event.callbackId}); } catch { /* Expiry does not roll back a saved operation. */ }
      }
      const before=job.plan.before,after=job.plan.state;
      const upload=!!event.document&&!job.plan.effect&&before?.step==='materials'&&after?.step==='materials'&&after.draft?.materials.length>before.draft?.materials.length;
      if (!upload) {
        // The next dialogue step already acknowledges the materials and supersedes this notice.
        o.sql.exec("DELETE FROM processor WHERE key='uploadNotice'");
        await telegram(o.env, 'sendMessage', {chat_id: event.chat, text: job.reply.text.slice(0, 4000), reply_markup: job.reply.markup, link_preview_options: {is_disabled: true}});
      }
      o.ctx.storage.transactionSync(() => {
        if(upload){
          const pending=read(o,'uploadNotice')||{chat:event.chat,names:{},createdAt:Date.now()};
          pending.names[String(event.id)]=String(event.document.file_name||'document').slice(0,150);
          pending.reply=job.reply;pending.dueAt=Date.now()+2000;
          put(o,'uploadNotice',pending);
        }
        o.sql.exec('UPDATE inbox SET completed_at=?,body=NULL WHERE update_id=?', Date.now(), event.id);
        o.sql.exec('DELETE FROM processor WHERE key=?', 'job:' + event.id);
        o.sql.exec('DELETE FROM processor WHERE key=?', 'retry');
      });
    }
    const notice=read(o,'uploadNotice');
    if(notice&&!(await o.head())&&notice.dueAt<=Date.now()){
      const names=Object.values(notice.names);
      await telegram(o.env,'sendMessage',{chat_id:notice.chat,text:('Додано до чернетки файлів: '+names.length+'.\n'+names.join('\n')+'\n\nМожете надіслати ще або натиснути «Готово».').slice(0,4000),reply_markup:notice.reply.markup,link_preview_options:{is_disabled:true}});
      o.sql.exec("DELETE FROM processor WHERE key='uploadNotice'");
    }
  } catch (error) {
    const attempts = (read(o, 'retry')?.attempts || 0) + 1;
    const nextAt = Date.now() + Math.max(error.retryAfter || 0, Math.min(300000, 2000 * 2 ** Math.min(attempts - 1, 8)));
    put(o, 'retry', {attempts, nextAt});
    // Never log exception text: fetch errors may include secret-bearing URLs.
    console.error(JSON.stringify({event: 'ACP_PROCESS_RETRY', attempts}));
  }
  if ((await o.status()).pending) await o.ctx.storage.setAlarm(Math.max(Date.now() + 1000, read(o, 'retry')?.nextAt || 0));
  else if(read(o,'uploadNotice'))await o.ctx.storage.setAlarm(Math.max(Date.now()+100,read(o,'uploadNotice').dueAt,read(o,'retry')?.nextAt||0));
}

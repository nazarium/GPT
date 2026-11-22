import { DurableObject } from 'cloudflare:workers';
import { processInbox, normalize } from './processor.mjs';
import { bridge, telegram } from './services.mjs';

const MAX_BODY = 64 * 1024;
const json = (value, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'no-store'}});
async function equalSecret(actual, expected) {
  if (!actual || !expected) return false;
  const hash = s => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const [a, b] = await Promise.all([hash(actual), hash(expected)]);
  return crypto.subtle.timingSafeEqual(a, b);
}
async function readJSON(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('BODY');
  let size = 0;
  const chunks = [];
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new Error('SIZE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async scheduled(_controller, env) {
    if (env.MODE === 'public') {
      await env.INBOX.get(env.INBOX.idFromName('public-registry')).monitor();
      return;
    }
    if (env.MODE !== 'preview' || !/^\d+$/.test(env.TEST_ACTOR_ID || '')) return;
    // Independent of the object's alarm: detect an alarm/consumer that stopped.
    const inbox = env.INBOX.get(env.INBOX.idFromName('preview:' + env.TEST_ACTOR_ID));
    try {
      const status = await inbox.status();
      console.log(JSON.stringify({event: status.stale ? 'ACP_STALE_INBOX' : 'ACP_INBOX_HEALTH', ...status}));
    } catch {
      console.error(JSON.stringify({event: 'ACP_INBOX_HEALTH_FAILED'}));
      throw new Error('ACP_INBOX_HEALTH_FAILED');
    }
  },
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') return json({component: 'partners-dialog', mode: env.MODE || 'disabled', dialogEnabled: env.DIALOG_ENABLED === 'true'});
    if (!['preview','public'].includes(env.MODE) || !/^\d+$/.test(env.TEST_ACTOR_ID || '')) return json({error: 'DISABLED'}, 503);
    const inbox = () => env.INBOX.get(env.INBOX.idFromName('preview:' + env.TEST_ACTOR_ID));
    if (path === '/telegram' && request.method === 'POST') {
      if (!await equalSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET)) return json({error: 'UNAUTHORIZED'}, 401);
      let update;
      try { update = await readJSON(request); } catch { return json({error: 'INVALID_BODY'}, 400); }
      if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) return json({error: 'INVALID_UPDATE'}, 400);
      const message = update.message || update.callback_query?.message;
      const actor = update.callback_query?.from || update.message?.from;
      // Preview may not silently acknowledge and discard other suppliers' updates.
      if (message?.chat?.type !== 'private' || actor?.is_bot || String(message?.chat?.id) !== String(actor?.id) || !/^[1-9]\d*$/.test(String(actor?.id))) return json({ignored: true});
      if (env.MODE === 'preview' && String(actor.id) !== env.TEST_ACTOR_ID) return json({error: 'OUTSIDE_PREVIEW'}, 503);
      try {
        const actorId=String(actor.id);
        if(env.MODE==='public') await env.INBOX.get(env.INBOX.idFromName('public-registry')).register(actorId);
        const name=actorId===env.TEST_ACTOR_ID?'preview:'+actorId:'public:'+actorId;
        return json(await env.INBOX.get(env.INBOX.idFromName(name)).enqueue(update));
      }
      catch { return json({error: 'STORAGE_UNAVAILABLE'}, 503); }
    }
    if (path.startsWith('/ops/')) {
      if (!await equalSecret(request.headers.get('Authorization'), 'Bearer ' + (env.INBOX_ADMIN_SECRET || '')) || !env.INBOX_ADMIN_SECRET) return json({error: 'UNAUTHORIZED'}, 401);
      if (path === '/ops/preflight' && request.method === 'GET') {
        try {
          const me = await telegram(env, 'getMe', {});
          if (me.username !== 'ArchiCreatePartnersBot') return json({error: 'WRONG_BOT'}, 409);
          const snapshot = await bridge(env, {action: 'snapshot', actor: env.TEST_ACTOR_ID});
          const hook = await telegram(env, 'getWebhookInfo', {});
          return json({ok: true, bot: me.username, suppliers: snapshot.context.suppliers.length, offers: snapshot.context.offers.length, webhook: hook.url, pendingUpdates: hook.pending_update_count});
        } catch { return json({error: 'PREFLIGHT_FAILED'}, 502); }
      }
      if (path === '/ops/webhook' && request.method === 'POST') {
        if (env.DIALOG_ENABLED !== 'true' || !/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET || '')) return json({error: 'NOT_READY'}, 409);
        try {
          const me = await telegram(env, 'getMe', {});
          if (me.username !== 'ArchiCreatePartnersBot') return json({error: 'WRONG_BOT'}, 409);
          await bridge(env, {action: 'snapshot', actor: env.TEST_ACTOR_ID});
          const url = 'https://archi-create-partners-preview.nazarium.workers.dev/telegram';
          const before = await telegram(env, 'getWebhookInfo', {});
          if (before.url && before.url !== url) return json({error: 'OTHER_WEBHOOK_EXISTS'}, 409);
          await telegram(env, 'setWebhook', {url, secret_token: env.TELEGRAM_WEBHOOK_SECRET, max_connections: 1, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false});
          const after = await telegram(env, 'getWebhookInfo', {});
          return json({ok: after.url === url, webhook: after.url, pendingUpdates: after.pending_update_count});
        } catch { return json({error: 'WEBHOOK_SETUP_FAILED'}, 502); }
      }
      if (path === '/ops/status' && request.method === 'GET') return json(await inbox().status());
      if (path === '/ops/session' && request.method === 'GET') return json(await inbox().exportSession());
      if (path === '/ops/retry' && request.method === 'POST') { await inbox().drain(true); return json(await inbox().status()); }
      // Read is non-destructive. Only acknowledge after the consumer's durable commit.
      if (path === '/ops/head' && request.method === 'GET') return json(await inbox().head());
      if (path === '/ops/ack' && request.method === 'POST') {
        if (env.DIALOG_ENABLED === 'true') return json({error: 'CONSUMER_OWNS_ACK'}, 409);
        let body;
        try { body = await readJSON(request); } catch { return json({error: 'INVALID_BODY'}, 400); }
        if (!Number.isSafeInteger(body.update_id)) return json({error: 'INVALID_ID'}, 400);
        return json(await inbox().ack(body.update_id));
      }
    }
    return json({error: 'NOT_FOUND'}, 404);
  }
};

export class PartnerInbox extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS inbox (
      update_id INTEGER PRIMARY KEY, body TEXT, received_at INTEGER NOT NULL,
      completed_at INTEGER, alerted_at INTEGER)`);
    this.sql.exec('CREATE TABLE IF NOT EXISTS processor (key TEXT PRIMARY KEY,body TEXT NOT NULL)');
    this.running = null;
  }
  async enqueue(update) {
    const actor=normalize(update).actor;
    const now = Date.now();
    await this.ctx.storage.transaction(async storage => {
      const previous=this.sql.exec("SELECT body FROM processor WHERE key='identity'").toArray()[0];
      if(previous&&JSON.parse(previous.body)!==actor)throw new Error('ACTOR_MISMATCH');
      this.sql.exec("INSERT OR IGNORE INTO processor(key,body) VALUES('identity',?)",JSON.stringify(actor));
      this.sql.exec('INSERT OR IGNORE INTO inbox(update_id,body,received_at) VALUES(?,?,?)', update.update_id, JSON.stringify(update), now);
      // Commit the wake-up together with the event; failures prevent HTTP 2xx.
      const alarm = await storage.getAlarm();
      if (!alarm || alarm > now + 60000) await storage.setAlarm(now + 60000);
    });
    if (this.env.DIALOG_ENABLED === 'true') this.ctx.waitUntil(this.drain());
    return {accepted: true, update_id: update.update_id};
  }
  drain(force = false) {
    if (!this.running) this.running = Promise.resolve().then(() => processInbox(this, force)).finally(() => { this.running = null; });
    return this.running;
  }
  exportSession() {
    const row = this.sql.exec("SELECT body FROM processor WHERE key='session'").toArray()[0];
    const pending = this.sql.exec('SELECT COUNT(*) AS count FROM inbox WHERE completed_at IS NULL').toArray()[0].count;
    const identity=this.sql.exec("SELECT body FROM processor WHERE key='identity'").toArray()[0];
    return {version: 1, actor: identity?JSON.parse(identity.body):this.env.TEST_ACTOR_ID, pending, session: row ? JSON.parse(row.body) : null};
  }
  register(actor) {
    if(!/^[1-9]\d*$/.test(actor))throw new Error('INVALID_ACTOR');
    this.sql.exec('INSERT OR IGNORE INTO processor(key,body) VALUES(?,?)','actor:'+actor,JSON.stringify(actor));
  }
  async monitor() {
    const last=this.sql.exec("SELECT body FROM processor WHERE key='cursor'").toArray()[0];
    let rows=this.sql.exec("SELECT key,body FROM processor WHERE key LIKE 'actor:%' AND key>? ORDER BY key LIMIT 20",last?JSON.parse(last.body):'').toArray();
    if(!rows.length)rows=this.sql.exec("SELECT key,body FROM processor WHERE key LIKE 'actor:%' ORDER BY key LIMIT 20").toArray();
    for(const row of rows){
      const actor=JSON.parse(row.body), name=actor===this.env.TEST_ACTOR_ID?'preview:'+actor:'public:'+actor;
      const status=await this.env.INBOX.get(this.env.INBOX.idFromName(name)).status();
      console.log(JSON.stringify({event:status.stale?'ACP_STALE_INBOX':'ACP_INBOX_HEALTH',...status}));
      this.sql.exec("INSERT INTO processor(key,body) VALUES('cursor',?) ON CONFLICT(key) DO UPDATE SET body=excluded.body",JSON.stringify(row.key));
    }
  }
  async head() {
    const row = this.sql.exec('SELECT update_id,body,received_at FROM inbox WHERE completed_at IS NULL ORDER BY update_id LIMIT 1').toArray()[0];
    return row ? {update_id: row.update_id, update: JSON.parse(row.body), received_at: row.received_at} : null;
  }
  async ack(id) {
    // No awaits between selecting and updating: a later event cannot skip the head.
    const head = this.sql.exec('SELECT update_id FROM inbox WHERE completed_at IS NULL ORDER BY update_id LIMIT 1').toArray()[0];
    const previous = this.sql.exec('SELECT completed_at FROM inbox WHERE update_id=?', id).toArray()[0];
    if (previous?.completed_at != null) return {acknowledged: true};
    if (!head || head.update_id !== id) return {acknowledged: false, error: 'NOT_HEAD'};
    // Keep a compact permanent deduplication tombstone; remove the personal payload.
    this.sql.exec('UPDATE inbox SET completed_at=?,body=NULL WHERE update_id=?', Date.now(), id);
    return {acknowledged: true};
  }
  async status() {
    const row = this.sql.exec('SELECT COUNT(*) AS pending,MIN(received_at) AS oldest FROM inbox WHERE completed_at IS NULL').toArray()[0];
    const noticeRow=this.sql.exec("SELECT body FROM processor WHERE key='uploadNotice'").toArray()[0];
    const notice=noticeRow?JSON.parse(noticeRow.body):null;
    if(notice)row.oldest=row.oldest==null?notice.createdAt:Math.min(row.oldest,notice.createdAt);
    const retry = this.sql.exec("SELECT body FROM processor WHERE key='retry'").toArray()[0];
    const completed = this.sql.exec('SELECT MAX(completed_at) AS last FROM inbox').toArray()[0].last;
    return {pending: row.pending, pendingUploadNotice:!!notice, oldestAgeMs: row.oldest == null ? null : Date.now() - row.oldest, stale: row.oldest != null && Date.now() - row.oldest > 600000, retry: retry ? JSON.parse(retry.body) : null, lastCompletedAt: completed};
  }
  async alarm() {
    const now = Date.now();
    const stale = this.sql.exec('SELECT COUNT(*) AS count FROM inbox WHERE completed_at IS NULL AND received_at<? AND (alerted_at IS NULL OR alerted_at<?)', now - 600000, now - 600000).toArray()[0].count;
    if (stale) {
      console.error(JSON.stringify({event: 'ACP_STALE_INBOX', count: stale}));
      this.sql.exec('UPDATE inbox SET alerted_at=? WHERE completed_at IS NULL AND received_at<?', now, now - 600000);
    }
    if (this.env.DIALOG_ENABLED === 'true') await this.drain();
    if ((await this.status()).pending) {
      const current = await this.ctx.storage.getAlarm();
      if (!current || current > now + 60000) await this.ctx.storage.setAlarm(now + 60000);
    }
  }
}

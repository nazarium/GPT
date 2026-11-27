const toBase64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
function fromBase64(text) {
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(text).buffer;
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
const encode=value=>value instanceof ArrayBuffer?{__binary:toBase64(new Uint8Array(value))}:ArrayBuffer.isView(value)?{__binary:toBase64(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))}:Array.isArray(value)?value.map(encode):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)])):value;
const decode=value=>value&&typeof value==='object'&&Object.keys(value).length===1&&typeof value.__binary==='string'?fromBase64(value.__binary):Array.isArray(value)?value.map(decode):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)])):value;
const key=secret=>crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
// HMAC-SHA256 over the original payload, using bounded-memory native hashing.
// Keeping the v1 envelope preserves compatibility with existing backup files.
async function streamHmac(secret) {
  let bytes = new TextEncoder().encode(secret);
  if (bytes.length > 64) bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const innerPad = new Uint8Array(64).fill(0x36);
  const outerPad = new Uint8Array(64).fill(0x5c);
  for (let i = 0; i < bytes.length; i++) { innerPad[i] ^= bytes[i]; outerPad[i] ^= bytes[i]; }
  const digest = new crypto.DigestStream('SHA-256');
  const writer = digest.getWriter();
  await writer.write(innerPad);
  return {
    update: data => writer.write(data),
    async finish() {
      await writer.close();
      const outer = new Uint8Array(96);
      outer.set(outerPad); outer.set(new Uint8Array(await digest.digest), 64);
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', outer))];
    },
    async abort(error) { await writer.abort(error).catch(() => {}); },
  };
}

export async function writeSnapshot(storage, secret, seeds, writer, checkConsistency = () => {}) {
  if (!secret) throw Error('Пароль адміністратора не налаштований.');
  const encoder = new TextEncoder();
  const hmac = await streamHmac(secret);
  const write = text => writer.write(encoder.encode(text));
  const payload = async text => {
    await hmac.update(encoder.encode(text));
    await write(JSON.stringify(text).slice(1, -1));
  };
  try {
    await write('{"payload":"');
    await payload('{"format":"archi-create-do-v1","createdAt":' + JSON.stringify(new Date().toISOString()) + ',"entries":[');
    // A storage value is at most 128 KiB. Read only a few values at a time.
    let startAfter, first = true;
    const seedKeys = new Set(seeds.map(([key]) => key));
    const entry = async (k, v) => {
      checkConsistency();
      await payload((first ? '' : ',') + JSON.stringify([k, encode(v)]));
      first = false;
    };
    for (;;) {
      const batch = await storage.list({ limit: 8, ...(startAfter ? { startAfter } : {}), noCache: true });
      for (const [k, v] of batch) { seedKeys.delete(k); await entry(k, v); }
      if (batch.size < 8) break;
      startAfter = [...batch.keys()].at(-1);
    }
    for (const [k, v] of seeds) if (seedKeys.has(k)) await entry(k, v);
    await payload(']}');
    const signature = await hmac.finish();
    checkConsistency();
    await write('","signature":' + JSON.stringify(signature) + '}');
    await writer.close();
  } catch (error) {
    await hmac.abort(error);
    throw error;
  }
}

export function snapshotResponse(storage, secret, getSeeds, waitUntil, checkConsistency = () => {}) {
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  // Never hold a storage transaction across network backpressure. Abort on concurrent edits.
  const task = (async () => { checkConsistency(); const seeds = await getSeeds(storage); checkConsistency(); await writeSnapshot(storage, secret, seeds, writer, checkConsistency); })()
    .catch(async error => { await writer.abort(error).catch(() => {}); });
  waitUntil(task);
  return new Response(stream.readable, { headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': 'attachment; filename="archi-create-' + new Date().toISOString().slice(0,10) + '.json"',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}

export async function restore(storage,secret,backup){
 if(typeof backup?.payload!=='string'||!Array.isArray(backup.signature)||backup.signature.length!==32||!await crypto.subtle.verify('HMAC',await key(secret),new Uint8Array(backup.signature),new TextEncoder().encode(backup.payload)))throw Error('Підпис копії некоректний. Потрібна незмінена копія з цього сайту й того самого пароля адміністратора.');
 const data=JSON.parse(backup.payload);
 if(data.format!=='archi-create-do-v1'||!Array.isArray(data.entries))throw Error('Непідтримуваний формат копії.');
 const entries=new Map(data.entries.map(([k,v])=>[k,decode(v)]));
 if(entries.size!==data.entries.length)throw Error('Повторені ключі у копії.');
 await storage.transaction(async tx=>{let cursor;for(;;){const batch=await tx.list({limit:500,...(cursor?{startAfter:cursor}:{})});const keys=[...batch.keys()];if(keys.length)await tx.delete(keys);if(keys.length<500)break;cursor=keys.at(-1);}for(const [k,v]of entries)await tx.put(k,v);});
 return {ok:true,entries:entries.size};
}

// Staging tables are separate from the site's KV records and its exports.
export async function importBatch(storage, secret, action, input) {
  const sql = storage.sql;
  if (!secret) throw Error('Пароль адміністратора не налаштований.');
  if (action === 'start') {
    if (typeof input.date !== 'string' || !/^[\dT:.Z-]{1,40}$/.test(input.date)) throw Error('Некоректна дата копії.');
    const session = crypto.randomUUID();
    storage.transactionSync(() => {
      sql.exec('CREATE TABLE IF NOT EXISTS restore_session (id TEXT PRIMARY KEY, date TEXT NOT NULL)');
      sql.exec('CREATE TABLE IF NOT EXISTS restore_entries (seq INTEGER PRIMARY KEY, name TEXT UNIQUE, entry TEXT NOT NULL)');
      sql.exec('DELETE FROM restore_entries');
      sql.exec('DELETE FROM restore_session');
      sql.exec('INSERT INTO restore_session VALUES (?, ?)', session, input.date);
    });
    return {session};
  }
  const current = () => sql.exec('SELECT date FROM restore_session WHERE id = ?', input.session).toArray()[0];
  const session = current();
  if (!session) throw Error('Сеанс імпорту завершено. Виберіть файл повторно.');
  const count = () => sql.exec('SELECT COALESCE(MAX(seq)+1,0) AS n FROM restore_entries').one().n;
  const clear = () => {
    sql.exec('DELETE FROM restore_entries');
    sql.exec('DELETE FROM restore_session');
  };
  if (action === 'cancel') { storage.transactionSync(clear); return {ok: true}; }
  if (count() !== input.offset) throw Error('Порушено порядок частин копії.');
  if (action === 'append') {
    if (!Array.isArray(input.entries) || !input.entries.length || input.entries.length > 100) throw Error('Некоректна частина копії.');
    storage.transactionSync(() => {
      input.entries.forEach((entry, i) => {
        const pair = JSON.parse(entry);
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') throw Error('Некоректний запис копії.');
        sql.exec('INSERT INTO restore_entries VALUES (?, ?, ?)', input.offset + i, pair[0], entry);
      });
    });
    return {ok: true};
  }
  if (action !== 'finish' || input.confirm !== 'RESTORE') throw Error('Підтвердьте відновлення.');
  const signature = input.signature;
  if (!Array.isArray(signature) || signature.length !== 32 || !signature.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) throw Error('Некоректний підпис копії.');
  const encoder = new TextEncoder();
  const mac = await streamHmac(secret);
  const update = text => mac.update(encoder.encode(text));
  let digest;
  try {
    await update('{"format":"archi-create-do-v1","createdAt":' + JSON.stringify(session.date) + ',"entries":[');
    for (let i = 0; i < input.offset; i++) {
      const {entry} = sql.exec('SELECT entry FROM restore_entries WHERE seq = ?', i).one();
      await update((i ? ',' : '') + entry);
    }
    await update(']}');
    digest = await mac.finish();
  } catch (error) { await mac.abort(error); throw error; }
  if (digest.reduce((diff, byte, i) => diff | (byte ^ signature[i]), 0)) throw Error('Підпис копії некоректний. Перевірте файл і пароль адміністратора.');
  storage.transactionSync(() => {
    if (!current() || count() !== input.offset) throw Error('Сеанс імпорту змінився.');
    const kv = storage.kv;
    for (;;) {
      const keys = Array.from(kv.list({limit: 8}), ([name]) => name);
      if (!keys.length) break;
      for (const name of keys) kv.delete(name);
    }
    for (const {entry} of sql.exec('SELECT entry FROM restore_entries ORDER BY seq')) {
      const [name, value] = JSON.parse(entry);
      kv.put(name, decode(value));
    }
    clear();
  });
  return {ok: true, entries: input.offset};
}

export async function removeExpiredBackups(bucket,now=Date.now()){
 const cutoff=now-365*24*60*60*1000;
 for(const prefix of ['monthly/','weekly/']){
  let cursor;
  do{
   const page=await bucket.list({prefix,limit:1000,...(cursor?{cursor}:{})});
   const expired=page.objects.filter(item=>new Date(item.uploaded).getTime()<cutoff).map(item=>item.key);
   if(expired.length)await bucket.delete(expired);
   cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
 }
}

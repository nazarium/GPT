import { bufferCredential, bufferRequest, GET_ORGANIZATIONS } from './buffer.mjs';
import { first, query, run } from './store.mjs';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const statusOf = credential => ({ revision: credential.revision, configured: !!credential.key });

export async function credentialAdmin(request, env, readBody, fetcher = fetch) {
  const current = await bufferCredential(env);
  if (request.method === 'GET') return reply(statusOf(current));
  if (request.method !== 'POST') return reply({ error: 'Метод не дозволений' }, 405);
  const input = await readBody(request);
  if (!['replace', 'check', 'disconnect'].includes(input.action)) throw new Error('Невідома дія підключення');
  if (input.revision !== current.revision) return reply({ error: 'Ключ змінився в іншій вкладці. Оновіть підключення.' }, 409);
  let key = current.key;
  if (input.action === 'replace') {
    key = typeof input.key === 'string' ? input.key.trim() : '';
    if (!key || key.length > 4096 || /[^\x21-\x7e]/.test(key)) throw new Error('Вставте лише API-ключ Buffer без пробілів.');
  }
  if (input.action !== 'disconnect') {
    if (!key) throw new Error('Спочатку задайте API-ключ Buffer.');
    let organizations;
    try {
      const result = await bufferRequest({ ...env, SOCIAL_DB: undefined, BUFFER_API_KEY: key }, GET_ORGANIZATIONS, {}, fetcher);
      organizations = result.account?.organizations;
    } catch { throw new Error('Buffer не підтвердив підключення. Перевірте ключ або повторіть спробу пізніше.'); }
    if (!Array.isArray(organizations) || !organizations.some(item => item.id === env.BUFFER_ORGANIZATION_ID)) {
      throw new Error('Ключ не має доступу до організації Buffer, налаштованої для сайту.');
    }
    if (input.action === 'check') return reply({ ...statusOf(current), verified: true });
  }
  const token = crypto.randomUUID();
  const now = Date.now();
  const lock = await run(env.SOCIAL_DB, `INSERT INTO social_locks(name,token,expires_at) VALUES('tick',?,?)
    ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE social_locks.expires_at<?`, token, now + 60000, now);
  if (!lock.meta.changes) return reply({ error: 'Черга зараз обробляється. Повторіть зміну ключа трохи пізніше.' }, 409);
  try {
    const stored = await first(env.SOCIAL_DB, "SELECT value FROM social_meta WHERE key='buffer-credential'");
    if ((stored ? JSON.parse(stored.value).revision : null) !== input.revision) {
      return reply({ error: 'Підключення змінилось. Оновіть сторінку.' }, 409);
    }
    const next = { revision: crypto.randomUUID(), key: input.action === 'disconnect' ? null : key };
    const value = JSON.stringify(next);
    const results = await env.SOCIAL_DB.batch([
      query(env.SOCIAL_DB, `INSERT INTO social_meta(key,value) SELECT 'buffer-credential',?
        WHERE (SELECT value FROM social_meta WHERE key='buffer-credential') IS ?
        ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE social_meta.value IS ?`, value, stored?.value ?? null, stored?.value ?? null),
      query(env.SOCIAL_DB, "UPDATE social_meta SET value='0' WHERE key='live' AND (SELECT value FROM social_meta WHERE key='buffer-credential')=?", value),
    ]);
    if (!results[0].meta.changes) return reply({ error: 'Підключення змінилось. Оновіть сторінку.' }, 409);
    return reply({ ...statusOf(next), verified: input.action === 'replace', paused: true });
  } finally {
    await run(env.SOCIAL_DB, "DELETE FROM social_locks WHERE name='tick' AND token=?", token);
  }
}

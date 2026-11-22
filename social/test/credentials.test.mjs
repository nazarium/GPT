import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers.mjs';
import { credentialAdmin } from '../credentials.mjs';
import { bufferCredential, bufferRequest, GET_ORGANIZATIONS } from '../buffer.mjs';
import { first, run } from '../store.mjs';

test('credential rotation, validation, stale writes, disconnect and runtime resolution', async () => {
  const db = database();
  const env = { SOCIAL_DB: db, BUFFER_API_KEY: 'legacy-private-key', BUFFER_ORGANIZATION_ID: 'org' };
  const request = new Request('https://archi-create.com.ua/api/admin/social/credential', { method: 'POST' });
  let calls = 0;
  const fetcher = async (_, options) => {
    calls++;
    assert.equal(JSON.parse(options.body).query, GET_ORGANIZATIONS);
    assert.equal(options.headers.Authorization, 'Bearer replacement-private-key');
    return Response.json({ data: { account: { organizations: [{ id: 'org' }] } } });
  };
  try {
    await run(db, "UPDATE social_meta SET value='1' WHERE key='live'");
    const savedResponse = await credentialAdmin(request, env, async () => ({ action: 'replace', revision: null, key: 'replacement-private-key' }), fetcher);
    const saved = await savedResponse.json();
    assert.equal(saved.configured, true);
    assert.equal(saved.verified, true);
    assert(!JSON.stringify(saved).includes('private-key'));
    assert.equal((await first(db, "SELECT value FROM social_meta WHERE key='live'")).value, '0');
    assert.equal((await bufferCredential(env)).key, 'replacement-private-key');
    await bufferRequest(env, GET_ORGANIZATIONS, {}, fetcher);
    assert.equal(calls, 2);
    const stale = await credentialAdmin(request, env, async () => ({ action: 'disconnect', revision: null }), fetcher);
    assert.equal(stale.status, 409);
    await assert.rejects(credentialAdmin(request, env, async () => ({ action: 'replace', revision: saved.revision, key: 'invalid-key' }),
      async () => Response.json({ data: { account: { organizations: [{ id: 'other-org' }] } } })), /організації/);
    assert.equal((await bufferCredential(env)).key, 'replacement-private-key');
    const disconnected = await credentialAdmin(request, env, async () => ({ action: 'disconnect', revision: saved.revision }), fetcher);
    assert.equal((await disconnected.json()).configured, false);
    assert.equal((await bufferCredential(env)).key, null);
    await assert.rejects(bufferRequest(env, GET_ORGANIZATIONS, {}, fetcher), /not configured/);
    assert.equal(calls, 2);
  } finally { db.close(); }
});

test('busy queue and failed provider checks preserve the active credential', async () => {
  const db = database();
  const env = { SOCIAL_DB: db, BUFFER_API_KEY: 'existing-key', BUFFER_ORGANIZATION_ID: 'org' };
  const request = new Request('https://archi-create.com.ua/api/admin/social/credential', { method: 'POST' });
  try {
    await assert.rejects(credentialAdmin(request, env, async () => ({ action: 'replace', revision: null, key: 'new-key' }),
      async () => new Response('', { status: 401 })), /не підтвердив/);
    await run(db, "INSERT INTO social_locks(name,token,expires_at) VALUES('tick','busy',?)", Date.now() + 60000);
    const result = await credentialAdmin(request, env, async () => ({ action: 'disconnect', revision: null }));
    assert.equal(result.status, 409);
    assert.equal((await bufferCredential(env)).key, 'existing-key');
  } finally { db.close(); }
});

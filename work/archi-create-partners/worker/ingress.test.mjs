import assert from 'node:assert/strict';
import {Miniflare, convertV4MiniflareOptions, script} from './test-runtime.mjs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const persist = await mkdtemp(join(tmpdir(), 'acp-inbox-'));
const options = {
  modules: true, script: script + '\nPartnerInbox.prototype.testAlarm = function() {return this.alarm();};\n',
  compatibilityDate: '2026-11-17', durableObjects: {INBOX: {className: 'PartnerInbox', useSQLite: true}},
  resourcePersistencePath: persist,
  unsafeInspectDurableObjects: true,
  bindings: {MODE: 'preview', TEST_ACTOR_ID: '123456789', TELEGRAM_WEBHOOK_SECRET: 'local-test-webhook', INBOX_ADMIN_SECRET: 'local-test-admin'}
};
let mf;
const update = id => ({update_id: id, message: {from: {id: 123456789}, chat: {id: 123456789, type: 'private'}, text: 'Test'}});
const post = (body, secret = 'local-test-webhook') => mf.dispatchFetch('http://local/telegram', {method: 'POST', headers: {'X-Telegram-Bot-Api-Secret-Token': secret}, body: JSON.stringify(body)});
const ops = (path, body) => mf.dispatchFetch('http://local/ops/' + path, {method: body ? 'POST' : 'GET', headers: {Authorization: 'Bearer local-test-admin'}, ...(body ? {body: JSON.stringify(body)} : {})});
try {
  mf = new Miniflare(convertV4MiniflareOptions(options));
  assert.equal((await post(update(100), 'wrong')).status, 401);
  assert.equal((await post({update_id: -1})).status, 400);
  assert.equal((await post({update_id: 99, message: {from: {id: 12}, chat: {type: 'private', id: 12}}})).status, 503);
  assert.equal((await mf.dispatchFetch('http://local/ops/head')).status, 401);
  assert.equal((await post(update(100))).status, 200);
  await Promise.all(Array.from({length: 8}, () => post(update(100))));
  assert.equal((await (await ops('status')).json()).pending, 1);
  assert.equal((await post(update(101))).status, 200);
  assert.equal((await (await ops('ack', {update_id: 101})).json()).error, 'NOT_HEAD');
  assert.equal((await (await ops('head')).json()).update_id, 100);
  const storage = await mf.unsafeGetDurableObjectStorage('', 'PartnerInbox', {name: 'preview:123456789'});
  await storage.exec('UPDATE inbox SET received_at=? WHERE update_id=?', Date.now() - 700000, 100);
  const ns = await mf.getDurableObjectNamespace('INBOX');
  await ns.get(ns.idFromName('preview:123456789')).testAlarm();
  assert.equal((await (await ops('status')).json()).stale, true);
  assert.ok((await storage.exec('SELECT alerted_at FROM inbox WHERE update_id=100'))[0].alerted_at);
  await mf.dispose();
  mf = new Miniflare(convertV4MiniflareOptions(options));
  assert.equal((await (await ops('head')).json()).update.message.text, 'Test');
  assert.equal((await (await ops('status')).json()).pending, 2);
  assert.equal((await (await ops('ack', {update_id: 100})).json()).acknowledged, true);
  assert.equal((await (await ops('ack', {update_id: 100})).json()).acknowledged, true);
  await post(update(100));
  assert.equal((await (await ops('status')).json()).pending, 1);
  assert.equal((await (await ops('head')).json()).update_id, 101);
  await ops('ack', {update_id: 101});
  assert.equal(await (await ops('head')).json(), null);
  assert.equal((await mf.dispatchFetch('http://local/telegram', {method: 'POST', headers: {'X-Telegram-Bot-Api-Secret-Token': 'local-test-webhook'}, body: 'x'.repeat(65537)})).status, 400);
  await mf.dispose();
  mf = new Miniflare(convertV4MiniflareOptions({...options, bindings: {...options.bindings, MODE: 'disabled'}}));
  assert.equal((await post(update(102))).status, 503);
  console.log('PASS: authentication, validation, preview restriction, concurrent deduplication, ordered acknowledgement, restart persistence, replay after completion, body limit, disabled mode');
} finally {
  if (mf) await mf.dispose();
  await rm(persist, {recursive: true, force: true});
}

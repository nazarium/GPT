import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHmac, createHash} from 'node:crypto';
const source = ['Integration.gs','Dialog.gs','Runtime.gs','Bridge.gs'].map(n => readFileSync(new URL(n, import.meta.url), 'utf8')).join('\n');
function harness() {
  const secret = 'local-bridge-secret-with-at-least-32-characters';
  const props = {BRIDGE_MODE: 'preview', GOOGLE_BRIDGE_SECRET: secret, TEST_TELEGRAM_USER_ID: '123'};
  const data = Object.fromEntries(['Постачальники','Пропозиції','Матеріали','_Sessions','_Updates','_Outbox','_BridgeOperations'].map(n => [n, []]));
  let commits = 0, ownerChecks = 0, locks = 0, releases = 0, busy = false, failSession = false;
  const c = vm.createContext({console, PropertiesService: {getScriptProperties: () => ({getProperty: n => props[n]})},
    Utilities: {Charset: {UTF_8: 'utf8'}, DigestAlgorithm: {SHA_256: 'sha256'}, computeHmacSha256Signature: (value, key) => [...createHmac('sha256', key).update(value).digest()], computeDigest: (_, value) => [...createHash('sha256').update(value).digest()]},
    LockService: {getScriptLock: () => ({tryLock: ms => {assert.equal(ms, 15000); locks++; return !busy;}, releaseLock: () => releases++})},
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: text => ({setMimeType: () => text})}
  });
  vm.runInContext(source, c);
  c.acpRequireOwner_ = () => ownerChecks++;
  c.acpRows_ = name => structuredClone(data[name]);
  c.acpContext_ = () => ({suppliers: structuredClone(data['Постачальники']), offers: structuredClone(data['Пропозиції']), materials: structuredClone(data['Матеріали'])});
  c.acpPut_ = (name, row) => {
    if (name === '_Sessions' && failSession) {failSession = false; throw new Error('storage failure with sensitive URL');}
    const key = (c.PARTNERS.headers[name] || c.ACP_TECH[name])[0];
    const index = data[name].findIndex(r => r[key] === row[key]);
    if (index < 0) data[name].push(structuredClone(row)); else data[name][index] = structuredClone(row);
  };
  c.acpCommit_ = effect => {
    commits++;
    const d = effect.draft;
    c.acpPut_('Постачальники', d.supplier);
    c.acpPut_('Пропозиції', {offer_id: d.offer_id, supplier_id: d.supplier.supplier_id, text: d.text, status: 'active'});
  };
  function call(payload, change = e => e) {
    const text = JSON.stringify(payload), timestamp = Date.now();
    const envelope = change({version: 'v1', timestamp, payload: text, signature: createHmac('sha256', secret).update('v1\n' + timestamp + '\n' + text).digest('hex')});
    return JSON.parse(c.doPost({postData: {contents: JSON.stringify(envelope)}}));
  }
  function plan() {
    const ctx = {actor: '123', chat: '123', now: new Date().toISOString(), suppliers: [], offers: [], materials: []};
    let state, id = 10, r;
    for (const text of ['Подати пропозицію', 'Company', 'contact', 'Materials']) {r = c.acpReducer_(state, {id: ++id, text}, ctx); state = r.state;}
    function click(action) {const index = state.buttons.findIndex(b => b[1] === action);r = c.acpReducer_(state, {id: ++id, callback: 'b:' + state.version + ':' + index}, ctx);state = r.state;}
    click('done'); const before = structuredClone(state); click('save');
    return JSON.parse(JSON.stringify({...r, before, now: ctx.now}));
  }
  return {c, data, props, call, plan, get commits(){return commits;}, get ownerChecks(){return ownerChecks;}, get locks(){return locks;}, get releases(){return releases;}, set busy(v){busy=v;}, set failSession(v){failSession=v;}};
}
test('bridge verifies signature, expiry, allowed actor and disabled mode before storage access', () => {
  const h = harness(), request = {action: 'snapshot', actor: '123'};
  assert.equal(h.call(request, e => ({...e, signature: '0'.repeat(64)})).error, 'UNAUTHORIZED');
  assert.equal(h.call(request, e => ({...e, timestamp: e.timestamp - 600001})).error, 'UNAUTHORIZED');
  assert.equal(h.call({...request, actor: '456'}).error, 'UNAUTHORIZED');
  assert.equal(h.ownerChecks, 0); assert.equal(h.locks, 0);
  h.props.BRIDGE_MODE = 'disabled';
  assert.equal(h.call(request).error, 'DISABLED');
});
test('snapshot imports only own companies, offers, materials and existing draft', () => {
  const h = harness();
  h.data['Постачальники'].push({supplier_id: 's1', telegram_user_id: '123'}, {supplier_id: 's2', telegram_user_id: '456'});
  h.data['Пропозиції'].push({offer_id: 'o1', supplier_id: 's1'}, {offer_id: 'o2', supplier_id: 's2'});
  h.data['Матеріали'].push({material_id: 'm1', offer_id: 'o1'}, {material_id: 'm2', offer_id: 'o2'});
  h.data._Sessions.push({actor_id: '123', state_json: '{"step":"name"}', updated_at: '2026-11-18T20:00:00Z'});
  const r = h.call({action: 'snapshot', actor: '123'});
  assert.equal(r.ok, true); assert.equal(r.state.step, 'name');
  assert.deepEqual(r.context.suppliers.map(s => s.supplier_id), ['s1']);
  assert.deepEqual(r.context.offers.map(s => s.offer_id), ['o1']);
  assert.deepEqual(r.context.materials.map(s => s.material_id), ['m1']);
  assert.equal(h.releases, 1);
});
test('public bridge accepts signed new actors and returns only their own records',()=>{
 const h=harness();h.props.BRIDGE_MODE='public';
 h.data['Постачальники'].push({supplier_id:'s1',telegram_user_id:'123'},{supplier_id:'s2',telegram_user_id:'456'});
 const r=h.call({action:'snapshot',actor:'456'});assert.equal(r.ok,true);assert.deepEqual(r.context.suppliers.map(s=>s.supplier_id),['s2']);
 assert.equal(h.call({action:'snapshot',actor:'456'},e=>({...e,signature:'0'.repeat(64)})).error,'UNAUTHORIZED');
});
test('migration refuses uncompleted legacy updates or replies', () => {
  const h = harness(); h.data._Updates.push({actor_id: '123', phase: 'planned'});
  assert.equal(h.call({action: 'snapshot', actor: '123'}).error, 'FINISH_LEGACY_OPERATIONS');
  h.data._Updates.length = 0; h.data._Outbox.push({chat_id: '123', status: 'pending'});
  assert.equal(h.call({action: 'snapshot', actor: '123'}).error, 'FINISH_LEGACY_OPERATIONS');
});
test('commit result can be replayed after lost acknowledgement without repeating writes', () => {
  const h = harness(), request = {action: 'commit', actor: '123', update_id: 100, plan: h.plan()};
  assert.equal(h.call(request).ok, true); assert.equal(h.call(request).ok, true);
  assert.equal(h.commits, 1); assert.equal(h.data['Пропозиції'].length, 1);
  request.plan.reply.text = 'changed';
  assert.equal(h.call(request).error, 'OPERATION_CONFLICT');
});
test('partial write leaves planned operation, retries stable IDs and blocks later commits', () => {
  const h = harness(), request = {action: 'commit', actor: '123', update_id: 100, plan: h.plan()};
  h.failSession = true;
  const failed = h.call(request);
  assert.equal(failed.error, 'BRIDGE_RETRY'); assert.ok(!JSON.stringify(failed).includes('sensitive'));
  assert.equal(h.data._BridgeOperations[0].phase, 'planned');
  assert.equal(h.call({...request, update_id: 101}).error, 'EARLIER_OPERATION_PENDING');
  assert.equal(h.call(request).ok, true);
  assert.equal(h.data['Пропозиції'].length, 1); assert.equal(h.data._BridgeOperations[0].phase, 'applied');
  assert.equal(h.releases, 3);
});
test('busy lock returns retriable status without processing or releasing another lock', () => {
  const h = harness(); h.busy = true;
  assert.equal(h.call({action: 'snapshot', actor: '123'}).error, 'BUSY');
  assert.equal(h.commits, 0); assert.equal(h.releases, 0);
});
test('bridge refuses foreign material identifiers and Google file IDs', () => {
  const h = harness(), plan = h.plan();
  plan.effect.draft.materials = [{material_id: 'm22', kind: 'file', drive_file_id: 'foreign-file'}];
  h.data['Матеріали'].push({material_id: 'm22', offer_id: 'o999', drive_file_id: 'foreign-file'});
  assert.equal(h.call({action: 'commit', actor: '123', update_id: 100, plan}).ok, false);
  assert.equal(h.commits, 0);
});
test('file failure preserves the review draft and returns actionable retry without success', () => {
  const h = harness(), plan = h.plan();
  h.c.acpCommit_ = () => {const error = new Error('download URL with token'); error.materialId = 'm15'; throw error;};
  const request = {action: 'commit', actor: '123', update_id: 100, plan};
  const result = h.call(request);
  assert.equal(result.ok, true); assert.equal(result.view.state.step, 'review');
  assert.deepEqual(result.view.state.draft.failed, ['m15']);
  assert.match(result.view.reply.text, /Не вдалося зберегти/);
  assert.ok(!JSON.stringify(result).includes('token'));
  assert.equal(h.data._BridgeOperations[0].phase, 'applied');
  assert.deepEqual(h.call(request).view, result.view);
});

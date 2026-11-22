import assert from 'node:assert/strict';
import {Miniflare, convertV4MiniflareOptions, script} from './test-runtime.mjs';
import {createHmac} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const persist = await mkdtemp(join(tmpdir(), 'acp-dialog-'));
let snapshots = 0, commits = 0, loseCommitResponse = true, failReply = false;
const replies = [], operations = new Map();
let context = {suppliers: [], offers: [], materials: []};
function googleMock(options) {
  const envelope = JSON.parse(options.body);
  assert.equal(envelope.signature, createHmac('sha256', 'local-bridge-secret-with-at-least-32-characters').update('v1\n' + envelope.timestamp + '\n' + envelope.payload).digest('hex'));
  const request = JSON.parse(envelope.payload);
  if(request.actor!=='123456789') {
    assert.equal(request.action,'snapshot');
    return {statusCode:200,data:JSON.stringify({ok:true,state:null,touchedAt:0,context:{suppliers:[],offers:[],materials:[]}})};
  }
  if (request.action === 'snapshot') { snapshots++; return {statusCode: 200, data: JSON.stringify({ok: true, state: null, touchedAt: 0, context})}; }
  let result = operations.get(request.update_id);
  if (!result) {
    commits++;
    const draft = request.plan.effect.draft;
    context = {suppliers: [draft.supplier], offers: [{offer_id: draft.offer_id, supplier_id: draft.supplier.supplier_id, text: draft.text, status: 'active'}], materials: []};
    result = {ok: true, view: {state: request.plan.state, reply: request.plan.reply}, context};
    operations.set(request.update_id, result);
    if (loseCommitResponse) { loseCommitResponse = false; return {statusCode: 503, data: '{}'}; }
  }
  return {statusCode: 200, data: JSON.stringify(result)};
}
function telegramMock(options) {
  const message = JSON.parse(options.body);
  if (failReply) { failReply = false; return {statusCode: 429, data: JSON.stringify({ok: false, parameters: {retry_after: 1}})}; }
  replies.push(message);
  return {statusCode: 200, data: JSON.stringify({ok: true, result: {message_id: replies.length}})};
}
async function outboundService(request) {
  const options = {body: await request.text()}, url = new URL(request.url);
  let result;
  if (url.href === 'https://script.google.com/macros/s/acp-local-test/exec') result = googleMock(options);
  else if (url.href === 'https://api.telegram.org/bot123:local-test/sendMessage') result = telegramMock(options);
  else if (url.href === 'https://api.telegram.org/bot123:local-test/answerCallbackQuery') result = {statusCode: 200, data: '{"ok":true,"result":true}'};
  else throw new Error('Unexpected outbound destination');
  return new Response(result.data, {status: result.statusCode});
}
const options = {
  modules: true, script, compatibilityDate: '2026-11-17',
  durableObjects: {INBOX: {className: 'PartnerInbox', useSQLite: true}}, resourcePersistencePath: persist, outboundService,
  bindings: {MODE: 'preview', DIALOG_ENABLED: 'true', TEST_ACTOR_ID: '123456789', TELEGRAM_WEBHOOK_SECRET: 'local-hook', INBOX_ADMIN_SECRET: 'local-admin', TELEGRAM_BOT_TOKEN: '123:local-test', GOOGLE_BRIDGE_URL: 'https://script.google.com/macros/s/acp-local-test/exec', GOOGLE_BRIDGE_SECRET: 'local-bridge-secret-with-at-least-32-characters'}
};
let mf, id = 1000;
const ops = (path, body) => mf.dispatchFetch('http://local/ops/' + path, {method: body ? 'POST' : 'GET', headers: {Authorization: 'Bearer local-admin'}, ...(body ? {body: JSON.stringify(body)} : {})});
async function send(text, callback) {
  const message = {from: {id: 123456789}, chat: {id: 123456789, type: 'private'}, text};
  const update = {update_id: ++id, ...(callback ? {callback_query: {id: 'c' + id, from: message.from, message, data: callback}} : {message})};
  const response = await mf.dispatchFetch('http://local/telegram', {method: 'POST', headers: {'X-Telegram-Bot-Api-Secret-Token': 'local-hook'}, body: JSON.stringify(update)});
  assert.equal(response.status, 200);
  await ops('retry', {});
  return update;
}
function click(label) {
  const buttons = replies.at(-1).reply_markup?.inline_keyboard?.flat() || [];
  const button = buttons.find(b => b.text === label);
  assert.ok(button, 'Button missing: ' + label);
  return send('', button.callback_data);
}
try {
  mf = new Miniflare(convertV4MiniflareOptions(options));
  await send('/start');
  assert.match(replies.at(-1).text, /Вітаємо в партнерській системі/);
  assert.equal(snapshots, 1);
  await send('Подати пропозицію'); await send('Test company'); await send('test@example.invalid');
  // A real runtime restart must retain the unfinished form without another snapshot.
  await mf.dispose(); mf = new Miniflare(convertV4MiniflareOptions(options));
  await send('Our materials');
  assert.equal(snapshots, 1);
  await click('Готово');
  const savedUpdate = await click('Зберегти');
  // A lost Google response is durable/retriable and must not trigger premature success.
  assert.equal(commits, 1);
  assert.match(replies.at(-1).text, /Зберігаємо/);
  assert.equal((await (await ops('status')).json()).pending, 1);
  await mf.dispose(); mf = new Miniflare(convertV4MiniflareOptions(options));
  await ops('retry', {});
  assert.match(replies.at(-1).text, /Вашу пропозицію збережено/);
  assert.equal(commits, 1);
  assert.equal((await (await ops('status')).json()).pending, 0);
  const before = replies.length;
  await mf.dispatchFetch('http://local/telegram', {method: 'POST', headers: {'X-Telegram-Bot-Api-Secret-Token': 'local-hook'}, body: JSON.stringify(savedUpdate)});
  await ops('retry', {});
  assert.equal(replies.length, before);
  // Telegram rate limiting retains the outbox; retry sends the original planned reply.
  failReply = true;
  await send('/start');
  assert.equal((await (await ops('status')).json()).pending, 1);
  await mf.dispose(); mf = new Miniflare(convertV4MiniflareOptions(options));
  await ops('retry', {});
  assert.equal((await (await ops('status')).json()).pending, 0);
  assert.equal((await ops('ack', {update_id: id})).status, 409);
  assert.equal(snapshots, 1);
  const exported = await (await ops('session')).json();
  assert.equal(exported.pending, 0); assert.equal(exported.session.state.step, 'home');
  assert.equal(exported.session.context.suppliers[0].company_name, 'Test company');
  await send('Оновити матеріали');
  assert.equal(snapshots, 2);
  assert.match(replies.at(-1).text, /Test company/); assert.ok(!replies.at(-1).text.includes('Оберіть вашу компанію'));
  await mf.dispose(); mf=new Miniflare(convertV4MiniflareOptions({...options,bindings:{...options.bindings,MODE:'public'}}));
  const second={update_id:9000,message:{from:{id:777},chat:{id:777,type:'private'},text:'/start'}};
  assert.equal((await mf.dispatchFetch('http://local/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'local-hook'},body:JSON.stringify(second)})).status,200);
  const ns=await mf.getDurableObjectNamespace('INBOX');
  const other=ns.get(ns.idFromName('public:777'));await other.drain(true);
  assert.equal((await other.exportSession()).actor,'777');
  assert.equal((await other.exportSession()).session.context.suppliers.length,0);
  assert.equal((await ns.get(ns.idFromName('preview:123456789')).exportSession()).session.context.suppliers[0].company_name,'Test company');
  assert.ok(replies.some(r=>r.chat_id==='777'&&r.text.includes('Вітаємо')));
  let uploadId=9100;
  async function sendOther(message){
    const update={update_id:++uploadId,message:{from:{id:777},chat:{id:777,type:'private'},...message}};
    const response=await mf.dispatchFetch('http://local/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'local-hook'},body:JSON.stringify(update)});
    assert.equal(response.status,200);const currentNs=await mf.getDurableObjectNamespace('INBOX');await currentNs.get(currentNs.idFromName('public:777')).drain(true);
  }
  await sendOther({text:'Подати пропозицію'});await sendOther({text:'Second company'});await sendOther({text:'second@example.invalid'});
  const countBefore=replies.filter(r=>r.chat_id==='777').length;
  for(let i=1;i<=3;i++)await sendOther({document:{file_id:'doc'+i,file_name:'file'+i+'.pdf',file_size:100}});
  assert.equal(replies.filter(r=>r.chat_id==='777').length,countBefore);
  assert.equal((await other.exportSession()).session.state.draft.materials.length,3);
  assert.equal((await other.status()).pendingUploadNotice,true);
  // Restart before the deferred confirmation: its reply and latest buttons must survive.
  await mf.dispose();mf=new Miniflare(convertV4MiniflareOptions({...options,bindings:{...options.bindings,MODE:'public'}}));
  const restartedNs=await mf.getDurableObjectNamespace('INBOX');
  const restarted=restartedNs.get(restartedNs.idFromName('public:777'));
  await new Promise(resolve=>setTimeout(resolve,2200));await restarted.drain(true);
  const newReplies=replies.filter(r=>r.chat_id==='777').slice(countBefore);
  assert.equal(newReplies.length,1);assert.match(newReplies[0].text,/файлів: 3/);
  assert.ok(newReplies[0].reply_markup.inline_keyboard.flat().some(b=>b.text==='Готово'&&b.callback_data.includes(String(uploadId))));
  assert.equal((await restarted.status()).pendingUploadNotice,false);
  await sendOther({document:{file_id:'doc4',file_name:'file4.pdf',file_size:100}});
  const draft=(await restarted.exportSession()).session.state;
  const doneIndex=draft.buttons.findIndex(b=>b[1]==='done');
  const fastDone={update_id:++uploadId,callback_query:{id:'done777',from:{id:777},message:{chat:{id:777,type:'private'}},data:'b:'+draft.version+':'+doneIndex}};
  const beforeDone=replies.filter(r=>r.chat_id==='777').length;
  await mf.dispatchFetch('http://local/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'local-hook'},body:JSON.stringify(fastDone)});await restarted.drain(true);
  assert.equal((await restarted.exportSession()).session.state.step,'review');
  assert.equal((await restarted.status()).pendingUploadNotice,false);
  await new Promise(resolve=>setTimeout(resolve,2200));await restarted.drain(true);
  assert.equal(replies.filter(r=>r.chat_id==='777').length,beforeDone+1);
  await assert.rejects(()=>restarted.enqueue({update_id:9001,message:{from:{id:123456789},chat:{id:123456789,type:'private'},text:'/start'}}));
  console.log('PASS: public routing and actor isolation; real Worker dialogue, HMAC, restart, Google ACK loss, deduplication and Telegram 429');
} finally {
  if (mf) await mf.dispose();
  await rm(persist, {recursive: true, force: true});
}

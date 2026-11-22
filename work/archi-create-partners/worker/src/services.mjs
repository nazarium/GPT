export async function bridge(env, payload) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(env.GOOGLE_BRIDGE_URL || '') || (env.GOOGLE_BRIDGE_SECRET || '').length < 32) throw new Error('BRIDGE_CONFIG');
  const body = JSON.stringify(payload), timestamp = Date.now();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.GOOGLE_BRIDGE_SECRET), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('v1\n' + timestamp + '\n' + body)))].map(b => b.toString(16).padStart(2, '0')).join('');
  let response, result;
  try {
    response = await fetch(env.GOOGLE_BRIDGE_URL, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({version: 'v1', timestamp, payload: body, signature}), signal: AbortSignal.timeout(25000)});
    if (!response.ok) throw new Error();
    result = await boundedJSON(response, 1024 * 1024);
  } catch { throw new Error('BRIDGE_UNAVAILABLE'); }
  if (!result.ok) throw new Error(result.error === 'BUSY' ? 'BRIDGE_BUSY' : 'BRIDGE_REJECTED');
  return result;
}
async function boundedJSON(response, limit) {
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) { await reader.cancel(); throw new Error('SIZE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function telegram(env, method, payload) {
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(env.TELEGRAM_BOT_TOKEN || '') || !['sendMessage', 'answerCallbackQuery', 'getMe', 'getWebhookInfo', 'setWebhook'].includes(method)) throw new Error('TELEGRAM_CONFIG');
  let response, data;
  try {
    response = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/' + method, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000)});
    data = await boundedJSON(response, 65536);
  } catch { throw new Error('TELEGRAM_UNAVAILABLE'); }
  if (!response.ok || !data.ok) {
    const error = new Error('TELEGRAM_RETRY');
    error.retryAfter = Math.min(3600000, Math.max(0, Number(data.parameters?.retry_after) || 0) * 1000);
    throw error;
  }
  return data.result;
}

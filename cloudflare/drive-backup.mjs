import {DurableObject} from 'cloudflare:workers';
import build from '../.build/backup-build.json';

const origin = 'https://archi-create.com.ua';
const callback = origin + '/api/backup/google/callback';
const drive = 'https://www.googleapis.com/drive/v3/files';
const encoder = new TextEncoder();
const reply = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
const bytesToHex = bytes => [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');

export async function signManifest(payload, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return {payload, signature: bytesToHex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)))};
}

// The OAuth refresh token lives in this separate object, outside content exports.
async function tokenCipher(secret, value, decrypt = false) {
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(secret)), 'AES-GCM', false, ['encrypt', 'decrypt']);
  if (decrypt) return new TextDecoder().decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: new Uint8Array(value.iv)}, key, new Uint8Array(value.data)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return {iv: [...iv], data: [...new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, encoder.encode(value)))]};
}

async function googleJson(token, url, options = {}) {
  const response = await fetch(url, {...options, headers: {...options.headers, Authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw Error('Google Drive відхилив запит (HTTP ' + response.status + ').');
  return response.status === 204 ? null : response.json();
}

// Keep only one 4 MiB piece in memory. Retry an uncertain PUT only after
// querying Google's committed offset, including a lost final response.
export async function uploadFile(token, parent, name, source, fetcher = fetch) {
  const start = await fetcher('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size,sha256Checksum', {
    method: 'POST', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/octet-stream'},
    body: JSON.stringify({name, parents: [parent]}), signal: AbortSignal.timeout(30000),
  });
  const location = start.headers.get('Location');
  if (!start.ok || !location || new URL(location).origin !== 'https://www.googleapis.com') throw Error('Не вдалося почати завантаження Google Drive.');
  const reader = source.getReader();
  const digest = new crypto.DigestStream('SHA-256');
  const hash = digest.getWriter();
  let pending, ended = false, total = 0, result;
  try {
    while (!ended || pending?.length) {
      const chunk = new Uint8Array(4 * 1024 * 1024);
      let length = 0;
      while (length < chunk.length && !ended) {
        if (!pending?.length) {
          const next = await reader.read();
          if (next.done) { ended = true; break; }
          pending = next.value;
        }
        const take = Math.min(pending.length, chunk.length - length);
        chunk.set(pending.subarray(0, take), length);
        pending = pending.subarray(take);
        length += take;
      }
      // Read ahead so an exact multiple of the chunk size has a known final size.
      if (!pending?.length && !ended) {
        const next = await reader.read();
        ended = next.done;
        pending = next.value;
      }
      const piece = chunk.subarray(0, length);
      await hash.write(piece);
      let sent = 0;
      for (let attempt = 0; attempt < 5; attempt++) {
        let response;
        try {
          response = await fetcher(location, {method: 'PUT', headers: {
            'Content-Range': length ? 'bytes ' + (total + sent) + '-' + (total + length - 1) + '/' + (ended ? total + length : '*') : 'bytes */0',
          }, body: piece.subarray(sent), signal: AbortSignal.timeout(60000)});
        } catch { /* Probe committed bytes before sending anything again. */ }
        if (!response || response.status === 429 || response.status >= 500) {
          response = await fetcher(location, {method: 'PUT', headers: {'Content-Range': 'bytes */' + (ended ? total + length : '*')}, body: '', signal: AbortSignal.timeout(30000)});
        }
        if (response.ok) { result = await response.json(); break; }
        if (response.status !== 308) throw Error('Помилка завантаження Google Drive (HTTP ' + response.status + ').');
        const committed = Number(response.headers.get('Range')?.match(/bytes=0-(\d+)/)?.[1] ?? -1) + 1;
        sent = committed - total;
        if (sent < 0 || sent > length) throw Error('Google Drive повернув некоректну позицію файлу.');
        if (sent === length && !ended) break;
        if (attempt === 4) throw Error('Google Drive не підтвердив завершення файлу.');
      }
      total += length;
    }
    await hash.close();
    const sha256 = bytesToHex(await digest.digest);
    if (!result?.id || Number(result.size) !== total || result.sha256Checksum !== sha256) throw Error('Google Drive не підтвердив розмір і SHA-256 файлу.');
    return {id: result.id, name, size: total, sha256};
  } catch (error) {
    await hash.abort(error).catch(() => {});
    throw error;
  } finally { await reader.cancel().catch(() => {}); }
}

export class DriveBackup extends DurableObject {
  running = false;
  configured() {
    return !!(this.env.BACKUP_SIGNING_KEY && this.env.GOOGLE_BACKUP_CLIENT_ID && this.env.GOOGLE_BACKUP_CLIENT_SECRET);
  }
  async accessToken() {
    const credential = await this.ctx.storage.get('credential');
    if (!credential || !this.configured()) throw Error('Спочатку підключіть Google Drive.');
    const refresh = await tokenCipher(this.env.BACKUP_SIGNING_KEY, credential, true);
    const response = await fetch('https://oauth2.googleapis.com/token', {method: 'POST', body: new URLSearchParams({
      client_id: this.env.GOOGLE_BACKUP_CLIENT_ID, client_secret: this.env.GOOGLE_BACKUP_CLIENT_SECRET,
      refresh_token: refresh, grant_type: 'refresh_token',
    }), signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw Error('Потрібно повторно підключити Google Drive.');
    const data = await response.json();
    return data.access_token;
  }
  async fetch(request) {
    try {
      const url = new URL(request.url), action = url.pathname.split('/').at(-1);
      if (action === 'callback') return await this.oauthCallback(url);
      if (action === 'status') {
        const job = await this.ctx.storage.get('job');
        return reply({configured: this.configured(), d1Configured: !!(this.env.CLOUDFLARE_BACKUP_API_TOKEN && this.env.BACKUP_ACCOUNT_ID && this.env.BACKUP_D1_ID),
          connected: !!await this.ctx.storage.get('credential'), enabled: !!await this.ctx.storage.get('enabled'),
          folder: await this.ctx.storage.get('folder'), job: job ? {state: job.state, count: job.files.length, total: build.assets.length + 2, error: job.error, warning: job.warning, startedAt: job.startedAt, completedAt: job.completedAt} : null});
      }
      if (request.method !== 'POST') return reply({error: 'Метод не підтримується.'}, 405);
      if (action === 'connect') {
        if (!this.configured()) throw Error('Налаштуйте секрети Google OAuth та окремий ключ резервних копій у Cloudflare.');
        const state = crypto.randomUUID();
        await this.ctx.storage.put('oauth', {state, expires: Date.now() + 10 * 60000});
        const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        auth.search = new URLSearchParams({client_id: this.env.GOOGLE_BACKUP_CLIENT_ID, redirect_uri: callback, response_type: 'code',
          scope: 'https://www.googleapis.com/auth/drive.file', access_type: 'offline', prompt: 'consent', state}).toString();
        return reply({url: auth.href});
      }
      if (action === 'settings') {
        const input = await request.json();
        if (input.enabled && (!await this.ctx.storage.get('credential') || !this.env.CLOUDFLARE_BACKUP_API_TOKEN || !this.configured())) throw Error('Спочатку завершіть підключення Google Drive і доступу до експорту D1.');
        await this.ctx.storage.put('enabled', input.enabled === true);
        return reply({ok: true});
      }
      if (action === 'disconnect') {
        if ((await this.ctx.storage.get('job'))?.state === 'running') throw Error('Зачекайте завершення поточної копії.');
        await this.ctx.storage.delete(['credential', 'oauth']);
        await this.ctx.storage.put('enabled', false);
        return reply({ok: true});
      }
      if (action === 'start' || action === 'tick') {
        const month = new Date().toISOString().slice(0, 7);
        if (action === 'tick' && (!await this.ctx.storage.get('enabled') || await this.ctx.storage.get('month') === month)) return reply({skipped: true});
        const job = await this.ctx.storage.get('job');
        if (job?.state === 'running') return reply({ok: true, running: true});
        if (!this.configured() || !await this.ctx.storage.get('credential') || !this.env.CLOUDFLARE_BACKUP_API_TOKEN) throw Error('Не завершено налаштування резервного копіювання.');
        await this.ctx.storage.put('job', {state: 'running', startedAt: new Date().toISOString(), commit: build.commit, buildId: build.id, files: [], step: 0, attempts: 0});
        await this.ctx.storage.setAlarm(Date.now() + 1000);
        return reply({ok: true});
      }
      throw Error('Невідома дія.');
    } catch (error) { return reply({error: error.message}, 400); }
  }
  async oauthCallback(url) {
    const expected = await this.ctx.storage.get('oauth');
    if (!expected || expected.expires < Date.now() || url.searchParams.get('state') !== expected.state) throw Error('Сеанс підключення завершено. Повторіть підключення з адмінпанелі.');
    await this.ctx.storage.delete('oauth');
    if (!url.searchParams.get('code')) throw Error('Google не надав дозвіл.');
    const response = await fetch('https://oauth2.googleapis.com/token', {method: 'POST', body: new URLSearchParams({
      client_id: this.env.GOOGLE_BACKUP_CLIENT_ID, client_secret: this.env.GOOGLE_BACKUP_CLIENT_SECRET,
      redirect_uri: callback, code: url.searchParams.get('code'), grant_type: 'authorization_code',
    }), signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw Error('Не вдалося завершити підключення Google.');
    const tokens = await response.json();
    if (!tokens.refresh_token) throw Error('Google не надав фоновий доступ. Підключіть повторно з дозволом offline.');
    let folder = await this.ctx.storage.get('folder');
    if (folder) {
      try { await googleJson(tokens.access_token, drive + '/' + folder + '?fields=id'); }
      catch { folder = null; }
    }
    if (!folder) {
      const created = await googleJson(tokens.access_token, drive, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: 'Archi-Create — резервні копії', mimeType: 'application/vnd.google-apps.folder'})});
      folder = created.id;
    }
    await this.ctx.storage.put({folder, credential: await tokenCipher(this.env.BACKUP_SIGNING_KEY, tokens.refresh_token)});
    return new Response(null, {status: 303, headers: {Location: origin + '/admin?section=home&tools=backups', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}});
  }
  async alarm() {
    if (this.running) return;
    this.running = true;
    let job = await this.ctx.storage.get('job');
    try {
      if (job?.state !== 'running') return;
      if (job.buildId !== build.id) throw Error('Збірка сайту змінилася під час копіювання. Запустіть нову копію.');
      const token = await this.accessToken();
      if (!job.folder) {
        const folder = await googleJson(token, drive, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
          name: 'Archi-Create ' + job.startedAt.replaceAll(':', '-') + ' — незавершена', parents: [await this.ctx.storage.get('folder')],
          mimeType: 'application/vnd.google-apps.folder', appProperties: {archiBackup: 'v1'},
        })});
        job.folder = folder.id;
      }
      // One file per alarm keeps the job independent of the full archive size.
      if (job.step === 0) {
        const store = this.env.PORTFOLIO.get(this.env.PORTFOLIO.idFromName('archi-create'));
        const response = await store.fetch('https://internal/internal/backup-export');
        if (!response.ok) throw Error('Не вдалося експортувати контент.');
        job.files.push({...await uploadFile(token, job.folder, 'content.json', response.body), path: 'content.json'});
      } else if (job.step === 1) {
        const response = await this.exportD1();
        job.files.push({...await uploadFile(token, job.folder, 'social.sql', response.body), path: 'social.sql'});
      } else if (job.step < build.assets.length + 2) {
        const asset = build.assets[job.step - 2];
        const response = await this.env.ASSETS.fetch(new Request(origin + '/' + asset.path));
        if (!response.ok) throw Error('Не знайдено статичний файл збірки.');
        const file = await uploadFile(token, job.folder, String(job.step - 2).padStart(5, '0') + '-' + asset.path.split('/').at(-1), response.body);
        if (file.sha256 !== asset.sha256 || file.size !== asset.size) throw Error('Статичний файл не відповідає збірці.');
        job.files.push({...file, path: 'static/' + asset.path});
      } else {
        const manifest = await signManifest(JSON.stringify({format: 'archi-create-full-v1', startedAt: job.startedAt, completedAt: new Date().toISOString(),
          repository: 'https://github.com/nazarium/GPT', commit: job.commit, workingTreeDirty: build.dirty, buildId: build.id,
          files: job.files, restore: 'Перевірити scripts/verify-full-backup.mjs, відновити content.json через адмінпанель, static/ у dist/, social.sql у нову D1. Секрети Cloudflare налаштувати окремо.'}), this.env.BACKUP_SIGNING_KEY);
        await uploadFile(token, job.folder, 'manifest.json', new Blob([JSON.stringify(manifest)]).stream());
        await googleJson(token, drive + '/' + job.folder, {method: 'PATCH', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({name: 'Archi-Create ' + job.startedAt.replaceAll(':', '-'), appProperties: {archiBackup: 'v1', complete: 'true', completedAt: new Date().toISOString()}})});
        job.state = 'complete'; job.completedAt = new Date().toISOString();
        await this.ctx.storage.put('month', new Date().toISOString().slice(0, 7));
        try { await this.expire(token); }
        catch { job.warning = 'Копію завершено. Не вдалося перемістити прострочені копії в кошик.'; }
      }
      job.step++; job.attempts = 0;
      await this.ctx.storage.put('job', job);
      if (job.state === 'running') await this.ctx.storage.setAlarm(Date.now() + 1000);
    } catch (error) {
      if (job) {
        job.state = 'failed'; job.error = error.message;
        await this.ctx.storage.put('job', job);
      }
      console.error(JSON.stringify({event: 'drive_backup_failed', error: error.message}));
    } finally { this.running = false; }
  }
  async exportD1() {
    const endpoint = 'https://api.cloudflare.com/client/v4/accounts/' + this.env.BACKUP_ACCOUNT_ID + '/d1/database/' + this.env.BACKUP_D1_ID + '/export';
    let bookmark;
    for (let i = 0; i < 120; i++) {
      const response = await fetch(endpoint, {method: 'POST', headers: {Authorization: 'Bearer ' + this.env.CLOUDFLARE_BACKUP_API_TOKEN, 'Content-Type': 'application/json'},
        body: JSON.stringify({output_format: 'polling', ...(bookmark ? {current_bookmark: bookmark} : {})}), signal: AbortSignal.timeout(30000)});
      if (!response.ok) throw Error('Cloudflare не дозволив експорт D1.');
      const data = await response.json(), result = data.result;
      if (!data.success || result?.error) throw Error('Експорт D1 завершився помилкою.');
      if (result?.status === 'complete' && result.result?.signed_url) {
        const output = await fetch(result.result.signed_url, {signal: AbortSignal.timeout(60000)});
        if (!output.ok) throw Error('Не вдалося завантажити експорт D1.');
        return output;
      }
      bookmark = result?.at_bookmark;
      if (!bookmark) throw Error('Cloudflare не повернув позицію експорту D1.');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw Error('Експорт D1 перевищив час очікування.');
  }
  async expire(token) {
    const root = await this.ctx.storage.get('folder');
    let page;
    do {
      const query = new URL(drive);
      query.search = new URLSearchParams({q: "'" + root + "' in parents and trashed = false and appProperties has { key='archiBackup' and value='v1' } and appProperties has { key='complete' and value='true' }",
        fields: 'nextPageToken,files(id,appProperties)', pageSize: '100', ...(page ? {pageToken: page} : {})}).toString();
      const result = await googleJson(token, query.href);
      for (const file of result.files) {
        if (Date.parse(file.appProperties.completedAt) < Date.now() - 365 * 86400000) await googleJson(token, drive + '/' + file.id,
          {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({trashed: true})});
      }
      page = result.nextPageToken;
    } while (page);
  }
}

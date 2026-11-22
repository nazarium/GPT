import { useEffect, useState } from 'react';

export function BufferKeyEditor({ api, onChanged, disabled }) {
  const [status, setStatus] = useState(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function refresh() {
    setStatus(await api('social/credential'));
  }
  useEffect(() => { refresh().catch(error => setError(error.message)); }, [api]);

  async function act(action) {
    if (action === 'disconnect' && !confirm('Від’єднати Buffer і призупинити нові надсилання?')) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api('social/credential', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, revision: status.revision, ...(action === 'replace' ? { key } : {}) }),
      });
      setStatus(result);
      setKey('');
      setMessage(action === 'check' ? 'Підключення до Buffer підтверджено.'
        : action === 'replace' ? 'Ключ збережено й перевірено. Нові надсилання призупинено. Відновіть їх після перевірки каналів.'
          : 'Buffer від’єднано. Нові надсилання призупинено.');
      await onChanged();
    } catch (error) {
      setError(error.message);
      await refresh().catch(() => {});
    } finally { setBusy(false); }
  }

  return <section className="buffer-key-editor" aria-labelledby="buffer-key-title">
    <h3 id="buffer-key-title">API-ключ Buffer</h3>
    <p>Статус — {status ? status.configured ? 'ключ заданий' : 'Buffer від’єднано' : 'завантаження…'}.</p>
    <p className="editor-muted">Ключ зберігається у серверному сховищі Cloudflare й не повертається в браузер. Заміна або від’єднання призупиняє нові надсилання AutoPoster.</p>
    <fieldset disabled={busy || disabled || !status}>
      <div className="buffer-key-heading">
        <label htmlFor="buffer-api-key">Новий API-ключ</label>
        <a href="https://publish.buffer.com/settings/api" target="_blank" rel="noreferrer">Отримати ключ у Buffer ↗</a>
      </div>
      <input id="buffer-api-key" type="password" value={key} maxLength={4096} autoComplete="new-password" spellCheck={false}
        onChange={event => setKey(event.target.value)} placeholder="Вставте ключ Buffer" />
      <div className="home-palette-actions">
        <button type="button" disabled={!key.trim()} onClick={() => act('replace')}>Зберегти й перевірити ключ</button>
        <button type="button" disabled={!status?.configured} onClick={() => act('check')}>Перевірити підключення</button>
        <button type="button" disabled={!status?.configured} onClick={() => act('disconnect')}>Від’єднати Buffer</button>
      </div>
    </fieldset>
    {error && <p className="editor-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}

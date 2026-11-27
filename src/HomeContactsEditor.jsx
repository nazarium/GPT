import { useEffect, useState } from 'react';
import { useUnsavedChanges } from './useUnsavedChanges.js';

export function HomeContactsEditor({ api }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [conflict, setConflict] = useState(false);
  const dirty = !!draft && (draft.partnerBot !== saved.partnerBot || draft.phone !== saved.phone || draft.telegram !== saved.telegram || draft.email !== saved.email || draft.address !== saved.address);
  useUnsavedChanges(dirty);

  async function run(action) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const value = await action();
      setSaved(value);
      setDraft(value);
      setConflict(false);
    } catch (error) {
      setError(error.message);
      if (error.status === 409) setConflict(true);
    } finally { setBusy(false); }
  }

  const load = () => run(() => api('home/contacts'));
  useEffect(() => { load(); }, []);

  function edit(key, value) {
    setDraft(current => ({ ...current, [key]: value }));
    setStatus('');
  }

  function publish(event) {
    event.preventDefault();
    run(async () => {
      const value = await api('home/contacts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      });
      setStatus('Контакти опубліковано.');
      return value;
    });
  }

  return <form className="home-contacts-editor" onSubmit={publish}>
    <h2>Контакти</h2>
    {draft && <fieldset disabled={busy}>
      <div className="editor-fields">
        <label>Адреса<input required maxLength={200} placeholder="Львів, Україна"
          value={draft.address ?? ''} onChange={event => edit('address', event.target.value)} /></label>
        <label>Телефон<input type="tel" required maxLength={32} placeholder="+380 98 437 41 97"
          value={draft.phone} onChange={event => edit('phone', event.target.value)} /></label>
        <label>Telegram<input required maxLength={64} placeholder="@ім’я або https://t.me/username"
          autoCapitalize="none" spellCheck={false} value={draft.telegram}
          onChange={event => edit('telegram', event.target.value)} /></label>
        <label>Telegram-бот для менеджерів<input type="url" required maxLength={256}
          placeholder="https://t.me/YourBot?start=website" autoCapitalize="none" spellCheck={false}
          value={draft.partnerBot ?? ''} onChange={event => edit('partnerBot', event.target.value)} /></label>
        <label>Електронна пошта<input type="email" required maxLength={254} placeholder="name@example.com"
          autoCapitalize="none" spellCheck={false} value={draft.email} onChange={event => edit('email', event.target.value)} /></label>
      </div>
      <p className="editor-muted">Вкажіть номер з кодом країни та ім’я користувача Telegram або посилання на його профіль.</p>
      <button type="submit" className="editor-primary" disabled={!dirty || conflict}>Зберегти й опублікувати</button>
    </fieldset>}
    {!draft && busy && <p role="status">Завантаження…</p>}
    {error && <p className="editor-error" role="alert">{error}</p>}
    {(!draft && !busy || conflict) && <button type="button" disabled={busy} onClick={() => {
      if (!dirty || confirm('Замінити незбережені правки актуальними контактами?')) load();
    }}>Завантажити актуальні контакти</button>}
    {status && <p role="status">{status}</p>}
  </form>;
}

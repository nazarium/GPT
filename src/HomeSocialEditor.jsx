import { useEffect, useState } from 'react';
import { useUnsavedChanges } from './useUnsavedChanges.js';

const defaultImage = 'assets/logo-original.png';

export function HomeSocialEditor({ api }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  useUnsavedChanges(dirty);

  async function run(action) {
    setBusy(true);
    setError('');
    setStatus('');
    try { await action(); }
    catch (error) {
      setError(error.message);
      if (error.status === 409) setConflict(true);
    } finally { setBusy(false); }
  }

  function load() {
    return run(async () => {
      setDraft(await api('home/social'));
      setDirty(false);
      setConflict(false);
    });
  }

  useEffect(() => { load(); }, []);

  function edit(values) {
    setDraft(current => ({ ...current, ...values }));
    setDirty(true);
    setStatus('');
  }

  function upload(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    run(async () => {
      if (file.size > 8 * 1024 * 1024) throw new Error('Максимальний розмір фото — 8 МБ.');
      const { image } = await api('home/upload', { method: 'POST', body: file });
      edit({ image });
    });
  }

  function publish(event) {
    event.preventDefault();
    run(async () => {
      setDraft(await api('home/social', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      }));
      setDirty(false);
      setStatus('Картку поширення оновлено.');
    });
  }

  return <form className="home-social-editor" onSubmit={publish}>
    <h2>Прев’ю головної для поширення</h2>
    {draft && <fieldset disabled={busy}>
      <div className="editor-fields">
        <div>
          <label>Назва для поширення<input required maxLength={100} value={draft.title}
            onChange={event => edit({ title: event.target.value })} /></label>
          <label>Короткий опис<textarea rows={3} required maxLength={200} value={draft.description}
            onChange={event => edit({ description: event.target.value })} /></label>
          <label>Фото для поширення<input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} /></label>
          {draft.image !== defaultImage && <button type="button" onClick={() => edit({ image: defaultImage })}>Використати логотип</button>}
          <p className="editor-muted">JPG, PNG або WebP, до 8 МБ. Для картки краще підходить горизонтальне фото.</p>
        </div>
        <div className="home-social-card" aria-label="Макет картки посилання">
          <img src={'/' + draft.image} alt="" />
          <div><small>archi-create.com.ua</small><strong>{draft.title}</strong><p>{draft.description}</p></div>
        </div>
      </div>
      <button type="submit" className="editor-primary" disabled={!dirty || conflict}>Зберегти й опублікувати</button>
    </fieldset>}
    {!draft && busy && <p role="status">Завантаження…</p>}
    {error && <p className="editor-error" role="alert">{error}</p>}
    {(!draft && !busy || conflict) && <button type="button" disabled={busy} onClick={() => {
      if (!dirty || confirm('Замінити незбережену картку актуальними налаштуваннями?')) load();
    }}>Завантажити актуальні налаштування</button>}
    {status && <p role="status">{status}</p>}
  </form>;
}

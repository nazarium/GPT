import { useEffect, useState } from 'react';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { maxHomeCount } from './home-display.mjs';

export function HomeOrderEditor({ api }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [conflict, setConflict] = useState(false);
  const dirty = !!draft && (draft.projects !== saved.projects || draft.articles !== saved.articles
    || Number(draft.projectCount) !== saved.projectCount || Number(draft.articleCount) !== saved.articleCount);
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

  function apply(value) {
    setSaved(value);
    setDraft(value);
    setConflict(false);
  }

  function load() {
    return run(async () => apply(await api('home/order')));
  }

  useEffect(() => { load(); }, []);

  function publish(event) {
    event.preventDefault();
    run(async () => {
      const value = await api('home/order', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, projectCount: Number(draft.projectCount), articleCount: Number(draft.articleCount) }) });
      apply(value);
      setStatus('Порядок показу оновлено.');
    });
  }

  function change(key, value) {
    setDraft(current => ({ ...current, [key]: value }));
    setStatus('');
  }

  function select(key, title) {
    return <label>{title}<select value={draft[key]} onChange={event => change(key, event.target.value)}>
      <option value="ordered">По порядку</option>
      <option value="random">Випадково</option>
    </select></label>;
  }

  function count(key, label) {
    return <label>{label}<input type="number" min={1} max={maxHomeCount} step={1} required
      value={draft[key]} onChange={event => change(key, event.target.value)} /></label>;
  }

  return <form className="home-order-editor" onSubmit={publish}>
    <h2>Порядок показу портфоліо та статтей</h2>
    {draft && <fieldset disabled={busy}>
      <div className="editor-fields">
        <div>{select('projects', 'Проєкти портфоліо')}{count('projectCount', 'Кількість проєктів')}</div>
        <div>{select('articles', 'Статті на головній')}{count('articleCount', 'Кількість статей')}</div>
      </div>
      <p className="editor-muted">«По порядку» показує проєкти у заданій черзі, а статті — від найновіших. «Випадково» оновлює добірку при відкритті головної. Решту проєктів можна відкрити кнопкою «Показати ще».</p>
      <button type="submit" className="editor-primary" disabled={!dirty || conflict}>Зберегти порядок показу</button>
    </fieldset>}
    {!draft && busy && <p role="status">Завантаження…</p>}
    {error && <p className="editor-error" role="alert">{error}</p>}
    {(!draft && !busy || conflict) && <button type="button" disabled={busy} onClick={() => {
      if (!dirty || confirm('Замінити незбережений порядок актуальними налаштуваннями?')) load();
    }}>Завантажити актуальні налаштування</button>}
    {status && <p role="status">{status}</p>}
  </form>;
}

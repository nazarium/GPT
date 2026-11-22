import { useEffect, useState } from 'react';
import { contrastRatio, defaultPalette, paletteFields } from './site-palette.mjs';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import heroSlides from '../content/hero.json';

const fields = Object.entries(paletteFields);
const contrastPairs = [
  ['ink', 'paper', 'Основний текст на фоні сторінки'],
  ['muted', 'paper', 'Другорядний текст на фоні сторінки'],
  ['accent', 'paper', 'Акцентний текст на фоні сторінки'],
  ['ink', 'surface', 'Текст на кнопках і полях'],
  ['muted', 'surface', 'Підказки в полях'],
];

export function HomePaletteEditor({ api }) {
  const [saved, setSaved] = useState(null);
  const [colors, setColors] = useState(null);
  const [busy, setBusy] = useState(true);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const dirty = !!colors && fields.some(([key]) => colors[key] !== saved.colors[key]);
  useUnsavedChanges(dirty);

  async function run(action, message = '') {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const value = await action();
      setSaved(value);
      setColors(value.colors);
      setConflict(false);
      setStatus(message);
    } catch (error) {
      setError(error.message);
      if (error.status === 409) setConflict(true);
    } finally { setBusy(false); }
  }

  const load = () => run(() => api('home/palette'));
  useEffect(() => { load(); }, []);

  function publish(event) {
    event.preventDefault();
    run(() => api('home/palette', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: saved.revision, colors }),
    }), 'Палітру опубліковано на сайті.');
  }

  const warnings = colors ? contrastPairs
    .map(([foreground, background, label]) => ({ label, ratio: contrastRatio(colors[foreground], colors[background]) }))
    .filter(({ ratio }) => ratio < 4.5) : [];

  return <form onSubmit={publish} aria-labelledby="home-palette-title">
      <h2 id="home-palette-title">Кольорова гама</h2>
      <p className="editor-muted">Опубліковані кольори застосовуються до всього публічного сайту, включно з портфоліо й блогом.</p>
      {colors && <fieldset disabled={busy}>
        <div className="home-palette-layout">
          <div>
            {fields.map(([key, label]) => <label className="home-palette-field" key={key}>
              <span>{label}</span>
              <input type="color" value={colors[key]} onChange={event => {
                setColors({ ...colors, [key]: event.target.value });
                setStatus('');
              }} />
              <code aria-hidden="true">{colors[key].toUpperCase()}</code>
            </label>)}
          </div>
          <div>
            <h4>Попередній перегляд</h4>
            <div className="home-palette-preview" style={{
              '--sample-paper': colors.paper, '--sample-ink': colors.ink, '--sample-muted': colors.muted,
              '--sample-accent': colors.accent, '--sample-surface': colors.surface,
            }}>
              <strong className="home-palette-sample-heading">Архітектура, яку <em>відчуваєш.</em></strong>
              <span className="home-palette-sample-button">Дивитися проєкти ↗</span>
              <figure className="home-palette-sample-card">
                <img src={'/' + heroSlides[0].image} alt="" loading="lazy" />
                <figcaption><strong>Сучасний особняк</strong><small>Архітектура · Особняки</small></figcaption>
              </figure>
            </div>
          </div>
        </div>
        <div className="home-palette-warnings" aria-live="polite">
          {warnings.length > 0 && <>
            <strong>Низький контраст</strong>
            <p>Для звичайного тексту орієнтир — щонайменше 4,5:1.</p>
            <ul>{warnings.map(({ label, ratio }) => <li key={label}>{label} — {ratio.toLocaleString('uk-UA', { maximumFractionDigits: 2 })}:1</li>)}</ul>
          </>}
        </div>
        <div className="home-palette-actions">
          <button type="submit" className="editor-primary" disabled={!dirty || conflict}>Опублікувати палітру</button>
          <button type="button" disabled={fields.every(([key]) => colors[key] === defaultPalette[key])} onClick={() => {
            setColors(defaultPalette);
            setStatus('Початкові кольори підставлено. Опублікуйте палітру, щоб застосувати їх на сайті.');
          }}>Відновити початкові кольори</button>
        </div>
      </fieldset>}
      {!colors && busy && <p role="status">Завантаження…</p>}
      {error && <p className="editor-error" role="alert">{error}</p>}
      {(!colors && !busy || conflict) && <button type="button" disabled={busy} onClick={() => {
        if (!dirty || confirm('Замінити незбережені правки актуальною палітрою?')) load();
      }}>Завантажити актуальні кольори</button>}
      {status && <p role="status">{status}</p>}
  </form>;
}

import { useEffect, useState } from 'react';
import { defaultFonts, siteFonts } from './site-fonts.mjs';
import { useUnsavedChanges } from './useUnsavedChanges.js';

const fields = [
  ['heading', 'Шрифт заголовків'],
  ['body', 'Шрифт основного тексту'],
];

export function HomeTypographyEditor({ api }) {
  const [saved, setSaved] = useState(null);
  const [fonts, setFonts] = useState(null);
  const [busy, setBusy] = useState(true);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const dirty = !!fonts && fields.some(([key]) => fonts[key] !== saved.fonts[key]);
  useUnsavedChanges(dirty);

  async function run(action, message = '') {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const value = await action();
      setSaved(value);
      setFonts(value.fonts);
      setConflict(false);
      setStatus(message);
    } catch (error) {
      setError(error.message);
      if (error.status === 409) setConflict(true);
    } finally { setBusy(false); }
  }

  const load = () => run(() => api('home/typography'));
  useEffect(() => { load(); }, []);

  function publish(event) {
    event.preventDefault();
    run(() => api('home/typography', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: saved.revision, fonts }),
    }), 'Шрифти опубліковано на сайті.');
  }

  return <form className="home-typography-editor" onSubmit={publish} aria-labelledby="home-typography-title">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" />
    <h2 id="home-typography-title">Шрифти</h2>
    <p className="editor-muted">Вибрані шрифти застосовуються до заголовків і тексту всього публічного сайту, включно з портфоліо й блогом.</p>
    {fonts && <fieldset disabled={busy}>
      <div className="home-palette-layout">
        <div>
          {fields.map(([key, label]) => <label key={key}>{label}
            <select value={fonts[key]} onChange={event => {
              setFonts({ ...fonts, [key]: event.target.value });
              setStatus('');
            }}>
              {Object.entries(siteFonts).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>)}
        </div>
        <div>
          <h4>Попередній перегляд</h4>
          <div className="home-palette-preview home-font-preview" style={{ fontFamily: siteFonts[fonts.body].stack }}>
            <strong className="home-palette-sample-heading" style={{ fontFamily: siteFonts[fonts.heading].stack }}>Архітектура, яку відчуваєш.</strong>
            <p>Світло, матеріал і простір. Проєктуємо будинки, у яких хочеться залишатися.</p>
            <span className="home-palette-sample-button">Дивитися проєкти ↗</span>
          </div>
        </div>
      </div>
      <div className="home-palette-actions">
        <button type="submit" className="editor-primary" disabled={!dirty || conflict}>Опублікувати шрифти</button>
        <button type="button" disabled={fields.every(([key]) => fonts[key] === defaultFonts[key])} onClick={() => {
          setFonts(defaultFonts);
          setStatus('Початкові шрифти підставлено. Опублікуйте їх, щоб застосувати зміни на сайті.');
        }}>Відновити початкові шрифти</button>
      </div>
    </fieldset>}
    {!fonts && busy && <p role="status">Завантаження…</p>}
    {error && <p className="editor-error" role="alert">{error}</p>}
    {(!fonts && !busy || conflict) && <button type="button" disabled={busy} onClick={() => {
      if (!dirty || confirm('Замінити незбережені правки актуальними шрифтами?')) load();
    }}>Завантажити актуальні шрифти</button>}
    {status && <p role="status">{status}</p>}
  </form>;
}

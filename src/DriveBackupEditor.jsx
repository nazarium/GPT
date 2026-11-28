import {useEffect, useState} from 'react';

export function DriveBackupEditor({api}) {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api('home/drive-backup/status').then(setStatus).catch(error => setMessage(error.message));
  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);
  async function action(name, input = {}) {
    setBusy(true); setMessage('');
    try {
      const result = await api('home/drive-backup/' + name, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)});
      if (result.url) window.location.assign(result.url);
      else await load();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <section className="social-panel">
    <h3>Повна копія на Google Drive</h3>
    <p>Контент і завантажені фото, статичні файли сайту, SQL-копія бази соцмереж D1 та номер Git-коміту. Кожен файл перевіряється за SHA-256.</p>
    {status && <>
      <p>{status.connected ? 'Google Drive підключено.' : 'Google Drive ще не підключено.'}</p>
      {!status.configured && <p>Потрібно налаштувати Google OAuth та ключ резервних копій у Cloudflare.</p>}
      {!status.d1Configured && <p>Потрібно налаштувати дозвіл Cloudflare API на експорт D1.</p>}
      <button type="button" disabled={busy || !status.configured} onClick={() => action('connect')}>{status.connected ? 'Підключити Google повторно' : 'Підключити Google Drive'}</button>
      {status.connected && <button type="button" disabled={busy || status.job?.state === 'running'} onClick={() => action('disconnect')}>Від’єднати Google Drive</button>}
      {status.folder && <a href={'https://drive.google.com/drive/folders/' + status.folder} target="_blank" rel="noreferrer">Відкрити папку копій ↗</a>}
      <label><input type="checkbox" checked={status.enabled} disabled={busy || !status.connected || !status.d1Configured} onChange={event => action('settings', {enabled: event.target.checked})}/>Щомісяця, 1-го числа о 00:00 UTC</label>
      <p>Завершені копії старше 365 днів переміщуються в кошик Google Drive після створення нової копії.</p>
      <button type="button" disabled={busy || !status.connected || !status.d1Configured || status.job?.state === 'running'} onClick={() => action('start')}>Створити повну копію зараз</button>
      {status.job && <p role="status">{({running: 'Створення копії', complete: 'Копію завершено', failed: 'Помилка копіювання'})[status.job.state]} · {status.job.count} / {status.job.total} файлів{status.job.completedAt && ' · ' + new Date(status.job.completedAt).toLocaleString('uk-UA')}{status.job.error && ' · ' + status.job.error}</p>}
      {status.job?.warning && <p role="status">{status.job.warning}</p>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}

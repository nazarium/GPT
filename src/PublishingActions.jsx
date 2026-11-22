export function PublicationStatus({ item }) {
  return <span>{item.trashed ? 'У кошику' : item.hidden ? 'Приховано' : item.hasDraft ? (item.published ? 'Є неопубліковані зміни' : 'Чернетка')
    : item.published ? 'Опубліковано' : 'Нова чернетка'}</span>;
}

export function MaterialFilter({ value, onChange, items }) {
  return <label>Показувати<select value={value} onChange={event => onChange(event.target.value)}>
    <option value="active">Матеріали ({items.filter(item => !item.trashed).length})</option>
    <option value="hidden">Приховані ({items.filter(item => item.hidden && !item.trashed).length})</option>
    <option value="trash">Кошик ({items.filter(item => item.trashed).length})</option>
  </select></label>;
}

export const matchesFilter = (item, filter) => filter === 'trash' ? !!item.trashed
  : !item.trashed && (filter !== 'hidden' || item.hidden);

export function confirmMaterialAction(action, dirty) {
  const messages = {
    hide: 'Приховати опублікований матеріал із сайту?',
    show: 'Показати на сайті останню опубліковану версію? Чернетка публікується окремою кнопкою.',
    trash: 'Перемістити матеріал до кошика? Його можна буде відновити разом із чернеткою.',
    restore: 'Відновити матеріал у прихованому стані?',
  };
  return confirm((dirty ? 'У формі є незбережені правки. Вони будуть втрачені. ' : '') + messages[action]);
}

export function PublishingActions({ item, disabled, label, onPublish, onAction }) {
  return <div className="project-actions" role="group" aria-label={label}>
    {item.trashed
      ? <button type="button" disabled={disabled} onClick={() => onAction('restore')}>Відновити</button>
      : <>
        <button type="button" className="editor-primary" disabled={disabled} onClick={event => {
          if (event.currentTarget.form.reportValidity()) onPublish(event);
        }}>Опублікувати</button>
        <button type="submit" name="action" value="draft" formNoValidate disabled={disabled}>Зберегти чернетку</button>
        <button type="submit" name="action" value="preview" formNoValidate disabled={disabled}>Попередній перегляд</button>
        {item.published && <button type="button" className="project-action-icon" disabled={disabled}
          title={item.hidden ? 'Показати на сайті' : 'Приховати'} aria-label={item.hidden ? 'Показати на сайті' : 'Приховати'}
          onClick={() => onAction(item.hidden ? 'show' : 'hide')}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" />
            {item.hidden && <path d="m3 3 18 18" />}
          </svg>
        </button>}
        {item.id && <button type="button" className="project-action-icon" disabled={disabled}
          title="До кошика" aria-label="До кошика" onClick={() => onAction('trash')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg>
        </button>}
      </>}
  </div>;
}

import { useEffect, useRef } from 'react';

export function PreviewDialog({ url, onClose }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="preview-dialog" onClose={onClose}>
    <button type="button" className="preview-close" aria-label="Закрити перегляд" title="Закрити перегляд"
      onClick={() => dialog.current.close()}><span aria-hidden="true">×</span></button>
    <iframe title="Попередній перегляд матеріалу" src={url} />
  </dialog>;
}

import { useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { youtubeEmbedUrl } from './youtube.mjs';
import { accentIsActive, toggleTextAccent } from './text-accent.mjs';
import { articleAlreadyLinked } from './article-crosslinks.mjs';
import { articlePath } from './article-address.mjs';
import { escapeHtml } from './article-text.mjs';

function FormatIcon({ name }) {
  const paths = {
    bold: 'M6 4h7a4 4 0 0 1 0 8H6V4Zm0 8h8a4 4 0 0 1 0 8H6v-8Z',
    italic: 'M10 4h10M4 20h10M15 4 9 20',
    underline: 'M6 3v8a6 6 0 0 0 12 0V3M4 21h16',
    accent: 'm15 3 6 6-10 10H5v-6L15 3ZM12 6l6 6M5 19l-2 2h8',
    p: 'M14 4H9a5 5 0 0 0 0 10h5M14 4v16M19 4v16M11 4h10',
    h2: 'M3 5v14M12 5v14M3 12h9M16 13a3 3 0 0 1 6 0c0 2-6 4-6 7h6',
    insertUnorderedList: 'M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01',
    unlink: 'm3 3 18 18M8 8l-4 4a5 5 0 0 0 7 7l3-3M16 16l4-4a5 5 0 0 0-7-7l-3 3',
    link: 'm10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
    video: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm6 4 5 3-5 3V9Z',
    instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Zm9 9a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm1-5h.01',
    tiktok: 'M14 3v12a5 5 0 1 1-5-5v4a1 1 0 1 0 1 1V3h4c.5 3 2 4 5 4v4a9 9 0 0 1-5-2',
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}

const socialLinks = {
  instagram: { name: 'Instagram', domain: 'instagram.com', placeholder: 'https://www.instagram.com/…' },
  tiktok: { name: 'TikTok', domain: 'tiktok.com', placeholder: 'https://www.tiktok.com/@…' },
};

export function RichTextEditor({ value, onChange, disabled, allowVideo = false, iconToolbar = false, editorApiRef = null, label = 'Текст статті' }) {
  const editor = useRef(null);
  const savedSelection = useRef(null);
  const linkDialog = useRef(null);
  const previewTimer = useRef(null);
  const [link, setLink] = useState(null);
  const [linkPreview, setLinkPreview] = useState(null);
  const [formatting, setFormatting] = useState({ block: '', bold: false, italic: false, underline: false, list: false, accent: false, hasSelection: false });
  const labelId = useId();
  useEffect(() => {
    if (editor.current.innerHTML !== value) {
      editor.current.innerHTML = value;
      savedSelection.current = null;
    }
    if (allowVideo) {
      for (const block of editor.current.querySelectorAll('.article-video')) {
        if (block.querySelector('[data-remove-video]')) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.removeVideo = '';
        button.textContent = 'Прибрати відео';
        block.append(button);
      }
    }
  }, [value, allowVideo]);

  function rememberSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editor.current.contains(selection.anchorNode) || !editor.current.contains(selection.focusNode)) return;
    savedSelection.current = selection.getRangeAt(0).cloneRange();
    const block = document.queryCommandValue('formatBlock').replace(/[<>]/g, '').toLowerCase();
    const next = { block, bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), underline: document.queryCommandState('underline'),
      list: document.queryCommandState('insertUnorderedList'), accent: accentIsActive(editor.current, savedSelection.current),
      hasSelection: !selection.isCollapsed && !!selection.toString().trim() };
    setFormatting(current => Object.keys(next).every(key => current[key] === next[key]) ? current : next);
  }
  useEffect(() => {
    document.addEventListener('selectionchange', rememberSelection);
    return () => document.removeEventListener('selectionchange', rememberSelection);
  }, []);
  useEffect(() => {
    const hide = () => setLinkPreview(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      clearTimeout(previewTimer.current);
    };
  }, []);

  function previewLink(event) {
    const anchor = event.target.closest?.('a');
    if (!anchor || !editor.current.contains(anchor)) return;
    let url;
    try {
      url = new URL(anchor.getAttribute('href'), location.origin);
      if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) return;
    } catch { return; }
    clearTimeout(previewTimer.current);
    const rect = anchor.getBoundingClientRect();
    setLinkPreview({ url: url.href, text: anchor.textContent,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - Math.min(340, window.innerWidth - 24) - 12)),
      top: rect.bottom + 130 < window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - 125) });
  }
  function hidePreviewSoon() {
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => setLinkPreview(null), 180);
  }

  function restoreSelection() {
    editor.current.focus({ preventScroll: true });
    const range = savedSelection.current;
    if (range && editor.current.contains(range.startContainer) && editor.current.contains(range.endContainer)) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  function format(command, argument) {
    if (disabled) return;
    setLinkPreview(null);
    restoreSelection();
    if (command === 'accent') {
      toggleTextAccent(editor.current, savedSelection.current);
      rememberSelection();
      onChange(editor.current.innerHTML);
      return;
    }
    const block = document.queryCommandValue('formatBlock').replace(/[<>]/g, '').toLowerCase();
    const target = command === 'formatBlock' && argument === 'h2' && block === 'h2' ? 'p' : argument;
    document.execCommand(command, false, target);
    rememberSelection();
    onChange(editor.current.innerHTML);
  }
  function openLink() {
    setLinkPreview(null);
    rememberSelection();
    const range = savedSelection.current;
    const node = range?.startContainer;
    const anchor = (node?.nodeType === 1 ? node : node?.parentElement)?.closest('a');
    setLink({ mode: 'link', url: anchor?.getAttribute('href') || '', text: range?.toString() || '', error: '' });
  }
  useEffect(() => {
    if (link && !linkDialog.current.open) {
      linkDialog.current.showModal();
      linkDialog.current.querySelector('input').focus();
    }
  }, [link]);
  function insertContent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (link.mode === 'video') {
      const source = youtubeEmbedUrl(link.url.trim());
      if (!source) {
        setLink(current => ({ ...current, error: 'Вкажіть коректне посилання YouTube або youtu.be.' }));
        return;
      }
      linkDialog.current.close();
      format('insertHTML', '<div class="article-video" contenteditable="false"><iframe src="' + source
        + '" title="Відео YouTube" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>'
        + '<button type="button" data-remove-video>Прибрати відео</button></div><p><br></p>');
      return;
    }
    let url;
    try {
      const address = link.url.trim();
      if (!address) throw new Error();
      url = new URL(address, location.origin);
      if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) throw new Error();
    } catch {
      setLink(current => ({ ...current, error: 'Вкажіть коректну адресу, наприклад https://example.com або /blog.html.' }));
      return;
    }
    const social = socialLinks[link.mode];
    if (social && (url.protocol !== 'https:' || !(url.hostname === social.domain || url.hostname.endsWith('.' + social.domain)))) {
      setLink(current => ({ ...current, error: 'Вкажіть посилання ' + social.name + ', наприклад ' + social.placeholder }));
      return;
    }
    linkDialog.current.close();
    format('createLink', url.href);
  }
  useImperativeHandle(editorApiRef, () => ({
    insertArticleLink(article) {
      if (disabled || articleAlreadyLinked(editor.current, article)) return false;
      const range = document.createRange();
      range.selectNodeContents(editor.current);
      range.collapse(false);
      savedSelection.current = range;
      format('insertParagraph');
      format('insertHTML', 'Читайте також: <a href="' + articlePath(article) + '">' + escapeHtml(article.title) + '</a>');
      return true;
    },
  }));
  return <div className="rich-editor">
    <span id={labelId}>{label}</span>
    <div className={'rich-toolbar' + (iconToolbar ? ' rich-toolbar-icons' : '')} role="group" aria-label="Оформлення тексту">
      {[
        ['Жирний', 'bold'], ['Курсив', 'italic'], ['Підкреслений', 'underline'], ['Акцентний колір', 'accent'], ['Абзац', 'formatBlock', 'p'],
        ['Заголовок', 'formatBlock', 'h2'], ['Список', 'insertUnorderedList'],
      ].filter(([, , argument]) => !iconToolbar || argument !== 'p')
      .map(([label, command, argument]) => <button key={label} type="button" disabled={disabled || command === 'accent' && !formatting.hasSelection} title={command === 'accent' && !formatting.hasSelection ? 'Виділіть текст для зміни кольору' : label} aria-label={label}
        aria-pressed={command === 'formatBlock' ? formatting.block === argument
          : command === 'bold' ? formatting.bold : command === 'italic' ? formatting.italic
            : command === 'underline' ? formatting.underline : command === 'accent' ? formatting.accent : formatting.list}
        onMouseDown={event => event.preventDefault()} onClick={() => format(command, argument)}>{iconToolbar ? <FormatIcon name={argument || command} /> : label}</button>)}
      <button type="button" disabled={disabled} title="Додати посилання" aria-label="Додати посилання" onMouseDown={event => event.preventDefault()} onClick={openLink}>
        {iconToolbar ? <FormatIcon name="link" /> : 'Додати посилання'}</button>
      <button type="button" disabled={disabled} title="Прибрати посилання" aria-label="Прибрати посилання"
        onMouseDown={event => event.preventDefault()} onClick={() => format('unlink')}>
        {iconToolbar ? <FormatIcon name="unlink" /> : 'Прибрати посилання'}
      </button>
      {allowVideo && <button type="button" disabled={disabled} title="Відео YouTube" aria-label="Додати відео YouTube" onMouseDown={event => event.preventDefault()} onClick={() => {
        rememberSelection();
        setLinkPreview(null);
        setLink({ mode: 'video', url: '', text: '', error: '' });
      }}>{iconToolbar ? <FormatIcon name="video" /> : '＋ Відео YouTube'}</button>}
      {allowVideo && Object.entries(socialLinks).map(([mode, social]) => <button key={mode} type="button" disabled={disabled}
        title={'Додати посилання на ' + social.name} aria-label={'Додати посилання на ' + social.name}
        onMouseDown={event => event.preventDefault()} onClick={() => {
          rememberSelection();
          setLinkPreview(null);
          setLink({ mode, url: '', text: savedSelection.current?.toString() || '', error: '' });
        }}>{iconToolbar ? <FormatIcon name={mode} /> : social.name}</button>)}
    </div>
    {link && createPortal(<dialog ref={linkDialog} className="rich-link-dialog" aria-labelledby={labelId + '-link-title'}
      onClose={() => { setLink(null); restoreSelection(); }}>
      <button type="button" className="preview-close" aria-label="Закрити вікно" onClick={() => linkDialog.current.close()}>×</button>
      <h2 id={labelId + '-link-title'}>{link.mode === 'video' ? 'Додати відео YouTube'
        : socialLinks[link.mode] ? 'Додати посилання на ' + socialLinks[link.mode].name : 'Додати посилання'}</h2>
      {link.text && <p className="editor-muted">Виділений текст · {link.text}</p>}
      <form onSubmit={insertContent}>
        <label>{link.mode === 'video' ? 'Посилання на відео' : 'Адреса посилання'}<input autoFocus required inputMode="url" placeholder={link.mode === 'video' ? 'https://www.youtube.com/watch?v=…'
          : socialLinks[link.mode]?.placeholder || 'https://example.com або /blog.html'} value={link.url}
          onChange={event => setLink(current => ({ ...current, url: event.target.value, error: '' }))} /></label>
        {link.error && <p className="editor-error" role="alert">{link.error}</p>}
        {link.mode === 'video' && youtubeEmbedUrl(link.url.trim()) && <iframe className="rich-video-preview" src={youtubeEmbedUrl(link.url.trim())}
          title="Попередній перегляд відео YouTube" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen />}
        <div className="rich-link-actions"><button type="button" onClick={() => linkDialog.current.close()}>Скасувати</button>
          <button type="submit" className="editor-primary" disabled={disabled}>Застосувати</button></div>
      </form>
    </dialog>, document.body)}
    {linkPreview && createPortal(<div className="rich-link-preview" role="tooltip" style={{ left: linkPreview.left, top: linkPreview.top }}
      onMouseEnter={() => clearTimeout(previewTimer.current)} onMouseLeave={hidePreviewSoon}>
      <strong>{linkPreview.text || 'Посилання'}</strong>
      <span>{linkPreview.url}</span>
      <a href={linkPreview.url} target="_blank" rel="noopener noreferrer">Відкрити ↗</a>
    </div>, document.body)}
    <div ref={editor} className="rich-body" role="textbox" aria-labelledby={labelId}
      aria-multiline="true" aria-disabled={disabled} contentEditable={!disabled} suppressContentEditableWarning
      onInput={event => onChange(event.currentTarget.innerHTML)}
      onMouseOver={previewLink}
      onMouseOut={hidePreviewSoon}
      onFocusCapture={previewLink}
      onBlur={hidePreviewSoon}
      onKeyDown={event => { if (event.key === 'Escape') setLinkPreview(null); }}
      onClick={event => {
        if (!disabled && event.target.closest('[data-remove-video]')) {
          event.target.closest('.article-video')?.remove();
          onChange(editor.current.innerHTML);
        }
      }}
      onPaste={event => {
        event.preventDefault();
        format('insertText', event.clipboardData.getData('text/plain'));
      }} onDrop={event => event.preventDefault()} />
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { defaultContactTexts } from './home-text-fields.mjs';
import { defaultContacts, emailHref, phoneHref, telegramHref } from './contact-settings.mjs';

function ContactForm({ telegram, contactBot }) {
  const [result, setResult] = useState('');
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  async function submit(event) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const name = fields.get('name').trim();
    const phone = fields.get('phone').trim();
    const message = fields.get('message').trim();
    for (const key of ['name', 'message']) {
      const field = form.elements[key];
      field.setCustomValidity(field.value.trim() ? '' : 'Будь ласка, заповніть це поле.');
      if (!field.reportValidity()) return;
    }
    const digits = phone.replace(/\D/g, '').length;
    const phoneField = form.elements.phone;
    if (!/^[+0-9()\s.\-]+$/.test(phone) || digits < 7 || digits > 15) {
      phoneField.setCustomValidity('Вкажіть номер телефону від 7 до 15 цифр.');
      phoneField.reportValidity();
      return;
    }
    if (!contactBot) {
      setResult([
        'Вітаю! Звернення із сайту Archi-Create.', '', 'Ім’я: ' + name, 'Телефон: ' + phone,
        '', message,
      ].join('\n'));
      return;
    }
    inFlight.current = true;
    setSending(true);
    setResult('');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, message }),
      });
      const data = await response.json();
      if (response.ok && data.ok === true) {
        form.reset();
        setResult('Дякуємо! Заявку надіслано. Ми зв’яжемося з вами за вказаним номером.');
      } else {
        setResult(data.error || 'Не вдалося підтвердити доставку. Спробуйте ще раз.');
      }
    } catch {
      setResult('Не вдалося підтвердити доставку. Спробуйте ще раз або скористайтеся контактами поруч.');
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return <form id="contact-form" className="contact-form" method="post" onSubmit={submit} onInput={event => {
    event.target.setCustomValidity('');
    setResult('');
  }}>
    <fieldset disabled={!ready || sending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: 24 }}>
    <div className="contact-fields">
      <label>Ваше ім’я <span aria-hidden="true">*</span><input name="name" autoComplete="name" required maxLength={80} placeholder="Як до вас звертатися?" /></label>
      <label>Телефон <span aria-hidden="true">*</span><input type="tel" name="phone" autoComplete="tel" required maxLength={25} placeholder="+380 …" /></label>
    </div>
    <label>Повідомлення <span aria-hidden="true">*</span><textarea name="message" rows={4} required maxLength={1800} placeholder="Що плануєте: будинок, інтер’єр чи інший проєкт?" /></label>
    <button className="contact-submit" type="submit">
      {contactBot ? (sending ? 'Надсилаємо…' : 'Надіслати заявку') : 'Підготувати повідомлення'} <span aria-hidden="true">↗</span>
    </button>
    </fieldset>
    {contactBot && <p className="contact-hint">Заявка надходить команді Archi-Create через Telegram. <a href="/privacy-policy.html">Політика конфіденційності</a></p>}
    {!ready && <p role="status">Форма завантажується. Ви також можете <a href={telegram}>написати нам у Telegram</a>.</p>}
    {contactBot ? <div role="status" className={result ? 'contact-result' : undefined}>{result && <p>{result}</p>}</div>
      : result && <div className="contact-result">
        <p role="status">Повідомлення готове до надсилання.</p>
        <textarea rows={5} readOnly aria-label="Підготовлене повідомлення" value={result} />
        <a className="contact-action" href={telegram + '?text=' + encodeURIComponent(result)} target="_blank" rel="noopener noreferrer">
          Відкрити чат Telegram <span aria-hidden="true">↗</span>
        </a>
      </div>}
  </form>;
}

export function Contact({ heading, intro = defaultContactTexts.contactIntro, contacts = defaultContacts, contactBot = false }) {
  const telephone = phoneHref(contacts.phone);
  const telegram = telegramHref(contacts.telegram);
  return <section id="contact" className="contact section">
    <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: heading }} />
    <div className="contact-layout">
      <div className="contact-details">
        <p style={{ whiteSpace: 'pre-line' }}>{intro}</p>
        <div className="contact-info">
          <div className="contact-info-row">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
            <p className="contact-location">{contacts.address ?? defaultContacts.address}</p>
          </div>
          <div className="contact-info-row">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m7 3 3 5-3 3a16 16 0 0 0 6 6l3-3 5 3v3a2 2 0 0 1-2 2C9.6 22 2 14.4 2 5a2 2 0 0 1 2-2Z" /></svg>
            <a className="contact-phone" href={telephone}>{contacts.phone}</a>
          </div>
          <div className="contact-info-row">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></svg>
            <a className="contact-email" href={emailHref(contacts.email ?? defaultContacts.email)}>{contacts.email ?? defaultContacts.email}</a>
          </div>
        </div>
        <div className="contact-actions">
          <a className="contact-action" href={telephone}>Зателефонувати <span aria-hidden="true">↗</span></a>
          <a className="contact-action" href={telegram} target="_blank" rel="noopener noreferrer">Telegram <span aria-hidden="true">↗</span></a>
        </div>
        <div className="contact-partners">
          <p className="contact-partners-label">Менеджерам з продажу:</p>
          <a className="contact-action" href={contacts.partnerBot ?? defaultContacts.partnerBot}
            target="_blank" rel="noopener noreferrer" aria-label="Запропонувати співпрацю — відкрити Telegram-бота Archi-Create">
            Запропонувати співпрацю <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
      <ContactForm telegram={telegram} contactBot={contactBot} />
    </div>
  </section>;
}

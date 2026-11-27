
function reply(status, error) {
  return Response.json(error ? { error } : { ok: true }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function contactBotConfigured(env) {
  return Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_CHAT_ID?.trim() && env.CONTACT_RATE_LIMIT);
}

export async function submitContact(request, env, readBody) {
  if (request.method !== 'POST') return reply(405, 'Метод не підтримується.');
  if (request.headers.get('Origin') !== new URL(request.url).origin
      || request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
    return reply(403, 'Запит відхилено.');
  }

  let fields;
  try {
    fields = JSON.parse(new TextDecoder().decode(await readBody(request, 16 * 1024)));
  } catch {
    return reply(400, 'Не вдалося прочитати заявку.');
  }
  const clean = key => typeof fields?.[key] === 'string' ? fields[key].trim() : '';
  const name = clean('name');
  const phone = clean('phone');
  const message = clean('message');
  const digits = phone.replace(/\D/g, '').length;
  if (!name || name.length > 80 || !message || message.length > 1800
      || phone.length > 25 || !/^[+0-9()\s.\-]+$/.test(phone) || digits < 7 || digits > 15) {
    return reply(400, 'Перевірте ім’я, телефон і повідомлення.');
  }

  if (!contactBotConfigured(env)) return reply(503, 'Форма тимчасово недоступна. Скористайтеся контактами поруч.');
  const token = env.TELEGRAM_BOT_TOKEN.trim();
  const chatId = env.TELEGRAM_CHAT_ID.trim();

  const { success } = await env.CONTACT_RATE_LIMIT.limit({
    key: request.headers.get('CF-Connecting-IP') || 'unknown',
  });
  if (!success) return reply(429, 'Забагато спроб. Зачекайте хвилину й повторіть.');

  const text = [
    'Нова заявка із сайту Archi-Create',
    '',
    'Ім’я: ' + name,
    'Телефон: ' + phone,
    '',
    message,
  ].join('\n');
  try {
    const result = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(8000),
    });
    if (result.ok && (await result.json()).ok === true) return reply(200);
  } catch {
    // Return a generic delivery error without exposing credentials or form data.
  }
  return reply(502, 'Не вдалося підтвердити доставку. Спробуйте ще раз або скористайтеся контактами поруч.');
}

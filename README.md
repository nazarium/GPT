# Archi-Create

Сайт архітектурної студії на React. Збірка генерує статичні HTML-сторінки, а React підключає меню, портфоліо, галерею та контактну форму в браузері.

```sh
pnpm install
pnpm build
pnpm preview
```

Локальна адреса: http://127.0.0.1:4173/. Готові файли для Cloudflare містяться в `dist/`.

- `src/` — React-компоненти.
- `content/` — тексти сторінок і дані портфоліо. HTML-фрагменти з попередньої версії зберігають розмітку статей та статичних блоків.
- `public/` — стилі, зображення та відомості про джерела.

Контактна форма надсилає заявку через Worker у Telegram. Створіть бота через @BotFather, відкрийте чат із ботом і натисніть Start або додайте його в групу. Дізнайтеся ID чату з поля `message.chat.id` у відповіді Telegram Bot API `getUpdates` після повідомлення боту.

Додайте в Worker `archi-create` два секрети через Cloudflare Dashboard → Settings → Variables and Secrets або з термінала:

```sh
pnpm dlx wrangler@4.156.1 secret put TELEGRAM_BOT_TOKEN
pnpm dlx wrangler@4.156.1 secret put TELEGRAM_CHAT_ID
```

Для локальної перевірки доставки потрібен `wrangler dev` і ці ж значення у локальному файлі `.dev.vars`, який не слід додавати до Git. Статичний перегляд через `pnpm preview` не запускає API форми.

Для локального редагування проєктів після основної збірки запустіть:

```sh
node scripts/build-admin.mjs
node scripts/preview.mjs --admin
```

Адмінпанель для локального режиму: http://127.0.0.1:4174/admin. Дані записуються до `content/projects.json`, а фото — до `public/assets/projects/uploads/`. Оновіть локальне портфоліо на тому ж порту, щоб побачити зміни.

Для хмарної адмінпанелі зберіть сайт і адмінпанель, увійдіть у Cloudflare та розгорніть Worker:

```sh
pnpm build
node scripts/build-admin.mjs
pnpm dlx wrangler@4.156.1 login
pnpm dlx wrangler@4.156.1 deploy
pnpm dlx wrangler@4.156.1 secret put ADMIN_PASSWORD
```

Виберіть унікальний пароль із 24 або більше ASCII-символів. Вхід на `/admin` використовує ім’я `admin`. Хмарний редактор зберігає зміни у Durable Object, і портфоліо показує їх після оновлення сторінки без повторної збірки.

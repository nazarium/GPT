# Передача розробнику

Цей пакет містить специфікацію, план, сценарій, початковий код і локальні тести проєкту Telegram-бота Archi-Create Partners. Він не містить секретів і не є готовим до публікації без налаштування та приватного запуску.

## Почати тут

1. Прочитайте `PLAN.md`, `ARCHITECTURE.md`, `DATA-SCHEMA.md` та `worker/README.md`.
2. Вивчіть `STAGE-2-BOT-SCENARIO.md` як погоджену поведінку постачальника.
3. Вихідний Google Apps Script: `apps-script/Integration.gs`, `Dialog.gs`, `Runtime.gs`, `Bridge.gs`. `Bridge.gs` — локальна заготовка, live-проєкт не оновлювався.
4. Cloudflare Worker: `worker/src/`. Конфігурація окрема від сайту в `worker/wrangler.jsonc`, режим вимкнений.
5. З кореня репозиторію запускайте команди з `worker/README.md`. Використовуйте сумісну версію Wrangler/esbuild/Miniflare проєкту; окремий package-lock для цього пакета не додавався.

## На момент передачі

- Живий Apps Script ще працює у раніше підготовленому ручному приватному polling режимі; webhook не підключений.
- У Google уже є приватна таблиця/Drive, Apps Script та успішний тестовий текстовий запис. Повні ідентифікатори хмарних ресурсів у цьому пакеті навмисно опущено; отримайте їх через власника або безпечне підключення.
- Локально підготовлено Apps Script bridge, що очікує Script Properties: `GOOGLE_BRIDGE_SECRET`, `BRIDGE_MODE`, наявні `TEST_TELEGRAM_USER_ID` і `TELEGRAM_BOT_TOKEN`.
- Worker Secrets: `TELEGRAM_WEBHOOK_SECRET`, `INBOX_ADMIN_SECRET`, `GOOGLE_BRIDGE_SECRET`, `TELEGRAM_BOT_TOKEN`. URL bridge: `GOOGLE_BRIDGE_URL` як звичайна змінна Worker.
- Не використовуйте та не запитуйте секрети через чат або git. Під час живого тесту працюйте в акаунтах власника через керований доступ.
- Пакет не містить постачальницьких контактів, живого експорту Sheets або Drive документів.

## Послідовність запуску

Перед деплоєм перевірити тариф/квоти Cloudflare, погодити збереження чернеток у Cloudflare, зробити backup Google-коду й даних, узгодити старі planned/outbox події. Потім підключити bridge, спершу перевірити його snapshot/commit із тестовим користувачем, розгорнути окремий Worker у вимкненому preview, пройти живі сценарії і лише тоді окремо перевести Telegram polling → webhook із `drop_pending_updates=false`.

Відкат вимагає зберегти прийняті updates і експортувати стан із захищеного `/ops/session`. Спершу перенести стан у Google, тільки після цього поновлювати polling. Успішний `deleteWebhook` сам по собі не повертає раніше підтверджені Worker updates.

## Склад архіву

Архів включає план етапів 1–7, специфікацію сценарію, setup/тестові нотатки, схему й архітектуру, Apps Script вихідники, Worker вихідники/конфіг, тести та згенерований `build/webhook/Code.gs`. Збірки `worker-bundle`, скриншоти, XLSX-експорт та node_modules виключені; Worker bundle відтворюється командою Wrangler dry-run.

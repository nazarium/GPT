# Схема даних Archi-Create Partners

## Google Sheets — бізнес-реєстр

### `Постачальники`

| Поле | Значення |
|---|---|
| supplier_id | Стабільний ідентифікатор компанії (`s` + Telegram update ID) |
| telegram_user_id | Telegram ID власника запису, зберігати як текст |
| telegram_chat_id | Приватний чат для подальшого діалогу |
| telegram_username | Username на момент останньої взаємодії |
| company_name | Обов'язкова назва компанії |
| contact | Обов'язковий контакт |
| categories, brands, regions, terms | Необов'язкові текстові поля |
| drive_folder_id | ID приватної папки компанії у Drive |
| status | Стан картки |
| created_at, updated_at, confirmed_at | Часові позначки ISO |

### `Пропозиції`

`offer_id` (стабільний `o` + update ID), `supplier_id`, `text`, `status`, `created_at`, `updated_at`.

### `Матеріали`

`material_id` (стабільний `m` + update ID), `offer_id`, `kind` (`file`/`link`), `original_name`, `drive_file_id`, `source_url`, `mime_type`, `size_bytes`, `status`, `created_at`, `updated_at`.

### Технічні аркуші Apps Script

| Аркуш | Ключ | Призначення |
|---|---|---|
| `_Sessions` | actor_id | Поточна чернетка в активному Apps Script polling |
| `_Updates` | update_id | Старий журнал polling: `planned`/`applied` |
| `_Outbox` | reply_id | Старі відповіді polling: `pending`/`sent` |
| `_BridgeOperations` | operation_id | Ідемпотентний журнал Google bridge: actor, digest, phase, результат |

`_BridgeOperations` додається до схеми через `prepareBotStorage()`. Бізнес-вміст доступний власнику; постачальник не отримує прямого доступу до таблиці.

## Cloudflare SQLite Durable Object

### `inbox`

| Поле | Значення |
|---|---|
| update_id | PRIMARY KEY; дедуплікація Telegram |
| body | JSON Telegram update, очищається після успіху |
| received_at | Час приймання (epoch ms) |
| completed_at | Час підтвердження обробки |
| alerted_at | Останній сигнал простроченої події |

### `processor`

Ключ-значення JSON для `session` (стан reducer, Google context, час), `job:<update_id>` (план і черга відповіді) та `retry` (кількість спроб і наступний час). Створюється локально у Durable Object.

## Валідація та власність

- Кожна компанія прив'язана до числового Telegram user ID; запит на зміну перевіряється bridge проти цього ID.
- `drive_file_id` з чернетки можна використати лише якщо він уже належить матеріалу цієї пропозиції.
- Новий файл передається з Telegram у приватну Drive-папку; файл до 20 MB. Тіла файлів не зберігаються у Cloudflare.
- URL і назва файлу — метадані. Telegram bot token, HMAC secret і admin secret не є даними таблиці та зберігаються лише у Secret/Script Properties.
- Для Google Sheets усі ідентифікатори мають лишатися рядками, щоб не втрачати цифри чи провідні нулі.

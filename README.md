# Book Agent — Editor

Инструмент для редакторов. Загружаешь книгу — агент автоматически делает адаптированные версии по уровням (B2/B1/A2/A1), переводит на выбранные языки, генерирует обложку и картинки к главам. Результат — ZIP архив с готовой структурой файлов для ридера.

---

## Как это работает

```
Редактор загружает EPUB или TXT
        ↓
Агент определяет уровень оригинала (GPT-4o)
        ↓
Каскадная адаптация на английском:
  Оригинал → B2 → B1 → A2 → A1
  (каждый шаг — отдельный прогон, качество выше чем прыжок сразу в A1)
        ↓
Параллельный перевод всех уровней на выбранные языки
  (UK, RU, PL, DE, ES, FR, IT, PT, CZ)
        ↓
Генерация метаданных (book.json, описания на всех языках)
        ↓
Опционально: картинки к главам — двухшаговый процесс:
  GPT-4o-mini анализирует главу (600 слов) → пишет visual prompt →
  GPT Image 1 рисует иллюстрацию (1024×1024, JPEG)
  Стили: Watercolor / Minimalism / Comic
        ↓
Просмотр и редактирование результата прямо на странице
  (Viewer: уровень + язык + список глав + редактируемый текст)
        ↓
Скачать ZIP с готовой структурой (с учётом правок)
```

---

## Структура проекта

```
book-agent-reader/
  worker/
    index.js          ← Cloudflare Worker (backend, API ключи)
    wrangler.toml     ← конфиг Worker
  frontend/
    index.html        ← весь UI (редактор + admin-панель в одном файле)
    admin.html        ← редирект на index.html (устарел)
  BOOK_AGENT_3.md     ← техническое ТЗ / архитектура
  README.md
```

---

## Инфраструктура

```
Cloudflare Pages   → frontend/index.html (editor.*.pages.dev)
Cloudflare Worker  → backend, проксирует OpenAI API
Cloudflare KV      → хранит провайдера, модели адаптации и перевода
GitHub             → репозиторий с кодом (автодеплой на Pages)
```

**Стоимость:** $0/месяц (Cloudflare free tier достаточно).

---

## Безопасность

- **Страница входа** — при открытии сайта показывается полноэкранный логин
  — вводишь `EDITOR_PASSWORD`, пароль проверяется Worker-ом (`/api/auth`)
  — после входа пароль сохраняется в `localStorage` как токен
  — при каждом API-запросе токен отправляется в заголовке `X-Editor-Token`
  — если Worker вернул 401 — оверлей входа появляется снова автоматически
  — кнопка «Sign out» в хедере — очищает localStorage и показывает логин

- **Admin-панель** — отдельный пароль внутри уже залогиненного интерфейса
  — пароль проверяется Worker-ом (`ADMIN_PASSWORD` env var)
  — разблокировка сохраняется в `sessionStorage` (сбрасывается при закрытии вкладки)

---

## API ключи (Worker secrets)

Хранятся в Cloudflare Worker environment variables. Браузер их никогда не видит.

| Secret | Назначение |
|--------|-----------|
| `OPENAI_API_KEY` | GPT-4o (адаптация) + GPT-4o-mini (перевод, промпты) + GPT Image 1 (картинки) |
| `EDITOR_PASSWORD` | Пароль входа для редакторов |
| `ADMIN_PASSWORD` | Пароль admin-панели |
| `GOOGLE_API_KEY` | Google Translate (планируется) |
| `ANTHROPIC_API_KEY` | Claude перевод (планируется) |

---

## Провайдеры и модели

Переключаются через admin-панель (⚙️ в правом верхнем углу).
Настройки хранятся в Cloudflare KV.

### Провайдеры перевода

| Провайдер | Статус | Модель |
|-----------|--------|--------|
| OpenAI | ✅ Активен | настраивается |
| Google Translate | 🔜 Скоро | — |
| Claude | 🔜 Скоро | — |

### Модели (выбираются в Admin → AI Models)

| Операция | Варианты | Дефолт |
|----------|---------|--------|
| Адаптация | gpt-4o-mini / gpt-4o / gpt-4.1-mini / gpt-4.1 | gpt-4o |
| Перевод | gpt-4o-mini / gpt-4o / gpt-4.1-mini / gpt-4.1 | gpt-4o-mini |

---

## Форматы файлов

**Вход:**
- `EPUB` ⭐ — рекомендуется. Агент читает название, автора, главы автоматически.
  При ≥5 главах показывается баннер «Use collection mode» — каждая глава = отдельный рассказ.
- `TXT` — запасной вариант. Агент определяет главы по маркерам или паттернам.
  Если TXT — сборник рассказов без явной структуры, GPT определяет заголовки и разбивает.

**Структура TXT файлов на выходе:**
```
[[CHAPTER: Название главы]]

Текст главы...
(пустая строка между параграфами)
```

**Структура ZIP:**
```
book-slug/
  book.json
  cover.jpg                    ← загруженная или сгенерированная обложка
  desc.en.txt / desc.uk.txt / ...
  levels/
    original/
      book.en.txt
      book.uk.txt / book.ru.txt / ...
      chapter_1.jpg            ← картинка к главе (если включены)
      chapter_2.jpg / ...
    b2/
      book.en.txt
      book.uk.txt / ...
    b1/ a2/ a1/  (аналогично)
```

---

## Стоимость генерации (~200 страниц, 10 глав, 1 язык)

| Операция | Модель | Цена |
|----------|--------|------|
| Определение уровня | GPT-4o | ~$0.01 |
| Адаптация (4 прогона) | GPT-4o | ~$3.00 |
| Перевод (5 уровней × 1 язык) | GPT-4o-mini | ~$0.11 |
| Описания (2 языка) | GPT-4o-mini | ~$0.004 |
| Обложка | GPT Image 1 Medium | ~$0.04 |
| Картинки к главам (10 шт) | GPT Image 1 Medium | ~$0.40 |
| **ИТОГО (1 язык + картинки)** | | **~$3.55** |
| **ИТОГО (9 языков, без картинок)** | | **~$4.00** |

> GPT Image 1: Medium quality 1024×1024 = $0.04/картинка.
> Промпт для каждой главы пишет GPT-4o-mini (~$0.001/глава).

---

## Деплой

### 1. Создать KV namespace

```bash
cd worker
npx wrangler kv:namespace create "KV"
# Скопировать id и preview_id в wrangler.toml
```

### 2. Добавить секреты

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put EDITOR_PASSWORD
npx wrangler secret put ADMIN_PASSWORD
```

### 3. Задеплоить Worker

```bash
npx wrangler deploy
# URL: https://books-agent.englishclubsales.workers.dev
```

### 4. Вставить URL воркера в frontend

В `frontend/index.html`, строка:
```js
const WORKER_URL = 'https://books-agent.englishclubsales.workers.dev';
```

### 5. Деплой фронтенда

- Подключить этот GitHub репо к Cloudflare Pages
- Root directory: `frontend`
- Build command: (пусто)
- Output directory: (пусто)

---

## Worker API endpoints

| Endpoint | Метод | Назначение |
|----------|-------|-----------|
| `/api/auth` | POST | Вход редактора (публичный) |
| `/api/admin/auth` | POST | Вход в admin (публичный) |
| `/api/config` | GET | Текущие настройки (провайдер, модели, ключи) |
| `/api/provider` | POST | Сменить провайдера перевода |
| `/api/models` | POST | Сменить модели адаптации/перевода |
| `/api/structure` | POST | Определить структуру книги (GPT) |
| `/api/detect-level` | POST | Определить уровень оригинала (CEFR) |
| `/api/adapt` | POST | Адаптировать главу под уровень |
| `/api/translate` | POST | Перевести главу |
| `/api/describe` | POST | Сгенерировать описание книги |
| `/api/generate-cover` | POST | Сгенерировать обложку (GPT Image 1) |
| `/api/generate-chapter-image` | POST | Сгенерировать картинку к главе (GPT-4o-mini → GPT Image 1) |

---

## Сессии разработки

| Сессия | Что сделано |
|--------|-------------|
| ✅ 1 | Worker, KV, EPUB/TXT парсер, UI (upload → settings → progress), admin-панель с паролем |
| ✅ 2 | Полный пайплайн: detect level → cascade adaptation → parallel translation → descriptions → ZIP download |
| ✅ 2.5 | Авторизация редакторов: логин-страница, `X-Editor-Token` header, logout, 401 auto-redirect |
| ✅ 2.6 | Gutenberg-клинер (TXT), правила форматирования в промптах (предложения на отдельных строках) |
| ✅ 3 | Определение коллекции (GPT), TOC-детектор, разбивка на рассказы, параллельный пайплайн для коллекций, исправление EPUB-парсера |
| ✅ 4 | Stage 3 Viewer (уровень + язык + главы + редактирование), генерация обложки (GPT Image 1), выбор моделей в admin, EPUB collection mode, normalizeBlocks |
| ✅ 5 | Картинки к главам: GPT-4o-mini пишет visual prompt (600 слов) → GPT Image 1 рисует (watercolor/minimal/comic). Включая первую главу. |
| 🔜 6 | Ридер: отображение chapter_N.jpg перед главами. Batch API (−50% стоимость). GitHub autopush. |

---

## Структура результата в памяти

```javascript
window.bookResults = {
  meta: { title, author, slug, detectedLevel, languages, imageStyle, chaptersCount },
  levels: {
    original: { en: '...', uk: '...', ru: '...', ... },
    b2:       { en: '...', uk: '...', ... },
    b1/a2/a1: { ... },
  },
  descriptions:  { en: '...', uk: '...', ... },
  chapterImages: ['base64jpeg...', 'base64jpeg...', ...],  // null для пропущенных
  cover: File | Blob | null,
}
```

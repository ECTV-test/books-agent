# Book Agent — Editor

Инструмент для редакторов. Загружаешь книгу — агент автоматически делает адаптированные версии по уровням (B2/B1/A2/A1) и переводит на выбранные языки. Результат — ZIP архив с готовой структурой файлов для ридера.

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
Опционально: картинки к главам (GPT Image 1 Mini)
        ↓
Скачать ZIP с готовой структурой
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
  .gitignore
  README.md
```

---

## Инфраструктура

```
Cloudflare Pages   → frontend/index.html (editor.*.pages.dev)
Cloudflare Worker  → backend, проксирует OpenAI API
Cloudflare KV      → хранит активного провайдера переводов
Cloudflare Access  → авторизация редакторов (email whitelist)
GitHub             → репозиторий с кодом (автодеплой на Pages)
```

**Стоимость:** $0/месяц (Cloudflare free tier достаточно).

---

## Безопасность

- **Страница входа** — при открытии сайта показывается полноэкранный логин
  — вводишь `EDITOR_PASSWORD`, пароль проверяется Worker-ом (`/api/auth`)
  — после входа пароль сохраняется в `localStorage` (не выходит из браузера)
  — при каждом API-запросе пароль отправляется в заголовке `X-Editor-Token`
  — если Worker вернул 401 — оверлей входа появляется снова автоматически
  — кнопка «Sign out» в хедере — очищает localStorage и показывает логин

- **Admin-панель** — отдельный пароль внутри уже залогиненного интерфейса
  — пароль проверяется Worker-ом (`ADMIN_PASSWORD` env var)
  — разблокировка сохраняется в `sessionStorage` (сбрасывается при закрытии вкладки)

- **Cloudflare Access** (опционально, платно от 5 польз.)
  — можно добавить поверх для email whitelist

---

## API ключи (Worker secrets)

Хранятся в Cloudflare Worker environment variables. Браузер их никогда не видит.

| Secret | Назначение |
|--------|-----------|
| `OPENAI_API_KEY` | GPT-4o (адаптация) + GPT-4o-mini (перевод) |
| `EDITOR_PASSWORD` | Пароль входа для редакторов (любая строка) |
| `ADMIN_PASSWORD` | Пароль admin-панели (любая строка) |
| `GOOGLE_API_KEY` | Google Translate (планируется) |
| `ANTHROPIC_API_KEY` | Claude Haiku перевод (планируется) |

---

## Провайдеры перевода

Переключаются через admin-панель (⚙️ в правом верхнем углу).
Настройка хранится в Cloudflare KV.

| Провайдер | Статус | Модель |
|-----------|--------|--------|
| OpenAI | ✅ Активен | GPT-4o-mini |
| Google Translate | 🔜 Скоро | — |
| Claude | 🔜 Скоро | Haiku |

---

## Форматы файлов

**Вход:**
- `EPUB` — рекомендуется. Агент читает название, автора, главы автоматически.
- `TXT` — запасной вариант. Агент определяет главы по маркерам или паттернам.

**Выход (TXT файлы):**
```
Две пустые строки между главами.
Маркер глав: [[CHAPTER: Название главы]]
```

**Структура ZIP:**
```
book-slug/
  book.json
  cover.jpg
  desc.en.txt / desc.uk.txt / ...
  levels/
    original/
      book.en.txt
      book.uk.txt / book.ru.txt / ...
    b2/
      book.en.txt
      book.uk.txt / ...
    b1/ a2/ a1/  (аналогично)
```

---

## Стоимость генерации (~200 страниц, 10 глав)

| Вариант | Адаптация | Перевод | Итого |
|---------|-----------|---------|-------|
| GPT-4o + GPT-4o-mini (текущий) | GPT-4o | GPT-4o-mini | ~$4 |
| Batch API −50% | GPT-4o | GPT-4o-mini | ~$2 |
| GPT-4o-mini везде (дешевле) | GPT-4o-mini | GPT-4o-mini | ~$1.36 |

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
npx wrangler secret put EDITOR_PASSWORD   # пароль входа для редакторов
npx wrangler secret put ADMIN_PASSWORD    # пароль admin-панели
```

### 3. Задеплоить Worker

```bash
npx wrangler deploy
# Скопировать URL воркера: https://book-agent-worker.*.workers.dev
```

### 4. Вставить URL воркера в frontend

В `frontend/index.html`, строка:
```js
const WORKER_URL = 'https://book-agent-worker.YOUR_SUBDOMAIN.workers.dev';
```

### 5. Деплой фронтенда

- Подключить этот GitHub репо к Cloudflare Pages
- Root directory: `frontend`
- Build command: (пусто — статический сайт)
- Output directory: (пусто)

### 6. (Опционально) Настроить Cloudflare Access

Для дополнительной защиты (email whitelist, платно от 5 пользователей):
- Cloudflare Dashboard → Zero Trust → Access → Applications
- Добавить приложение: `editor.*.pages.dev`
- Policy: Allow → Emails → список редакторов
- Редактор заходит → вводит email → получает OTP → потом вводит `EDITOR_PASSWORD`

---

## Сессии разработки

| Сессия | Что сделано |
|--------|-------------|
| ✅ 1 | Worker, KV, EPUB/TXT парсер, UI (upload → settings → progress), admin-панель с паролем |
| ✅ 2 | Полный пайплайн: detect level → cascade adaptation → parallel translation → descriptions → ZIP download |
| ✅ 2.5 | Авторизация редакторов: логин-страница (`EDITOR_PASSWORD`), `X-Editor-Token` header, logout, 401 auto-redirect |
| ✅ 2.6 | Препроцесор: Gutenberg-клінер (TXT), правила форматування в промптах (речення на окремих рядках) |
| 🔜 3 | Детекція збірки (GPT), розбивка на окремі книги, Review UI |

## Пайплайн (Сессия 2)

### Логика адаптации
```
Определяем уровень оригинала (GPT-4o, первые ~2000 слов)
  ↓
Каскадная адаптация (только English, главы параллельно, concurrency=3):
  Если оригинал C1/C2:  оригинал → B2 → B1 → A2 → A1
  Если оригинал B2:     оригинал = B2, B2 → B1 → A2 → A1
  Если оригинал B1:     оригинал = B1 = B2, B1 → A2 → A1
  (нет смысла адаптировать "вверх")
```

### Логика перевода
```
Переводим каждую главу каждого уровня на каждый язык (concurrency=8)
Итого задач: 5 уровней × N языков × M глав
Например: 5 × 9 × 10 = 450 задач
```

### Структура результата в памяти
```javascript
window.bookResults = {
  meta:   { title, author, slug, detectedLevel, languages, chaptersCount },
  levels: {
    original: { en: '...', uk: '...', ru: '...', ... },
    b2:       { en: '...', uk: '...', ... },
    b1:       { en: '...', uk: '...', ... },
    a2:       { en: '...', uk: '...', ... },
    a1:       { en: '...', uk: '...', ... },
  },
  descriptions: { en: '...', uk: '...', ... },
  cover: File | null,
}
```

### ZIP структура на выходе
```
{slug}/
  book.json
  cover.jpg
  desc.en.txt / desc.uk.txt / ...
  levels/
    original/ book.en.txt / book.uk.txt / ...
    b2/       book.en.txt / book.uk.txt / ...
    b1/ a2/ a1/ (аналогично)
```

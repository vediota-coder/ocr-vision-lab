# ocr-vision-lab

Лаборатория для экспериментов с OCR и vision-моделями. CLI-обвязка над **Claude Vision** и **OpenAI Vision** с единым интерфейсом.

## Стек

- Node.js + TypeScript (ESM)
- `@anthropic-ai/sdk` — Claude Vision
- `openai` — GPT Vision
- `tsx` для запуска без сборки

## Установка

```bash
npm install
cp .env.example .env   # вставить ANTHROPIC_API_KEY и/или OPENAI_API_KEY
```

## CLI

```bash
# Claude (по умолчанию)
npm run ocr -- path/to/image.png

# GPT
npm run ocr -- --provider gpt path/to/image.png

# Сравнить оба провайдера на одной картинке
npm run ocr -- --provider both path/to/image.png

# С кастомным промптом
npm run ocr -- --provider gpt --prompt "Извлеки только цифры" image.png
```

Флаги:
- `-p, --provider` — `claude` | `gpt` | `both` (по умолчанию `claude`)
- `--prompt` — кастомная инструкция
- `-h, --help` — справка

Модели задаются через ENV: `ANTHROPIC_MODEL` (default `claude-opus-4-7`), `OPENAI_MODEL` (default `gpt-4o`).

## Скрипты

- `npm run dev` — watch-режим
- `npm run ocr -- <image>` — распознать текст
- `npm run build` — сборка в `dist/`
- `npm run typecheck` — проверка типов

## Структура

```
src/
  index.ts            # CLI: парсинг аргументов, выбор провайдера
  providers/
    types.ts          # OcrProvider, OcrImage
    claude.ts         # Anthropic Vision
    openai.ts         # OpenAI Vision
samples/              # тестовые изображения (private/ в .gitignore)
```

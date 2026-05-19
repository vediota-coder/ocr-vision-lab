# ocr-vision-lab

Лаборатория для экспериментов с OCR и vision-моделями (Claude Vision API).

## Стек

- Node.js + TypeScript (ESM)
- `@anthropic-ai/sdk` — Claude Vision
- `tsx` для запуска без сборки

## Запуск

```bash
npm install
cp .env.example .env   # вставить ANTHROPIC_API_KEY
npm run ocr -- path/to/image.png
```

## Скрипты

- `npm run dev` — watch-режим
- `npm run ocr -- <image>` — распознать текст с картинки
- `npm run build` — сборка в `dist/`
- `npm run typecheck` — проверка типов

## Структура

```
src/
  index.ts        # CLI: OCR одной картинки через Claude Vision
samples/          # тестовые изображения (private/ в .gitignore)
```

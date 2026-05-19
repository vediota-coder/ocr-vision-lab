import { claudeJson } from "../providers/claude.js";
import type { VerifiedResult } from "./verify.js";

interface CleanResponse {
  cleaned: { final_text: string; removed: string }[];
  boilerplate: string[];
}

export async function stripBoilerplate(
  pages: VerifiedResult[],
  userInstruction: string,
): Promise<VerifiedResult[]> {
  if (pages.length <= 1) return pages;

  const payload = pages.map((p, i) => ({
    index: i,
    file: p.file,
    text: p.final,
  }));

  const userPart = userInstruction.trim()
    ? `\nДополнительные инструкции пользователя:\n${userInstruction}\n`
    : "";

  const prompt = `Тебе дан массив текстов, распознанных постранично с одного многостраничного документа. Найди ПОВТОРЯЮЩИЕСЯ элементы (колонтитулы, водяные знаки, номера страниц, повторяющиеся реквизиты, рекламные плашки и т.п.), которые встречаются на нескольких страницах и не несут уникального содержания. Удали их из текста каждой страницы. Сохраняй уникальный контент страницы 1:1.${userPart}

Страницы:
${JSON.stringify(payload, null, 2)}

Верни СТРОГО JSON без обёртки и без комментариев:
{
  "boilerplate": ["шаблон1", "шаблон2", ...],
  "cleaned": [
    { "final_text": "...", "removed": "что было удалено или пусто" },
    ...
  ]
}
Массив cleaned должен иметь ту же длину и порядок, что и входные страницы.`;

  let raw: string;
  try {
    raw = await claudeJson(prompt);
  } catch (err) {
    return pages.map((p) => ({
      ...p,
      notes: p.notes
        ? `${p.notes} | filter failed: ${(err as Error).message}`
        : `filter failed: ${(err as Error).message}`,
    }));
  }

  const parsed = parseJson(raw);
  if (!parsed || parsed.cleaned.length !== pages.length) {
    return pages.map((p) => ({
      ...p,
      notes: p.notes ? `${p.notes} | filter: parse failed` : "filter: parse failed",
    }));
  }

  const boilerplateNote =
    parsed.boilerplate.length > 0
      ? `Удалены повторы: ${parsed.boilerplate.slice(0, 5).join(" · ")}`
      : "";

  return pages.map((p, i) => {
    const c = parsed.cleaned[i];
    const removedNote = c.removed && c.removed.trim() ? `Удалено: ${c.removed}` : "";
    const extra = [boilerplateNote, removedNote].filter(Boolean).join(" | ");
    return {
      ...p,
      final: c.final_text,
      notes: p.notes && extra ? `${p.notes} | ${extra}` : p.notes || extra,
    };
  });
}

function parseJson(raw: string): CleanResponse | null {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(stripped) as CleanResponse;
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as CleanResponse;
      } catch {
        return null;
      }
    }
    return null;
  }
}

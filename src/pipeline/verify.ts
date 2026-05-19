import { ClaudeProvider, claudeJson } from "../providers/claude.js";
import { OpenAIProvider } from "../providers/openai.js";

export interface VerifiedResult {
  file: string;
  claude: string;
  gpt: string;
  final: string;
  notes: string;
  agreement: number;
}

const BASE_OCR_PROMPT =
  "Извлеки ВЕСЬ текст с изображения. Сохрани структуру (таблицы, колонки, заголовки, списки). Только текст, без комментариев и markdown-обёртки.";

const claude = new ClaudeProvider();
const openai = new OpenAIProvider();

function buildOcrPrompt(userInstruction: string): string {
  if (!userInstruction.trim()) return BASE_OCR_PROMPT;
  return `${BASE_OCR_PROMPT}\n\nДополнительные инструкции пользователя:\n${userInstruction}`;
}

interface VerifyResponse {
  final_text: string;
  notes: string;
  agreement: number;
}

export async function verifyImage(
  fileLabel: string,
  imagePath: string,
  userInstruction = "",
): Promise<VerifiedResult> {
  const ocrPrompt = buildOcrPrompt(userInstruction);
  const [claudeText, gptText] = await Promise.all([
    claude.ocr(imagePath, ocrPrompt).catch((e) => `[claude error: ${e.message}]`),
    openai.ocr(imagePath, ocrPrompt).catch((e) => `[gpt error: ${e.message}]`),
  ]);

  const extraInstruction = userInstruction.trim()
    ? `\nДополнительные инструкции пользователя (учти при выборе финального текста):\n${userInstruction}\n`
    : "";

  const verifyPrompt = `Ты редактор-корректор OCR. Тебе дают два независимых распознавания одного изображения от разных моделей. Сравни их и выдай финальный, максимально точный текст, объединив сильные стороны обоих. Не дописывай ничего, чего нет в исходниках.${extraInstruction}

Файл: ${fileLabel}

=== Вариант A (Claude) ===
${claudeText}

=== Вариант B (GPT) ===
${gptText}

Верни СТРОГО JSON по схеме:
{
  "final_text": "...",
  "notes": "краткие пометки о расхождениях и решениях",
  "agreement": 0.0
}
agreement — оценка совпадения вариантов от 0 до 1. Никаких других полей, никакого текста до или после JSON.`;

  const raw = await claudeJson(verifyPrompt);
  const parsed = parseJson(raw);

  return {
    file: fileLabel,
    claude: claudeText,
    gpt: gptText,
    final: parsed.final_text,
    notes: parsed.notes,
    agreement: parsed.agreement,
  };
}

function parseJson(raw: string): VerifyResponse {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(stripped) as VerifyResponse;
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as VerifyResponse;
      } catch {
        /* fall through */
      }
    }
    return { final_text: stripped, notes: "JSON parse failed", agreement: 0 };
  }
}

import Anthropic from "@anthropic-ai/sdk";
import { ClaudeProvider } from "../providers/claude.js";
import { OpenAIProvider } from "../providers/openai.js";
import type { OcrImage } from "../providers/types.js";

export interface VerifiedResult {
  file: string;
  claude: string;
  gpt: string;
  final: string;
  notes: string;
  agreement: number;
}

const OCR_PROMPT =
  "Извлеки ВЕСЬ текст с изображения. Сохрани структуру (таблицы, колонки, заголовки, списки). Только текст, без комментариев и markdown-обёртки.";

const VERIFY_SYSTEM =
  "Ты редактор-корректор OCR. Тебе дают два независимых распознавания одного изображения от разных моделей. Твоя задача — выдать финальный, максимально точный текст, объединив сильные стороны обоих результатов и исправив явные ошибки распознавания. Не дописывай ничего, чего нет в исходниках.";

interface VerifyResponse {
  final_text: string;
  notes: string;
  agreement: number;
}

const claude = new ClaudeProvider();
const openai = new OpenAIProvider();
const verifyModel = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";

let _anthropic: Anthropic | undefined;
function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

export async function verifyImage(
  file: string,
  image: OcrImage,
): Promise<VerifiedResult> {
  const [claudeText, gptText] = await Promise.all([
    claude.ocr(image, OCR_PROMPT),
    openai.ocr(image, OCR_PROMPT),
  ]);

  const userPrompt = `Файл: ${file}

=== Вариант A (Claude) ===
${claudeText}

=== Вариант B (GPT) ===
${gptText}

Сравни оба варианта, выдай финальный текст и краткие заметки о расхождениях.
Верни СТРОГО JSON по схеме:
{
  "final_text": "...",
  "notes": "краткие пометки о расхождениях и решениях",
  "agreement": 0.0
}
agreement — оценка совпадения вариантов от 0 до 1.`;

  const response = await getAnthropic().messages.create({
    model: verifyModel,
    max_tokens: 8192,
    system: VERIFY_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const parsed = parseJson(raw);

  return {
    file,
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
    if (match) return JSON.parse(match[0]) as VerifyResponse;
    return { final_text: stripped, notes: "JSON parse failed", agreement: 0 };
  }
}

import type { VerifiedResult } from "./verify.js";

const MIN_PAGES_FOR_FILTER = 3;
const MIN_FREQ_RATIO = 0.2;
const MIN_LINE_LEN = 2;
const MAX_LINE_LEN = 160;

function normKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function stripBoilerplate(
  pages: VerifiedResult[],
  userInstruction: string,
): Promise<VerifiedResult[]> {
  if (pages.length < MIN_PAGES_FOR_FILTER) return pages;

  const lineCounts = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const raw of p.final.split("\n")) {
      const key = normKey(raw);
      if (key.length < MIN_LINE_LEN || key.length > MAX_LINE_LEN) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.ceil(pages.length * MIN_FREQ_RATIO));
  const boilerplate = new Set(
    [...lineCounts.entries()].filter(([, n]) => n >= threshold).map(([s]) => s),
  );

  const note =
    boilerplate.size > 0
      ? `Удалено повторов: ${boilerplate.size} строк (порог ${threshold}/${pages.length} страниц)`
      : "";

  const userNote = userInstruction.trim()
    ? ` · кастомный промпт применён к OCR`
    : "";

  return pages.map((p) => {
    const cleaned = p.final
      .split("\n")
      .filter((ln) => !boilerplate.has(normKey(ln)))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const newNotes = note ? (p.notes ? `${p.notes} | ${note}${userNote}` : `${note}${userNote}`) : p.notes;
    return { ...p, final: cleaned, notes: newNotes };
  });
}

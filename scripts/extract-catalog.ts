import { readFile, writeFile } from "node:fs/promises";

interface Item {
  code: string;
  codePrefix: string;
  brand: string;
  category: string;
  name: string;
  mass: string;
  price: string;
  units: string;
  detail: string;
  page: number;
  pageFile: string;
}

const NOISE_LINE =
  /^(BUY|EXIT|CLEAR ALL|BRANDS|CATEGORIES|SEARCH|SELECT|TOTAL|\$[\d,. ]+|[\d,. ]+ ?kg|△|○|×|□|L[T1] R[T1] PREV)/i;

const PART_CODE_RE = /^([A-Z])(\d{1,3})[-—](\d{3,5})\b/;

function isNoise(line: string): boolean {
  const ln = line.trim();
  if (!ln) return true;
  if (NOISE_LINE.test(ln)) return true;
  if (/^[\$\d,. ]+$/.test(ln)) return true;
  if (/^[\d ]+$/.test(ln)) return true;
  if (/^[△○×□ ]*CATEGORIES.*PREV.*NEXT.*SEARCH.*SELECT/i.test(ln)) return true;
  if (/^(BUY|EXIT|CLEAR ALL)(\s+(BUY|EXIT|CLEAR ALL)){1,2}$/i.test(ln)) return true;
  return false;
}

function isCategoryHeader(line: string): boolean {
  const ln = line.trim();
  if (ln.length < 3 || ln.length > 25) return false;
  if (!/^[A-Z][A-Z &/-]+$/.test(ln)) return false;
  if (isNoise(ln)) return false;
  return true;
}

function splitCols(s: string): string[] {
  return s.split(/\t+| {3,}/).map((x) => x.trim()).filter(Boolean);
}

interface Page {
  no: number;
  file: string;
  agreement: number;
  brand: string;
  items: Item[];
}

function parse(text: string): Page[] {
  const lines = text.split("\n").map((l) => l.replace(/^\[P\]/, "").trimEnd());
  const pages: Page[] = [];
  let p: Page | null = null;
  let currentCategory = "";
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const head = raw.match(/^(\d+)\.\s+(.+?)\s+·\s+(\d+)%\s*$/);
    if (head) {
      if (p) pages.push(p);
      p = {
        no: Number(head[1]),
        file: head[2],
        agreement: Number(head[3]) / 100,
        brand: "",
        items: [],
      };
      currentCategory = "";
      i++;
      // Brand is usually the next non-empty, non-noise line that is NOT a category header (lowercase mixed) OR is uppercase that doesn't match common categories
      while (i < lines.length && !lines[i].match(/^\d+\.\s/)) {
        const ln = lines[i].trim();
        if (!ln || isNoise(ln)) {
          i++;
          continue;
        }
        // Brand candidates: single-word title-case (Jingu) or all-caps (MIDUGA) WITHOUT category meaning
        if (/^[A-Z][a-z]+$/.test(ln) || /^[A-Z][A-Z]+$/.test(ln)) {
          p.brand = ln;
          i++;
          break;
        }
        break;
      }
      continue;
    }
    if (!p) {
      i++;
      continue;
    }

    const ln = raw.trim();
    if (!ln || isNoise(ln)) {
      i++;
      continue;
    }

    if (isCategoryHeader(ln)) {
      currentCategory = ln;
      i++;
      continue;
    }

    const m = ln.match(PART_CODE_RE);
    if (m) {
      const fullCode = `${m[1]}${m[2]}-${m[3]}`;
      const codePrefix = `${m[1]}${m[2]}`;
      const rest = ln.slice(m[0].length).trim();
      const cols = splitCols(rest);
      const nameTokens = cols[0]?.split(/\s+/) ?? [];
      const brandFromCode = nameTokens[0] ?? "";
      const name = cols[0] ?? "";
      const mass = cols.find((c) => /kg|кг/i.test(c)) ?? "";
      const price = cols.find((c) => /\$/.test(c)) ?? "";

      let detail = "";
      let units = "";
      let j = i + 1;
      let detailParts: string[] = [];
      while (j < lines.length) {
        const dl = lines[j].trim();
        if (!dl) {
          j++;
          if (detailParts.length > 0) break;
          continue;
        }
        if (lines[j].match(/^\d+\.\s/)) break;
        if (PART_CODE_RE.test(dl)) break;
        if (isCategoryHeader(dl)) break;
        if (isNoise(dl)) {
          j++;
          continue;
        }
        const u = dl.match(/(\d[\d., ]*)\s*(unit|шт)\b/i);
        if (u && !units) units = u[1].trim();
        detailParts.push(dl.replace(/\s+\d[\d., ]*\s*(unit|шт)\b.*/i, "").trim());
        j++;
      }
      detail = detailParts.filter(Boolean).join(" ").trim();

      const cleanBrand =
        p.brand || brandFromCode.replace(/[^A-Za-zА-Яа-я]/g, "");

      p.items.push({
        code: fullCode,
        codePrefix,
        brand: cleanBrand,
        category: currentCategory || "MISC",
        name,
        mass,
        price,
        units,
        detail,
        page: p.no,
        pageFile: p.file,
      });
      i = j;
      continue;
    }

    i++;
  }

  if (p) pages.push(p);
  return pages;
}

function summarize(items: Item[]): {
  brands: Record<string, number>;
  categories: Record<string, number>;
  subcategoriesByCode: Record<string, Record<string, number>>;
  brandCategoryMatrix: Record<string, Record<string, number>>;
} {
  const brands: Record<string, number> = {};
  const categories: Record<string, number> = {};
  const subcategoriesByCode: Record<string, Record<string, number>> = {};
  const brandCategoryMatrix: Record<string, Record<string, number>> = {};

  for (const it of items) {
    brands[it.brand] = (brands[it.brand] ?? 0) + 1;
    categories[it.category] = (categories[it.category] ?? 0) + 1;
    subcategoriesByCode[it.codePrefix] = subcategoriesByCode[it.codePrefix] ?? {};
    const sample = it.name.replace(/^\S+\s+/, "").toLowerCase();
    subcategoriesByCode[it.codePrefix][sample] =
      (subcategoriesByCode[it.codePrefix][sample] ?? 0) + 1;
    brandCategoryMatrix[it.brand] = brandCategoryMatrix[it.brand] ?? {};
    brandCategoryMatrix[it.brand][it.category] =
      (brandCategoryMatrix[it.brand][it.category] ?? 0) + 1;
  }
  return { brands, categories, subcategoriesByCode, brandCategoryMatrix };
}

async function main(): Promise<void> {
  const text = await readFile("/tmp/ocr-clean.txt", "utf8");
  const pages = parse(text);
  const items = pages.flatMap((p) => p.items);
  const sum = summarize(items);

  await writeFile(
    "/tmp/catalog.json",
    JSON.stringify({ pages, items, summary: sum }, null, 2),
  );

  const fmt = (n: number, w = 4): string => String(n).padStart(w);
  console.log("=== SUMMARY ===");
  console.log(`pages : ${pages.length}`);
  console.log(`items : ${items.length}`);
  console.log(`brands: ${Object.keys(sum.brands).length}`);
  console.log(`categs: ${Object.keys(sum.categories).length}`);

  console.log("\n=== BRANDS ===");
  for (const [b, n] of Object.entries(sum.brands).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${b.padEnd(20)} ${fmt(n)}`);
  }

  console.log("\n=== CATEGORIES ===");
  for (const [c, n] of Object.entries(sum.categories).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(20)} ${fmt(n)}`);
  }

  console.log("\n=== CODE PREFIXES → typical sub-class (top item names) ===");
  const prefixes = Object.entries(sum.subcategoriesByCode).sort();
  for (const [pref, sub] of prefixes) {
    const top = Object.entries(sub).sort((a, b) => b[1] - a[1])[0];
    if (top)
      console.log(`  ${pref.padEnd(6)} → "${top[0]}" (×${top[1]})`);
  }

  console.log("\n=== BRAND × CATEGORY matrix (non-zero cells) ===");
  for (const [brand, cats] of Object.entries(sum.brandCategoryMatrix).sort()) {
    const cells = Object.entries(cats)
      .filter(([c]) => c !== "MISC")
      .map(([c, n]) => `${c}:${n}`)
      .join("  ");
    if (cells) console.log(`  ${brand.padEnd(20)} ${cells}`);
  }

  console.log(`\nFull JSON: /tmp/catalog.json (items: ${items.length})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

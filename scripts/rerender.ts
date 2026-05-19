import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { XMLParser } from "fast-xml-parser";

import { buildVerifiedDocx } from "../src/pipeline/docx.js";
import type { RenderPage } from "../src/pipeline/pdf.js";

const execFileAsync = promisify(execFile);

interface PageRecord {
  file: string;
  agreement: number;
  imagePath: string;
  final: string;
  notes: string;
  claude: string;
  gpt: string;
}

async function unzipDocx(src: string, dest: string): Promise<void> {
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await execFileAsync("unzip", ["-q", "-o", src, "-d", dest]);
}

function extractText(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  const n = node as Record<string, unknown>;
  if ("#text" in n) return String(n["#text"]);
  return Object.entries(n)
    .filter(([k]) => !k.startsWith("@_"))
    .map(([, v]) => extractText(v))
    .join("");
}

function paragraphRuns(p: Record<string, unknown>): Record<string, unknown>[] {
  const r = p["w:r"];
  if (!r) return [];
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [r as Record<string, unknown>];
}

function paragraphText(p: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const r of paragraphRuns(p)) {
    const t = r["w:t"];
    if (t) parts.push(extractText(t));
  }
  return parts.join("");
}

function paragraphStyle(p: Record<string, unknown>): string | null {
  const ppr = p["w:pPr"] as Record<string, unknown> | undefined;
  if (!ppr) return null;
  const style = ppr["w:pStyle"] as Record<string, unknown> | undefined;
  if (!style) return null;
  return String(style["@_w:val"] ?? "");
}

function paragraphImageRId(p: Record<string, unknown>): string | null {
  const runs = paragraphRuns(p);
  for (const r of runs) {
    const drawing = r["w:drawing"];
    if (!drawing) continue;
    const found = findEmbedId(drawing);
    if (found) return found;
  }
  return null;
}

function findEmbedId(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = findEmbedId(item);
      if (r) return r;
    }
    return null;
  }
  const n = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(n)) {
    if (k.endsWith(":blip") || k === "a:blip") {
      const obj = v as Record<string, unknown>;
      const id = obj["@_r:embed"];
      if (id) return String(id);
    }
    const r = findEmbedId(v);
    if (r) return r;
  }
  return null;
}

async function loadRelationships(workDir: string): Promise<Record<string, string>> {
  const xml = await readFile(join(workDir, "word/_rels/document.xml.rels"), "utf8");
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const rels = parsed.Relationships?.Relationship ?? [];
  const list = Array.isArray(rels) ? rels : [rels];
  const map: Record<string, string> = {};
  for (const r of list) {
    map[r["@_Id"]] = r["@_Target"];
  }
  return map;
}

async function parsePages(workDir: string): Promise<PageRecord[]> {
  const xml = await readFile(join(workDir, "word/document.xml"), "utf8");
  const parser = new XMLParser({
    ignoreAttributes: false,
    allowBooleanAttributes: true,
    isArray: (name) => name === "w:p" || name === "w:r" || name === "w:t",
  });
  const parsed = parser.parse(xml);
  const body = parsed["w:document"]["w:body"];
  const paragraphs: Record<string, unknown>[] = body["w:p"] ?? [];

  const rels = await loadRelationships(workDir);

  const pages: PageRecord[] = [];
  let current: PageRecord | null = null;
  let mode: "none" | "text" | "notes" = "none";

  for (const p of paragraphs) {
    const style = paragraphStyle(p);
    const text = paragraphText(p);
    const imgRid = paragraphImageRId(p);

    if (style === "Heading1") {
      if (current) pages.push(current);
      const m = text.match(/^\d+\.\s*(.+)$/);
      current = {
        file: m ? m[1].trim() : text.trim(),
        agreement: 0,
        imagePath: "",
        final: "",
        notes: "",
        claude: "",
        gpt: "",
      };
      mode = "none";
      continue;
    }

    if (!current) continue;

    if (imgRid) {
      const rel = rels[imgRid];
      if (rel) {
        current.imagePath = join(workDir, "word", rel);
      }
      continue;
    }

    if (style === "Heading3") {
      if (/Final/i.test(text)) mode = "text";
      else if (/Verification|сверк|notes/i.test(text)) mode = "notes";
      else mode = "none";
      continue;
    }

    if (mode === "none") {
      const m = text.match(/agreement:\s*(\d+)\s*%/);
      if (m) current.agreement = Number(m[1]) / 100;
      continue;
    }

    if (mode === "text") {
      if (current.final.length === 0) current.final = text;
      else current.final += "\n" + text;
    } else if (mode === "notes") {
      if (current.notes.length === 0) current.notes = text;
      else current.notes += " " + text;
    }
  }

  if (current) pages.push(current);
  return pages;
}

async function main(): Promise<void> {
  const src = process.argv[2] ?? "/tmp/ocr-result.docx";
  const dest = process.argv[3] ?? "/tmp/ocr-result-clean.docx";
  const workDir = join(tmpdir(), `rerender-${Date.now()}`);

  process.stderr.write(`Unzipping ${src} → ${workDir}\n`);
  await unzipDocx(src, workDir);

  process.stderr.write(`Parsing document.xml…\n`);
  const pages = await parsePages(workDir);
  process.stderr.write(`Found ${pages.length} pages.\n`);

  if (pages.length === 0) {
    throw new Error("No pages parsed");
  }

  // sample
  process.stderr.write(
    `First page: ${pages[0].file} (agreement ${(pages[0].agreement * 100).toFixed(0)}%), ` +
      `text ${pages[0].final.length} chars, notes ${pages[0].notes.length} chars\n`,
  );

  // strip boilerplate: normalize whitespace + lowercase for key, threshold 20%, len 2..120
  function normKey(s: string): string {
    return s.toLowerCase().replace(/\s+/g, " ").trim();
  }
  const lineCounts = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const raw of p.final.split("\n")) {
      const key = normKey(raw);
      if (key.length < 2 || key.length > 120) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.2));
  const boilerplate = new Set(
    [...lineCounts.entries()]
      .filter(([, n]) => n >= threshold)
      .map(([s]) => s),
  );
  process.stderr.write(
    `Detected ${boilerplate.size} boilerplate keys (threshold ${threshold} of ${pages.length} pages).\n`,
  );
  if (boilerplate.size > 0) {
    process.stderr.write(
      "Examples: " +
        [...boilerplate]
          .sort((a, b) => (lineCounts.get(b) ?? 0) - (lineCounts.get(a) ?? 0))
          .slice(0, 10)
          .map((s) => `${JSON.stringify(s)} (${lineCounts.get(s)}×)`)
          .join(", ") +
        "\n",
    );
  }

  const render: RenderPage[] = pages.map((p) => {
    const cleaned = p.final
      .split("\n")
      .filter((ln) => !boilerplate.has(normKey(ln)))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return {
      file: p.file,
      agreement: p.agreement,
      imagePath: p.imagePath,
      final: cleaned,
      notes: p.notes,
      claude: p.claude,
      gpt: p.gpt,
    };
  });

  process.stderr.write(`Building new docx…\n`);
  const buf = await buildVerifiedDocx(render, { includeImages: false, includeNotes: false });
  await writeFile(dest, buf);
  process.stderr.write(`Wrote ${dest} (${(buf.length / 1024 / 1024).toFixed(1)} MB)\n`);

  await rm(workDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

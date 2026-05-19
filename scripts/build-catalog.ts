import { readFile, writeFile } from "node:fs/promises";

interface ItemRaw {
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

interface CatalogData {
  items: ItemRaw[];
}

const KNOWN_BRANDS = [
  "Miduga",
  "Magura",
  "Kanji",
  "Jingu",
  "Narnoo",
  "Buthanbang",
  "Burnu",
  "Euroa",
  "Walea",
  "Wanja",
  "Panania",
  "Camira",
];

const GENERIC = "Generic";

const KNOWN_CATEGORIES = new Set([
  "ENGINE",
  "BRAKE",
  "SUSPENSION",
  "EXHAUST",
  "GEAR",
  "INTERIOR",
  "DRIVE",
  "COOLING",
  "FILTER",
  "BODY",
  "ELECTRIC",
  "BATTERY",
  "MOTORELECTRIC",
  "STEERING",
  "SWAYBAR",
  "BOOSTER",
  "CARBURETOR",
  "TYRE",
  "RIM",
  "GENERIC PARTS",
]);

function normalizeBrand(raw: string, itemName: string): string {
  const known = KNOWN_BRANDS.find(
    (b) => b.toLowerCase() === raw.toLowerCase(),
  );
  if (known) return known;
  // Try first word of the item name (e.g. "Burnu Drag Tyre" on a TYRE page).
  const firstWord = itemName.split(/\s+/)[0] ?? "";
  const fromName = KNOWN_BRANDS.find(
    (b) => b.toLowerCase() === firstWord.toLowerCase(),
  );
  if (fromName) return fromName;
  // Anything else → Generic (Rear / Front / Drive / Air / Oil / Battery / …
  // are part types, not manufacturers).
  return GENERIC;
}

function normalizeCategory(raw: string, name: string): string {
  if (KNOWN_CATEGORIES.has(raw)) return raw;
  // Infer from item name
  const n = name.toLowerCase();
  if (/\btyre|tire\b/.test(n)) return "TYRE";
  if (/\brim\b/.test(n)) return "RIM";
  if (/suspension|spring|strut/.test(n)) return "SUSPENSION";
  if (/brake/.test(n)) return "BRAKE";
  if (/midpipe|muffler|exhaust|manifold/.test(n)) return "EXHAUST";
  if (/clutch|gearbox|differential|driveshaft|drive shaft/.test(n))
    return /clutch|gearbox/.test(n) ? "GEAR" : "DRIVE";
  if (/hub|control arm|sway bar|swaybar/.test(n))
    return /sway/.test(n) ? "SWAYBAR" : "SUSPENSION";
  if (/radiator|cooling|intercooler|thermostat|fan/.test(n)) return "COOLING";
  if (/filter/.test(n)) return "FILTER";
  if (/seat|dashboard|steering wheel|clock|gauge|tachometer|speedometer/.test(n))
    return "INTERIOR";
  if (/wing|bumper|hood|fender|hardtop|hard top/.test(n)) return "BODY";
  if (/ignition|generator|starter|sparks|coil|spark plug|drive belt/.test(n))
    return "MOTORELECTRIC";
  if (/battery/.test(n)) return "BATTERY";
  if (/headlight|wire|fuse|horn/.test(n)) return "ELECTRIC";
  if (/carburetor/.test(n)) return "CARBURETOR";
  if (/turbo|booster/.test(n)) return "BOOSTER";
  if (/steering(?! wheel)/.test(n)) return "STEERING";
  if (/engine|block|l4|l6|v8|rotary/.test(n)) return "ENGINE";
  return raw || "MISC";
}

function subcategoryFromName(name: string): string {
  // strip leading brand token
  const after = name.replace(/^\S+\s+/, "").trim();
  // Title-case-ish normalize
  return after
    .replace(/\s+/g, " ")
    .replace(/[\s,]+\d.*$/, "")
    .trim();
}

interface CatalogNode {
  brand: string;
  categories: Record<
    string,
    {
      subcategories: Record<
        string,
        {
          items: ItemRaw[];
        }
      >;
    }
  >;
}

async function main(): Promise<void> {
  const data: CatalogData = JSON.parse(
    await readFile("/tmp/catalog.json", "utf8"),
  );

  // Re-normalize items
  const cleaned: ItemRaw[] = data.items.map((it) => ({
    ...it,
    brand: normalizeBrand(it.brand, it.name),
    category: normalizeCategory(it.category, it.name),
  }));

  // Build hierarchy
  const tree: Record<string, CatalogNode> = {};
  for (const it of cleaned) {
    const sub = subcategoryFromName(it.name);
    tree[it.brand] = tree[it.brand] ?? { brand: it.brand, categories: {} };
    tree[it.brand].categories[it.category] =
      tree[it.brand].categories[it.category] ?? { subcategories: {} };
    tree[it.brand].categories[it.category].subcategories[sub] =
      tree[it.brand].categories[it.category].subcategories[sub] ?? { items: [] };
    tree[it.brand].categories[it.category].subcategories[sub].items.push(it);
  }

  await writeFile(
    "/tmp/catalog-tree.json",
    JSON.stringify({ tree, items: cleaned }, null, 2),
  );

  // Build Markdown overview
  let md = `# Catalog (extracted from OCR)\n\n`;
  md += `**Items:** ${cleaned.length} · **Brands:** ${Object.keys(tree).length} · **Categories:** ${KNOWN_CATEGORIES.size}\n\n`;

  const brandsSorted = Object.entries(tree).sort((a, b) => {
    const totalA = Object.values(a[1].categories).reduce(
      (s, c) => s + Object.values(c.subcategories).reduce((sx, sc) => sx + sc.items.length, 0),
      0,
    );
    const totalB = Object.values(b[1].categories).reduce(
      (s, c) => s + Object.values(c.subcategories).reduce((sx, sc) => sx + sc.items.length, 0),
      0,
    );
    return totalB - totalA;
  });

  for (const [brand, node] of brandsSorted) {
    const total = Object.values(node.categories).reduce(
      (s, c) =>
        s +
        Object.values(c.subcategories).reduce((sx, sc) => sx + sc.items.length, 0),
      0,
    );
    md += `## ${brand} _(${total} items)_\n\n`;
    const cats = Object.entries(node.categories).sort(
      (a, b) =>
        Object.values(b[1].subcategories).reduce((s, sc) => s + sc.items.length, 0) -
        Object.values(a[1].subcategories).reduce((s, sc) => s + sc.items.length, 0),
    );
    for (const [cat, cdata] of cats) {
      const catTotal = Object.values(cdata.subcategories).reduce(
        (s, sc) => s + sc.items.length,
        0,
      );
      md += `### ${cat} (${catTotal})\n\n`;
      const subs = Object.entries(cdata.subcategories).sort(
        (a, b) => b[1].items.length - a[1].items.length,
      );
      for (const [sub, sdata] of subs) {
        md += `- **${sub}** — ${sdata.items.length} шт\n`;
        for (const it of sdata.items.slice(0, 3)) {
          md += `  - \`${it.code}\` ${it.mass} ${it.price}${it.detail ? ` — ${it.detail.slice(0, 80)}` : ""}\n`;
        }
        if (sdata.items.length > 3) md += `  - …ещё ${sdata.items.length - 3}\n`;
      }
      md += "\n";
    }
  }

  await writeFile("/tmp/catalog.md", md);

  // CSV
  let csv = "brand,category,subcategory,code,name,mass,price,units,detail,page\n";
  for (const it of cleaned) {
    const sub = subcategoryFromName(it.name);
    const escape = (s: string): string =>
      `"${(s ?? "").replace(/"/g, '""').replace(/\n/g, " ")}"`;
    csv += [
      escape(it.brand),
      escape(it.category),
      escape(sub),
      escape(it.code),
      escape(it.name),
      escape(it.mass),
      escape(it.price),
      escape(it.units),
      escape(it.detail),
      it.page,
    ].join(",") + "\n";
  }
  await writeFile("/tmp/catalog.csv", csv);

  console.log("=== CATALOG TREE SUMMARY ===");
  console.log(`Total items: ${cleaned.length}`);
  console.log(`Brands:      ${Object.keys(tree).length}`);
  console.log("");
  console.log("Brand totals:");
  for (const [b, n] of brandsSorted.slice(0, 20)) {
    const total = Object.values(n.categories).reduce(
      (s, c) =>
        s +
        Object.values(c.subcategories).reduce((sx, sc) => sx + sc.items.length, 0),
      0,
    );
    console.log(`  ${b.padEnd(20)} ${String(total).padStart(4)} items, ${Object.keys(n.categories).length} categories`);
  }
  console.log("");
  console.log("Files written:");
  console.log("  /tmp/catalog-tree.json  (hierarchical)");
  console.log("  /tmp/catalog.md         (markdown view)");
  console.log("  /tmp/catalog.csv        (flat, for Excel/Sheets)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

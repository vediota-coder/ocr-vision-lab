import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import "dotenv/config";

import { ClaudeProvider } from "./providers/claude.js";
import { OpenAIProvider } from "./providers/openai.js";
import type { OcrProvider, SupportedMediaType } from "./providers/types.js";

const MIME_BY_EXT: Record<string, SupportedMediaType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const DEFAULT_PROMPT =
  "Extract all text from this image. Preserve layout where it carries meaning (tables, columns, headings). Output plain text only — no commentary.";

interface Args {
  provider: "claude" | "gpt" | "both";
  imagePath: string;
  prompt: string;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { provider: "claude", prompt: DEFAULT_PROMPT };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--provider" || a === "-p") {
      const v = argv[++i];
      if (v !== "claude" && v !== "gpt" && v !== "both") {
        throw new Error(`--provider must be one of: claude, gpt, both`);
      }
      args.provider = v;
    } else if (a === "--prompt") {
      args.prompt = argv[++i];
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      positional.push(a);
    }
  }

  if (positional.length === 0) {
    printHelp();
    process.exit(1);
  }

  return {
    provider: args.provider!,
    prompt: args.prompt!,
    imagePath: positional[0],
  };
}

function printHelp(): void {
  console.error(
    `Usage: npm run ocr -- [--provider claude|gpt|both] [--prompt "..."] <image>

Options:
  -p, --provider   claude (default) | gpt | both
      --prompt     custom instruction (default: extract all text)
  -h, --help       show this help`,
  );
}

function buildProvider(name: "claude" | "gpt"): OcrProvider {
  return name === "claude" ? new ClaudeProvider() : new OpenAIProvider();
}

async function main(): Promise<void> {
  const { provider, imagePath, prompt } = parseArgs(process.argv.slice(2));

  const ext = extname(imagePath).toLowerCase();
  const mediaType = MIME_BY_EXT[ext];
  if (!mediaType) throw new Error(`Unsupported image extension: ${ext}`);

  const base64 = (await readFile(imagePath)).toString("base64");
  const image = { base64, mediaType };

  const providers: OcrProvider[] =
    provider === "both"
      ? [buildProvider("claude"), buildProvider("gpt")]
      : [buildProvider(provider)];

  for (const p of providers) {
    if (providers.length > 1) {
      process.stdout.write(`\n=== ${p.name} ===\n`);
    }
    const text = await p.ocr(image, prompt);
    process.stdout.write(text.trim() + "\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

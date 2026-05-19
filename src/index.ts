import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

const MIME_BY_EXT: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

async function ocr(imagePath: string): Promise<string> {
  const ext = extname(imagePath).toLowerCase();
  const mediaType = MIME_BY_EXT[ext];
  if (!mediaType) {
    throw new Error(`Unsupported image extension: ${ext}`);
  }

  const data = (await readFile(imagePath)).toString("base64");
  const client = new Anthropic();

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data },
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: "Extract all text from this image. Preserve layout where it carries meaning (tables, columns, headings). Output plain text only — no commentary.",
          },
        ],
      },
    ],
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

const [, , imagePath] = process.argv;
if (!imagePath) {
  console.error("Usage: npm run ocr -- <path/to/image>");
  process.exit(1);
}

ocr(imagePath)
  .then((text) => process.stdout.write(text + "\n"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

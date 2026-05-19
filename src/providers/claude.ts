import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { OcrProvider } from "./types.js";

const execFileAsync = promisify(execFile);

export class ClaudeProvider implements OcrProvider {
  readonly name = "claude" as const;

  async ocr(imagePath: string, prompt: string): Promise<string> {
    const fullPrompt = `${prompt}

Image: ${imagePath}

Use the Read tool to load the image, then output ONLY the extracted text.
No commentary, no markdown fences, no preface.`;

    const { stdout } = await execFileAsync(
      "claude",
      ["-p", fullPrompt, "--output-format", "json"],
      { maxBuffer: 50 * 1024 * 1024, timeout: 180_000 },
    );

    return extractResult(stdout);
  }
}

export async function claudeJson(prompt: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "claude",
    ["-p", prompt, "--output-format", "json"],
    { maxBuffer: 50 * 1024 * 1024, timeout: 180_000 },
  );
  return extractResult(stdout);
}

function extractResult(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as {
      result?: string;
      response?: string;
      text?: string;
    };
    return (parsed.result ?? parsed.response ?? parsed.text ?? "").trim();
  } catch {
    return stdout.trim();
  }
}

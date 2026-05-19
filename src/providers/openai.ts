import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { OcrProvider } from "./types.js";

export class OpenAIProvider implements OcrProvider {
  readonly name = "gpt" as const;

  async ocr(imagePath: string, prompt: string): Promise<string> {
    const outFile = join(tmpdir(), `codex-${randomUUID()}.txt`);
    try {
      await runCodex(
        ["exec", "--skip-git-repo-check", "-i", imagePath, "-o", outFile, prompt],
      );
      const text = await readFile(outFile, "utf8");
      return text.trim();
    } finally {
      await unlink(outFile).catch(() => undefined);
    }
  }
}

function runCodex(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const errChunks: Buffer[] = [];
    child.stdout.on("data", () => undefined);
    child.stderr.on("data", (c: Buffer) => errChunks.push(c));

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("codex exec timed out after 600s"));
    }, 600_000);

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `codex exec exited with code ${code}: ${Buffer.concat(errChunks).toString().slice(0, 500)}`,
          ),
        );
    });
  });
}

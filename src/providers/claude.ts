import Anthropic from "@anthropic-ai/sdk";
import type { OcrImage, OcrProvider } from "./types.js";

export class ClaudeProvider implements OcrProvider {
  readonly name = "claude" as const;
  private client?: Anthropic;
  private model = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";

  private getClient(): Anthropic {
    if (!this.client) this.client = new Anthropic();
    return this.client;
  }

  async ocr(image: OcrImage, prompt: string): Promise<string> {
    const response = await this.getClient().messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType,
                data: image.base64,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
}

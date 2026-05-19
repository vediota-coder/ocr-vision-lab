import OpenAI from "openai";
import type { OcrImage, OcrProvider } from "./types.js";

export class OpenAIProvider implements OcrProvider {
  readonly name = "gpt" as const;
  private client?: OpenAI;
  private model = process.env.OPENAI_MODEL ?? "gpt-4o";

  private getClient(): OpenAI {
    if (!this.client) this.client = new OpenAI();
    return this.client;
  }

  async ocr(image: OcrImage, prompt: string): Promise<string> {
    const response = await this.getClient().chat.completions.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${image.mediaType};base64,${image.base64}`,
              },
            },
          ],
        },
      ],
    });

    return response.choices[0]?.message?.content ?? "";
  }
}

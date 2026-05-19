export interface OcrProvider {
  readonly name: "claude" | "gpt";
  ocr(imagePath: string, prompt: string): Promise<string>;
}

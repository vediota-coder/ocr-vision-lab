export type SupportedMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export interface OcrImage {
  base64: string;
  mediaType: SupportedMediaType;
}

export interface OcrProvider {
  readonly name: "claude" | "gpt";
  ocr(image: OcrImage, prompt: string): Promise<string>;
}

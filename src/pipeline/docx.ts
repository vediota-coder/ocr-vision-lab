import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  ImageRun,
  AlignmentType,
} from "docx";
import { Buffer } from "node:buffer";
import type { RenderPage } from "./pdf.js";

const IMAGE_TYPE: Record<string, "jpg" | "png" | "gif" | "bmp"> = {
  ".jpg": "jpg",
  ".jpeg": "jpg",
  ".png": "png",
  ".gif": "gif",
  ".bmp": "bmp",
};

export async function buildVerifiedDocx(pages: RenderPage[]): Promise<Buffer> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "OCR Vision Lab" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Verified OCR — Claude + GPT cross-review · ${pages.length} pages · ${new Date().toISOString()}`,
          italics: true,
          color: "666666",
          size: 18,
        }),
      ],
    }),
  );

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];

    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
        children: [new TextRun({ text: `${i + 1}. ${page.file}` })],
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `agreement: ${(page.agreement * 100).toFixed(0)}%`,
            color: "666666",
            size: 18,
          }),
        ],
      }),
    );

    const ext = extname(page.imagePath).toLowerCase();
    const imgType = IMAGE_TYPE[ext];
    if (imgType) {
      try {
        const buf = await readFile(page.imagePath);
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                data: buf,
                transformation: { width: 400, height: 280 },
                type: imgType,
              }),
            ],
          }),
        );
      } catch {
        // skip image if read fails
      }
    }

    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: "Final text" })],
      }),
    );
    for (const line of (page.final || "(пусто)").split("\n")) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: line })] }),
      );
    }

    if (page.notes && page.notes.trim()) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun({ text: "Verification notes" })],
        }),
        new Paragraph({
          children: [
            new TextRun({ text: page.notes, italics: true, color: "555555" }),
          ],
        }),
      );
    }
  }

  const doc = new Document({
    creator: "ocr-vision-lab",
    title: "OCR Vision Lab — verified output",
    sections: [{ children }],
  });

  return Packer.toBuffer(doc) as Promise<Buffer>;
}

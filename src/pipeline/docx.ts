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
  PageNumber,
  Header,
  Footer,
  BorderStyle,
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

export interface DocxOptions {
  includeImages?: boolean;
  includeNotes?: boolean;
}

export async function buildVerifiedDocx(
  pages: RenderPage[],
  opts: DocxOptions = {},
): Promise<Buffer> {
  const { includeImages = true, includeNotes = true } = opts;
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 80 },
      children: [
        new TextRun({ text: "OCR Vision Lab", font: "Calibri", size: 48 }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 300 },
      children: [
        new TextRun({
          text: `Claude + GPT verified · ${pages.length} pages · ${new Date()
            .toISOString()
            .slice(0, 16)
            .replace("T", " ")}`,
          italics: true,
          color: "888888",
          size: 18,
          font: "Calibri",
        }),
      ],
    }),
  );

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const agree = Math.round((page.agreement ?? 0) * 100);
    const agreeColor = agree >= 85 ? "2E7D32" : agree >= 60 ? "EF6C00" : "C62828";

    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        pageBreakBefore: true,
        spacing: { before: 0, after: 60 },
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 6,
            color: "DDDDDD",
            space: 2,
          },
        },
        children: [
          new TextRun({
            text: `${i + 1}. ${page.file}`,
            font: "Calibri",
            size: 26,
            bold: true,
          }),
          new TextRun({
            text: `   ·   ${agree}%`,
            font: "Calibri",
            size: 18,
            color: agreeColor,
            bold: true,
          }),
        ],
      }),
    );

    if (includeImages) {
      const ext = extname(page.imagePath).toLowerCase();
      const imgType = IMAGE_TYPE[ext];
      if (imgType) {
        try {
          const buf = await readFile(page.imagePath);
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 120, after: 120 },
              children: [
                new ImageRun({
                  data: buf,
                  transformation: { width: 480, height: 270 },
                  type: imgType,
                }),
              ],
            }),
          );
        } catch {
          /* skip */
        }
      }
    }

    const lines = (page.final || "(пусто)").split("\n");
    const runs: TextRun[] = [];
    for (let j = 0; j < lines.length; j++) {
      runs.push(
        new TextRun({
          text: lines[j],
          font: "Consolas",
          size: 18,
          break: j === 0 ? 0 : 1,
        }),
      );
    }
    children.push(
      new Paragraph({
        spacing: { before: 60, after: 60, line: 260 },
        children: runs,
      }),
    );

    if (includeNotes && page.notes && page.notes.trim()) {
      children.push(
        new Paragraph({
          spacing: { before: 60, after: 120 },
          children: [
            new TextRun({
              text: "Заметки сверки: ",
              italics: true,
              color: "888888",
              size: 16,
              font: "Calibri",
              bold: true,
            }),
            new TextRun({
              text: page.notes,
              italics: true,
              color: "888888",
              size: 16,
              font: "Calibri",
            }),
          ],
        }),
      );
    }
  }

  const doc = new Document({
    creator: "ocr-vision-lab",
    title: "OCR Vision Lab — verified output",
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720,
              bottom: 720,
              left: 720,
              right: 720,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: "OCR Vision Lab",
                    color: "BBBBBB",
                    size: 14,
                    font: "Calibri",
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES],
                    color: "BBBBBB",
                    size: 14,
                    font: "Calibri",
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc) as Promise<Buffer>;
}

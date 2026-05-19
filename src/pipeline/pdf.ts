import PDFDocument from "pdfkit";
import { Buffer } from "node:buffer";
import type { VerifiedResult } from "./verify.js";

export interface PdfPageInput extends VerifiedResult {
  imageBuffer: Buffer;
  mediaType: string;
}

export async function buildVerifiedPdf(pages: PdfPageInput[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      info: {
        Title: "OCR Vision Lab — verified output",
        Creator: "ocr-vision-lab",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(20).text("OCR Vision Lab", {
      align: "center",
    });
    doc.moveDown(0.3);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#666")
      .text(
        `Verified OCR — Claude + GPT cross-review · ${pages.length} pages · ${new Date().toISOString()}`,
        { align: "center" },
      );
    doc.fillColor("#000");

    pages.forEach((page, i) => {
      doc.addPage();

      doc
        .font("Helvetica-Bold")
        .fontSize(14)
        .text(`${i + 1}. ${page.file}`, { ellipsis: true });
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#666")
        .text(
          `agreement: ${(page.agreement * 100).toFixed(0)}%`,
          { continued: false },
        );
      doc.fillColor("#000");
      doc.moveDown(0.5);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const previewWidth = pageWidth * 0.4;
      const previewX = doc.page.margins.left;
      const previewY = doc.y;
      const textX = previewX + previewWidth + 16;
      const textWidth = pageWidth - previewWidth - 16;

      try {
        doc.image(page.imageBuffer, previewX, previewY, {
          fit: [previewWidth, 220],
          align: "center",
        });
      } catch {
        doc
          .rect(previewX, previewY, previewWidth, 220)
          .strokeColor("#ccc")
          .stroke()
          .fontSize(9)
          .fillColor("#999")
          .text("(не удалось вставить изображение)", previewX, previewY + 100, {
            width: previewWidth,
            align: "center",
          })
          .fillColor("#000");
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .text("Final text", textX, previewY, { width: textWidth });
      doc
        .font("Helvetica")
        .fontSize(9)
        .text(page.final || "(пусто)", textX, doc.y + 2, {
          width: textWidth,
        });

      doc.moveDown(0.5);
      if (page.notes && page.notes.trim()) {
        doc
          .font("Helvetica-Bold")
          .fontSize(9)
          .fillColor("#555")
          .text("Verification notes", { continued: false });
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor("#555")
          .text(page.notes)
          .fillColor("#000");
      }
    });

    doc.end();
  });
}

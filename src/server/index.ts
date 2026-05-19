import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import "dotenv/config";

import { verifyImage, type VerifiedResult } from "../pipeline/verify.js";
import { buildVerifiedPdf, type PdfPageInput } from "../pipeline/pdf.js";
import type { SupportedMediaType } from "../providers/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "..", "public");

const MIME_BY_EXT: Record<string, SupportedMediaType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

interface JobEvent {
  type: "start" | "page" | "done" | "error";
  totalPages?: number;
  pageIndex?: number;
  file?: string;
  agreement?: number;
  jobId?: string;
  message?: string;
}

interface Job {
  events: JobEvent[];
  subscribers: Set<(ev: JobEvent) => void>;
  pdf?: Buffer;
  failed?: string;
}

const jobs = new Map<string, Job>();

function emit(job: Job, ev: JobEvent): void {
  job.events.push(ev);
  for (const s of job.subscribers) s(ev);
}

async function runJob(
  jobId: string,
  files: { name: string; buffer: Buffer; mediaType: SupportedMediaType }[],
): Promise<void> {
  const job = jobs.get(jobId)!;
  emit(job, { type: "start", totalPages: files.length });

  const results: PdfPageInput[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const verified: VerifiedResult = await verifyImage(f.name, {
        base64: f.buffer.toString("base64"),
        mediaType: f.mediaType,
      });
      results.push({
        ...verified,
        imageBuffer: f.buffer,
        mediaType: f.mediaType,
      });
      emit(job, {
        type: "page",
        pageIndex: i,
        file: f.name,
        agreement: verified.agreement,
      });
    }

    const pdf = await buildVerifiedPdf(results);
    job.pdf = pdf;
    emit(job, { type: "done", jobId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.failed = msg;
    emit(job, { type: "error", message: msg });
  }
}

const app = Fastify({ logger: true, bodyLimit: 512 * 1024 * 1024 });

await app.register(multipart, {
  limits: { fileSize: 50 * 1024 * 1024, files: 200 },
});

await app.register(fastifyStatic, {
  root: PUBLIC_DIR,
  prefix: "/",
});

app.post("/api/jobs", async (req, reply) => {
  const files: { name: string; buffer: Buffer; mediaType: SupportedMediaType }[] = [];

  for await (const part of req.parts()) {
    if (part.type === "file") {
      const ext = extname(part.filename).toLowerCase();
      const mediaType = MIME_BY_EXT[ext];
      if (!mediaType) continue;
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) chunks.push(chunk as Buffer);
      files.push({
        name: part.filename,
        buffer: Buffer.concat(chunks),
        mediaType,
      });
    }
  }

  if (files.length === 0) {
    return reply.code(400).send({ error: "No supported images uploaded" });
  }

  const jobId = randomUUID();
  jobs.set(jobId, { events: [], subscribers: new Set() });
  runJob(jobId, files).catch((e) => app.log.error(e));

  return { jobId, total: files.length };
});

app.get("/api/jobs/:id/events", (req, reply) => {
  const { id } = req.params as { id: string };
  const job = jobs.get(id);
  if (!job) {
    reply.code(404).send({ error: "Job not found" });
    return;
  }

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (ev: JobEvent): void => {
    reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
  };

  for (const ev of job.events) send(ev);

  if (job.pdf || job.failed) {
    reply.raw.end();
    return;
  }

  job.subscribers.add(send);
  const onClose = (): void => {
    job.subscribers.delete(send);
  };
  req.raw.on("close", onClose);

  const flushAndClose = (ev: JobEvent): void => {
    if (ev.type === "done" || ev.type === "error") {
      setTimeout(() => reply.raw.end(), 100);
    }
  };
  job.subscribers.add(flushAndClose);
});

app.get("/api/jobs/:id/pdf", async (req, reply) => {
  const { id } = req.params as { id: string };
  const job = jobs.get(id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  if (job.failed) return reply.code(500).send({ error: job.failed });
  if (!job.pdf) return reply.code(425).send({ error: "Not ready" });

  reply
    .header("Content-Type", "application/pdf")
    .header(
      "Content-Disposition",
      `attachment; filename="ocr-${id.slice(0, 8)}.pdf"`,
    )
    .send(job.pdf);
});

const port = Number(process.env.PORT ?? 8082);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`UI: http://localhost:${port}/`));

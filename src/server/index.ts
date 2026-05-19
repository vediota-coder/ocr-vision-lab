import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Buffer } from "node:buffer";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import pLimit from "p-limit";

import { verifyImage, type VerifiedResult } from "../pipeline/verify.js";
import { stripBoilerplate } from "../pipeline/filter.js";
import { buildVerifiedPdf, type RenderPage } from "../pipeline/pdf.js";
import { buildVerifiedDocx } from "../pipeline/docx.js";
import { resizeForOcr } from "../pipeline/resize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "..", "public");

const SUPPORTED_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const CONCURRENCY = Number(process.env.OCR_CONCURRENCY ?? 4);

type OutputFormat = "pdf" | "docx";

interface JobEvent {
  type:
    | "start"
    | "page-start"
    | "page-claude"
    | "page-gpt"
    | "page-merge"
    | "page-done"
    | "filter"
    | "done"
    | "error";
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
  output?: { buffer: Buffer; format: OutputFormat };
  failed?: string;
  workDir: string;
}

const jobs = new Map<string, Job>();

function emit(job: Job, ev: JobEvent): void {
  job.events.push(ev);
  for (const s of job.subscribers) s(ev);
}

interface UploadedFile {
  name: string;
  path: string;
}

async function runJob(
  jobId: string,
  files: UploadedFile[],
  format: OutputFormat,
  userPrompt: string,
  includeImages: boolean,
): Promise<void> {
  const job = jobs.get(jobId)!;
  emit(job, { type: "start", totalPages: files.length });

  const resizeLimit = pLimit(Math.max(2, CONCURRENCY * 2));
  const ocrLimit = pLimit(CONCURRENCY);

  const results: VerifiedResult[] = new Array(files.length);
  const resizedPaths: string[] = new Array(files.length);

  try {
    await Promise.all(
      files.map((f, i) =>
        ocrLimit(async () => {
          emit(job, { type: "page-start", pageIndex: i, file: f.name });

          const resized = await resizeLimit(() =>
            resizeForOcr(f.path, job.workDir).catch(() => f.path),
          );
          resizedPaths[i] = resized;

          const verified = await verifyImage(f.name, resized, userPrompt, {
            onClaude: () =>
              emit(job, { type: "page-claude", pageIndex: i, file: f.name }),
            onGpt: () =>
              emit(job, { type: "page-gpt", pageIndex: i, file: f.name }),
            onMerge: () =>
              emit(job, { type: "page-merge", pageIndex: i, file: f.name }),
          });

          results[i] = verified;
          emit(job, {
            type: "page-done",
            pageIndex: i,
            file: f.name,
            agreement: verified.agreement,
          });
        }),
      ),
    );

    emit(job, { type: "filter" });
    const cleaned = await stripBoilerplate(results, userPrompt);

    const renderPages: RenderPage[] = cleaned.map((r, i) => ({
      ...r,
      imagePath: resizedPaths[i] || files[i].path,
    }));

    const buffer =
      format === "docx"
        ? await buildVerifiedDocx(renderPages, { includeImages })
        : await buildVerifiedPdf(renderPages, { includeImages });
    job.output = { buffer, format };
    emit(job, { type: "done", jobId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.failed = msg;
    emit(job, { type: "error", message: msg });
  } finally {
    rm(job.workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 * 1024 });

await app.register(multipart, {
  limits: { fileSize: 50 * 1024 * 1024, files: 2000 },
});

await app.register(fastifyStatic, {
  root: PUBLIC_DIR,
  prefix: "/",
});

app.post("/api/jobs", async (req, reply) => {
  const jobId = randomUUID();
  const workDir = join(tmpdir(), `ocr-job-${jobId}`);
  await mkdir(workDir, { recursive: true });

  const files: UploadedFile[] = [];
  let format: OutputFormat = "docx";
  let userPrompt = "";
  let includeImages = false;

  for await (const part of req.parts()) {
    if (part.type === "file") {
      const ext = extname(part.filename).toLowerCase();
      if (!SUPPORTED_EXT.has(ext)) {
        for await (const _ of part.file) void _;
        continue;
      }
      const safeName = `${files.length}-${part.filename.replace(/[\/\\]/g, "_")}`;
      const dest = join(workDir, safeName);
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) chunks.push(chunk as Buffer);
      await writeFile(dest, Buffer.concat(chunks));
      files.push({ name: part.filename, path: dest });
    } else if (part.fieldname === "format") {
      const v = part.value;
      if (typeof v === "string" && (v === "pdf" || v === "docx")) format = v;
    } else if (part.fieldname === "prompt") {
      if (typeof part.value === "string") userPrompt = part.value;
    } else if (part.fieldname === "includeImages") {
      includeImages = part.value === "1" || part.value === "true";
    }
  }

  if (files.length === 0) {
    await rm(workDir, { recursive: true, force: true });
    return reply.code(400).send({ error: "No supported images uploaded" });
  }

  jobs.set(jobId, { events: [], subscribers: new Set(), workDir });
  runJob(jobId, files, format, userPrompt, includeImages).catch((e) =>
    app.log.error(e),
  );

  return { jobId, total: files.length, format };
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

  if (job.output || job.failed) {
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

app.get("/api/jobs/:id/output", async (req, reply) => {
  const { id } = req.params as { id: string };
  const job = jobs.get(id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  if (job.failed) return reply.code(500).send({ error: job.failed });
  if (!job.output) return reply.code(425).send({ error: "Not ready" });

  const { buffer, format } = job.output;
  const mime =
    format === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/pdf";

  reply
    .header("Content-Type", mime)
    .header(
      "Content-Disposition",
      `attachment; filename="ocr-${id.slice(0, 8)}.${format}"`,
    )
    .send(buffer);
});

const port = Number(process.env.PORT ?? 8082);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`UI: http://localhost:${port}/ (concurrency=${CONCURRENCY})`));

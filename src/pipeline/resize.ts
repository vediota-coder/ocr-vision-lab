import { extname, join, basename } from "node:path";
import sharp from "sharp";

const MAX_DIM = 1600;

export async function resizeForOcr(
  srcPath: string,
  workDir: string,
): Promise<string> {
  const ext = extname(srcPath).toLowerCase();
  const outPath = join(workDir, `r-${basename(srcPath, ext)}.jpg`);

  const meta = await sharp(srcPath).metadata();
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0);

  if (longest === 0) {
    return srcPath;
  }

  const pipeline = sharp(srcPath).rotate();
  if (longest > MAX_DIM) {
    pipeline.resize({
      width: MAX_DIM,
      height: MAX_DIM,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  await pipeline.jpeg({ quality: 85 }).toFile(outPath);
  return outPath;
}

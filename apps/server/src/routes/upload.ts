import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../auth.js";
import { env, ossConfigured } from "../env.js";
import { fail, ok } from "../http.js";
import { uploadImageToOss } from "../oss.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

/** 按文件头魔数识别图片，不信任客户端 Content-Type */
function sniffImage(buffer: Buffer): { mime: string; ext: string } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", ext: ".jpg" };
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: "image/png", ext: ".png" };
  }
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return { mime: "image/gif", ext: ".gif" };
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { mime: "image/webp", ext: ".webp" };
  }
  return null;
}

async function saveLocal(file: { buffer: Buffer; mime: string; ext: string }): Promise<{ url: string }> {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const dir = path.join(env.uploadDir, year, month);
  await fs.mkdir(dir, { recursive: true });
  const name = `${crypto.randomUUID()}${file.ext}`;
  await fs.writeFile(path.join(dir, name), file.buffer);
  return { url: `/uploads/${year}/${month}/${name}` };
}

export const uploadRouter = Router();

uploadRouter.post("/", requireAuth, upload.single("file"), (req, res, next) => {
  void (async () => {
    if (!req.file?.buffer?.length) {
      fail(res, "NO_FILE");
      return;
    }
    const sniffed = sniffImage(req.file.buffer);
    if (!sniffed) {
      fail(res, "UNSUPPORTED_TYPE");
      return;
    }

    if (ossConfigured()) {
      try {
        const { url } = await uploadImageToOss({
          buffer: req.file.buffer,
          mimetype: sniffed.mime,
          ext: sniffed.ext,
        });
        ok(res, { url });
        return;
      } catch (err) {
        console.warn("OSS upload failed, falling back to local:", err);
      }
    }

    const local = await saveLocal({
      buffer: req.file.buffer,
      mime: sniffed.mime,
      ext: sniffed.ext,
    });
    ok(res, local);
  })().catch(next);
});

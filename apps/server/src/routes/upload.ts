import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../auth.js";
import { ossConfigured } from "../env.js";
import { uploadImageToOss } from "../oss.js";

const allowed = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowed.has(file.mimetype)) {
      cb(new Error("UNSUPPORTED_TYPE"));
      return;
    }
    cb(null, true);
  },
});

export const uploadRouter = Router();

uploadRouter.post("/", requireAuth, upload.single("file"), (req, res, next) => {
  void (async () => {
    if (!req.file?.buffer) {
      res.status(400).json({ error: "NO_FILE" });
      return;
    }
    if (!ossConfigured()) {
      res.status(500).json({ error: "OSS_NOT_CONFIGURED" });
      return;
    }
    const ext = allowed.get(req.file.mimetype) ?? ".bin";
    const { url } = await uploadImageToOss({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      ext,
    });
    res.json({ url });
  })().catch(next);
});

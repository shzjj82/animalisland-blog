import { Router } from "express";
import {
  isAiChatRole,
  type AiAttachment,
  type AiChatMessage,
  type EditorJsDocument,
} from "@myblog/shared";
import { runAiChat, runAiToEditor } from "../ai.js";
import { requireAuth } from "../auth.js";
import { aiConfigured, env } from "../env.js";

export const aiRouter = Router();

aiRouter.get("/status", requireAuth, (_req, res) => {
  res.json({
    enabled: aiConfigured(),
    model: aiConfigured() ? env.aiModel : null,
    base: aiConfigured() ? env.aiApiBase : null,
  });
});

function parseAttachments(value: unknown): AiAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: AiAttachment[] = [];
  for (const item of value.slice(0, 12)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const raw = item as { kind?: unknown; name?: unknown; url?: unknown; text?: unknown };
    const name = String(raw.name ?? "附件").slice(0, 120);
    if (raw.kind === "image") {
      const url = String(raw.url ?? "").trim();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        out.push({ kind: "image", name, url });
      }
      continue;
    }
    if (raw.kind === "text") {
      const text = String(raw.text ?? "");
      if (text.trim()) {
        out.push({ kind: "text", name, text: text.slice(0, 12000) });
      }
    }
  }
  return out;
}

function parseMessages(value: unknown): AiChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: AiChatMessage[] = [];
  for (const item of value.slice(0, 30)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const raw = item as { role?: unknown; content?: unknown };
    const role = String(raw.role ?? "");
    if (!isAiChatRole(role)) {
      continue;
    }
    const content = String(raw.content ?? "").trim();
    if (!content) {
      continue;
    }
    out.push({ role, content: content.slice(0, 8000) });
  }
  return out;
}

function parseDocument(value: unknown): EditorJsDocument | undefined {
  return value && typeof value === "object" ? (value as EditorJsDocument) : undefined;
}

aiRouter.post("/chat", requireAuth, (req, res, next) => {
  void (async () => {
    if (!aiConfigured()) {
      res.status(503).json({ error: "AI_NOT_CONFIGURED" });
      return;
    }
    const messages = parseMessages(req.body?.messages);
    if (messages.length === 0) {
      res.status(400).json({ error: "AI_EMPTY_PROMPT" });
      return;
    }
    const result = await runAiChat({
      messages,
      attachments: parseAttachments(req.body?.attachments),
      document: parseDocument(req.body?.document),
    });
    res.json(result);
  })().catch(next);
});

aiRouter.post("/to-editor", requireAuth, (req, res, next) => {
  void (async () => {
    if (!aiConfigured()) {
      res.status(503).json({ error: "AI_NOT_CONFIGURED" });
      return;
    }
    const messages = parseMessages(req.body?.messages);
    if (messages.length === 0) {
      res.status(400).json({ error: "AI_EMPTY_PROMPT" });
      return;
    }
    const apply = req.body?.apply === "append" || req.body?.apply === "replace" ? req.body.apply : undefined;
    const result = await runAiToEditor({
      messages,
      attachments: parseAttachments(req.body?.attachments),
      document: parseDocument(req.body?.document),
      apply,
    });
    res.json(result);
  })().catch(next);
});

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
import { fail, ok } from "../http.js";

export const aiRouter = Router();

aiRouter.get("/status", requireAuth, (_req, res) => {
  ok(res, {
    enabled: aiConfigured(),
    model: aiConfigured() ? env.aiModel : null,
    base: aiConfigured() ? env.aiApiBase : null,
  });
});

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
    return true;
  }
  if (host === "169.254.169.254" || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) {
    return true;
  }
  if (/^192\.168\.\d+\.\d+$/.test(host)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) {
    return true;
  }
  return false;
}

/** 仅允许站内上传、配置过的公网图床；拒绝内网/元数据地址，降低 SSRF 风险 */
function isAllowedAttachmentUrl(raw: string): boolean {
  const url = raw.trim();
  if (!url) {
    return false;
  }
  if (url.startsWith("/uploads/")) {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  if (isPrivateHost(parsed.hostname)) {
    return false;
  }
  return true;
}

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
      if (isAllowedAttachmentUrl(url)) {
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
      fail(res, "AI_NOT_CONFIGURED", 503);
      return;
    }
    const messages = parseMessages(req.body?.messages);
    if (messages.length === 0) {
      fail(res, "AI_EMPTY_PROMPT");
      return;
    }
    const result = await runAiChat({
      messages,
      attachments: parseAttachments(req.body?.attachments),
      document: parseDocument(req.body?.document),
    });
    ok(res, result);
  })().catch(next);
});

aiRouter.post("/to-editor", requireAuth, (req, res, next) => {
  void (async () => {
    if (!aiConfigured()) {
      fail(res, "AI_NOT_CONFIGURED", 503);
      return;
    }
    const messages = parseMessages(req.body?.messages);
    if (messages.length === 0) {
      fail(res, "AI_EMPTY_PROMPT");
      return;
    }
    const apply = req.body?.apply === "append" || req.body?.apply === "replace" ? req.body.apply : undefined;
    const result = await runAiToEditor({
      messages,
      attachments: parseAttachments(req.body?.attachments),
      document: parseDocument(req.body?.document),
      apply,
    });
    ok(res, result);
  })().catch(next);
});

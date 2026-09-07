import type {
  AiAttachment,
  AiChatInput,
  AiChatMessage,
  AiChatResult,
  AiToEditorInput,
  AiToEditorResult,
  EditorJsBlock,
  EditorJsDocument,
} from "@myblog/shared";
import { aiConfigured, env } from "./env.js";

const CHAT_SYSTEM = `你是「小岛日记」博客的写作搭档。
用自然中文和用户聊天，一起想题目、结构、段落、语气。
可以给大纲、草稿片段、修改建议，但不要输出 Editor.js JSON，也不要用 markdown 代码围栏包整篇文章。
语气轻松、克制，像朋友一起写博客，不要广告腔。
如果用户上传了图片或文本附件，请结合它们讨论。
若用户问起如何落到编辑器：告诉他点「转成 Editor.js」技能即可把对话整理进正文。`;

const TO_EDITOR_SYSTEM = `你是「小岛日记」的 Editor.js 排版技能。
根据用户与写作助手的对话（以及附件、当前正文摘要），产出可直接写入 Editor.js 的 blocks。

只输出一个 JSON 对象，不要 markdown 代码围栏，不要解释。格式：
{"blocks":[{"type":"header","data":{"text":"...","level":1}},{"type":"paragraph","data":{"text":"..."}}],"apply":"replace"|"append","note":"可选短说明"}

允许的 type 与 data：
- header: { text: string, level: 1|2|3 }
- paragraph: { text: string }  （可含简单 HTML：b/i/a/code）
- list: { style: "ordered"|"unordered", items: string[] }
- quote: { text: string, caption?: string }
- code: { code: string, language?: string }
- delimiter: {}
- image: { file: { url: string }, caption?: string, withBorder?: false, stretched?: false, withBackground?: false }
- embed: { service: string, source: string, embed: string, width?: number, height?: number, caption?: string }

规则：
1. 中文，自然个人博客语气。
2. 图片只能使用附件里给出的 url，禁止编造。
3. 通常整篇成稿用 apply=replace，第一块用 level 1 标题；若用户明确说追加则用 append。
4. 综合对话里已达成的内容来写，不要只复述最后一句。
5. blocks 不能为空；不要输出未列出的 type。`;

type ChatContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type UpstreamMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContent[];
};

function summarizeDocument(document?: EditorJsDocument): string {
  const blocks = document?.blocks ?? [];
  if (blocks.length === 0) {
    return "（当前正文为空）";
  }
  const lines = blocks.slice(0, 80).map((block, index) => {
    const data = block.data ?? {};
    if (block.type === "header") {
      return `${index + 1}. [header h${data.level ?? 2}] ${String(data.text ?? "")}`;
    }
    if (block.type === "paragraph") {
      return `${index + 1}. [paragraph] ${String(data.text ?? "").slice(0, 240)}`;
    }
    if (block.type === "list") {
      const items = Array.isArray(data.items) ? data.items.join(" / ") : "";
      return `${index + 1}. [list ${data.style ?? "unordered"}] ${items.slice(0, 240)}`;
    }
    if (block.type === "quote") {
      return `${index + 1}. [quote] ${String(data.text ?? "").slice(0, 240)}`;
    }
    if (block.type === "code") {
      return `${index + 1}. [code ${data.language ?? ""}] ${String(data.code ?? "").slice(0, 180)}`;
    }
    if (block.type === "image") {
      const file = data.file as { url?: string } | undefined;
      return `${index + 1}. [image] ${file?.url ?? ""} ${String(data.caption ?? "")}`;
    }
    if (block.type === "delimiter") {
      return `${index + 1}. [delimiter]`;
    }
    return `${index + 1}. [${block.type}]`;
  });
  return lines.join("\n");
}

function describeAttachments(attachments: AiAttachment[]): {
  imageUrls: string[];
  textParts: string[];
  allowedImageUrls: Set<string>;
} {
  const imageUrls = attachments
    .filter((item): item is Extract<AiAttachment, { kind: "image" }> => item.kind === "image")
    .map((item) => item.url.trim())
    .filter(Boolean);
  const textParts = attachments
    .filter((item): item is Extract<AiAttachment, { kind: "text" }> => item.kind === "text")
    .map((item) => `【附件文本：${item.name}】\n${item.text.slice(0, 12000)}`);
  return { imageUrls, textParts, allowedImageUrls: new Set(imageUrls) };
}

function normalizeMessages(messages: AiChatMessage[]): AiChatMessage[] {
  return messages
    .filter((item) => item && (item.role === "user" || item.role === "assistant"))
    .map((item) => ({
      role: item.role,
      content: String(item.content ?? "").trim().slice(0, 8000),
    }))
    .filter((item) => item.content)
    .slice(-24);
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("AI_BAD_JSON");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

const ALLOWED_TYPES = new Set([
  "header",
  "paragraph",
  "list",
  "quote",
  "code",
  "delimiter",
  "image",
  "embed",
]);

function sanitizeBlocks(value: unknown, allowedImageUrls: Set<string>): EditorJsBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const blocks: EditorJsBlock[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const raw = item as { type?: unknown; data?: unknown };
    const type = String(raw.type ?? "");
    if (!ALLOWED_TYPES.has(type)) {
      continue;
    }
    const data =
      raw.data && typeof raw.data === "object" ? { ...(raw.data as Record<string, unknown>) } : {};
    if (type === "image") {
      const file = data.file as { url?: string } | undefined;
      const url = file?.url?.trim() ?? "";
      if (!url || !allowedImageUrls.has(url)) {
        continue;
      }
      data.file = { url };
    }
    blocks.push({ type, data });
  }
  return blocks;
}

async function callModel(messages: UpstreamMessage[], signal: AbortSignal): Promise<string> {
  const res = await fetch(`${env.aiApiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.aiApiKey}`,
    },
    body: JSON.stringify({
      model: env.aiModel,
      temperature: 0.7,
      messages,
    }),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("AI upstream error", res.status, detail.slice(0, 500));
    throw new Error(`AI_UPSTREAM_${res.status}`);
  }
  const payload = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return payload.choices?.[0]?.message?.content?.trim() ?? "";
}

function contextAppendix(document: EditorJsDocument | undefined, attachments: AiAttachment[]): string {
  const { imageUrls, textParts } = describeAttachments(attachments);
  return [
    `当前 Editor.js 正文摘要：\n${summarizeDocument(document)}`,
    imageUrls.length ? `可用图片 URL：\n${imageUrls.join("\n")}` : "无图片附件",
    textParts.length ? textParts.join("\n\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildHistoryMessages(
  system: string,
  messages: AiChatMessage[],
  appendix: string,
  imageUrls: string[],
  multimodal: boolean,
): UpstreamMessage[] {
  const history = messages.map((item, index) => {
    const isLastUser = index === messages.length - 1 && item.role === "user";
    if (!isLastUser) {
      return { role: item.role, content: item.content } satisfies UpstreamMessage;
    }
    const text = `${item.content}\n\n——\n${appendix}`;
    if (multimodal && imageUrls.length) {
      const content: ChatContent[] = [{ type: "text", text }];
      for (const url of imageUrls.slice(0, 6)) {
        content.push({ type: "image_url", image_url: { url } });
      }
      return { role: "user" as const, content };
    }
    return { role: "user" as const, content: text };
  });
  return [{ role: "system", content: system }, ...history];
}

export async function runAiChat(input: AiChatInput): Promise<AiChatResult> {
  if (!aiConfigured()) {
    throw new Error("AI_NOT_CONFIGURED");
  }
  const messages = normalizeMessages(input.messages);
  if (messages.length === 0 || messages[messages.length - 1]?.role !== "user") {
    throw new Error("AI_EMPTY_PROMPT");
  }

  const attachments = input.attachments ?? [];
  const { imageUrls } = describeAttachments(attachments);
  const appendix = contextAppendix(input.document, attachments);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.aiTimeoutMs);
  try {
    const withVision = buildHistoryMessages(CHAT_SYSTEM, messages, appendix, imageUrls, true);
    const textOnly = buildHistoryMessages(CHAT_SYSTEM, messages, appendix, imageUrls, false);
    let reply = "";
    try {
      reply = await callModel(imageUrls.length ? withVision : textOnly, controller.signal);
    } catch (err) {
      if (imageUrls.length && err instanceof Error && err.message.startsWith("AI_UPSTREAM_")) {
        reply = await callModel(textOnly, controller.signal);
      } else {
        throw err;
      }
    }
    if (!reply) {
      throw new Error("AI_EMPTY_REPLY");
    }
    return { reply: reply.slice(0, 12000) };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("AI_TIMEOUT");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function runAiToEditor(input: AiToEditorInput): Promise<AiToEditorResult> {
  if (!aiConfigured()) {
    throw new Error("AI_NOT_CONFIGURED");
  }
  const messages = normalizeMessages(input.messages);
  if (messages.length === 0) {
    throw new Error("AI_EMPTY_PROMPT");
  }

  const attachments = input.attachments ?? [];
  const { imageUrls, allowedImageUrls } = describeAttachments(attachments);
  const appendix = [
    contextAppendix(input.document, attachments),
    `期望应用方式：${input.apply === "append" ? "append" : "replace"}`,
    "请根据以上对话整理成完整 Editor.js 文章 blocks。",
  ].join("\n\n");

  const skillUser: AiChatMessage = {
    role: "user",
    content: "请执行技能：把我们的对话整理成 Editor.js blocks，并填写到编辑器。",
  };
  const packed = [...messages, skillUser];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.aiTimeoutMs);
  try {
    const withVision = buildHistoryMessages(TO_EDITOR_SYSTEM, packed, appendix, imageUrls, true);
    const textOnly = buildHistoryMessages(TO_EDITOR_SYSTEM, packed, appendix, imageUrls, false);
    let content = "";
    try {
      content = await callModel(imageUrls.length ? withVision : textOnly, controller.signal);
    } catch (err) {
      if (imageUrls.length && err instanceof Error && err.message.startsWith("AI_UPSTREAM_")) {
        content = await callModel(textOnly, controller.signal);
      } else {
        throw err;
      }
    }

    const parsed = extractJsonObject(content) as {
      blocks?: unknown;
      apply?: unknown;
      note?: unknown;
    };
    const blocks = sanitizeBlocks(parsed.blocks, allowedImageUrls);
    if (blocks.length === 0) {
      throw new Error("AI_EMPTY_BLOCKS");
    }
    const apply =
      parsed.apply === "append" || parsed.apply === "replace"
        ? parsed.apply
        : input.apply === "append"
          ? "append"
          : "replace";
    return {
      blocks,
      apply,
      note: typeof parsed.note === "string" ? parsed.note.slice(0, 200) : undefined,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("AI_TIMEOUT");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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

const TO_EDITOR_SYSTEM = `你是「小岛日记」的 Editor.js 排版技能（Notion 式：在光标处生成内容）。
根据用户指令（以及附件、当前正文摘要），产出可直接写入 Editor.js 的 blocks。

只输出一个 JSON 对象，不要 markdown 代码围栏，不要解释。格式：
{"blocks":[{"type":"header","data":{"text":"...","level":2}},{"type":"paragraph","data":{"text":"..."}}],"apply":"replace"|"append","note":"可选短说明"}

允许的 type 与 data：
- header: { text: string, level: 1|2|3 }
- paragraph: { text: string }  （可含简单 HTML：b/i/a/code；关键词用 <b>，术语可用 <code>；短代码片段写在 <code> 里）
- list: { style: "ordered"|"unordered", items: string[] }
- image: { file: { url: string }, caption?: string, withBorder?: false, stretched?: false, withBackground?: false }
- embed: { service: string, source: string, embed: string, width?: number, height?: number, caption?: string }

不要输出 type=code（会挂 textarea）。
不要输出 type=quote（编辑器引用块是双输入框）；金句请写成 paragraph，例如用 <b>…</b> 强调。
不要输出 type=delimiter（分隔线块）；小节之间直接用 header / 空一行语义的短 paragraph 衔接即可。
不要输出空 paragraph / 空 header，不要输出任何 input/textarea/select/button/form。

排版（重要，直接影响可读性）：
- 超过约 120 字时，优先拆成「小标题 + 短段落 + 列表」，避免连续 3 个以上纯 paragraph。
- 讲解概念、步骤、要点时用 list；有先后用 ordered，并列用 unordered。
- 适合强调的一句原则/提醒写成 paragraph，并用 <b>…</b>，不要用 quote/code/delimiter 块。
- 段落宜短：单段通常不超过 3 句；需要强调时在 paragraph 内用 <b>…</b>。
- 不要用 markdown（#、-、1.、**）；结构一律用上述 block type。
- 严禁输出任何表单控件：禁止 <input>、<textarea>、<select>、<button>、<form>，也不要模拟输入框样式的占位块；空段落不要输出。

规则：
1. 中文，自然个人博客语气。
2. 图片只能使用附件里给出的 url，禁止编造。
3. apply=append（默认，光标处插入）：只生成局部内容（续写、一段话、列表、小节等），不要整篇重写；除非用户明确要求写大标题，否则不要用 level 1 header 开头；可用 level 2/3。
4. apply=replace：整篇成稿时可用，第一块可用 level 1 标题，并合理使用 header/list。
5. 综合用户指令与正文上下文来写，不要只复述最后一句。
6. 若提供了可用图片 URL：正文里用 image 块插入这些图（file.url 必须完全等于给定 URL），并写简短 caption；不要编造其它图片地址。
7. 若提供了文本附件：吸收其内容再写成博客语气，不要大段原文粘贴。
8. blocks 不能为空；不要输出未列出的 type；不要输出空 paragraph / 空 header。`;

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
      const rawItems = Array.isArray(data.items) ? data.items : [];
      const items = rawItems
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }
          if (item && typeof item === "object" && "content" in item) {
            return String((item as { content: unknown }).content ?? "");
          }
          return "";
        })
        .filter(Boolean)
        .join(" / ");
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
  "image",
  "embed",
]);

/** 去掉 AI 可能塞进正文的表单控件标签 */
function scrubFormControls(html: string): string {
  return html
    .replace(/<\s*(input|textarea|select|option|button|form|label)(\s[^>]*)?>/gi, "")
    .replace(/<\s*\/\s*(input|textarea|select|option|button|form|label)\s*>/gi, "")
    .replace(/\b(contenteditable|data-placeholder)\s*=\s*(['"]).*?\2/gi, "")
    .trim();
}

function scrubRichText(value: unknown): string {
  return scrubFormControls(String(value ?? ""));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 代码块会挂载 textarea，AI 产物一律改成段落里的 <code> */
function codeToParagraph(code: string): EditorJsBlock | null {
  const raw = code.replace(/\r\n/g, "\n").trim();
  if (!raw) {
    return null;
  }
  const html = `<code>${escapeHtml(raw).replace(/\n/g, "<br>")}</code>`;
  return { type: "paragraph", data: { text: html } };
}

/** 转成 @editorjs/list v2 节点，避免 string[] 在编辑器里显示异常 */
function normalizeListItems(items: unknown): Array<{ content: string; meta: Record<string, unknown>; items: [] }> {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => {
      if (typeof item === "string") {
        const content = scrubRichText(item);
        return content ? { content, meta: {}, items: [] as [] } : null;
      }
      if (item && typeof item === "object" && "content" in item) {
        const content = scrubRichText((item as { content: unknown }).content);
        return content ? { content, meta: {}, items: [] as [] } : null;
      }
      return null;
    })
    .filter((item): item is { content: string; meta: Record<string, unknown>; items: [] } => Boolean(item));
}

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
    let type = String(raw.type ?? "");
    if (!ALLOWED_TYPES.has(type) && type !== "code" && type !== "quote") {
      continue;
    }
    const data =
      raw.data && typeof raw.data === "object" ? { ...(raw.data as Record<string, unknown>) } : {};

    // 禁止 AI 挂载带 textarea 的 code 工具
    if (type === "code") {
      const converted = codeToParagraph(String(data.code ?? ""));
      if (converted) {
        blocks.push(converted);
      }
      continue;
    }

    // 禁止 AI 挂载 Quote（双 cdx-input），改成强调段落
    if (type === "quote") {
      const text = scrubRichText(data.text);
      const caption = scrubRichText(data.caption);
      if (!text) {
        continue;
      }
      const body = caption
        ? `<b>${text}</b><br><i>${caption}</i>`
        : `<b>${text}</b>`;
      blocks.push({ type: "paragraph", data: { text: body } });
      continue;
    }

    // delimiter 直接丢弃（不插入 ce-delimiter）
    if (type === "delimiter") {
      continue;
    }

    if (type === "header") {
      const level = Number(data.level);
      data.level = level === 1 || level === 2 || level === 3 ? level : 2;
      data.text = scrubRichText(data.text);
      if (!data.text) {
        continue;
      }
    }
    if (type === "paragraph") {
      data.text = scrubRichText(data.text);
      if (!data.text) {
        continue;
      }
    }
    if (type === "list") {
      const style = data.style === "ordered" ? "ordered" : "unordered";
      const items = normalizeListItems(data.items);
      if (items.length === 0) {
        continue;
      }
      data.style = style;
      data.items = items;
    }
    if (type === "image") {
      const file = data.file as { url?: string } | undefined;
      const url = file?.url?.trim() ?? "";
      if (!url || !allowedImageUrls.has(url)) {
        continue;
      }
      data.file = { url };
      if (typeof data.caption === "string") {
        data.caption = scrubRichText(data.caption);
      }
    }
    if (type === "embed" && typeof data.caption === "string") {
      data.caption = scrubRichText(data.caption);
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
    "请根据以上对话整理成完整 Editor.js 文章 blocks；多用 header / list 做出层次，少用连续纯 paragraph；不要用 quote/code/delimiter。",
  ].join("\n\n");

  const skillUser: AiChatMessage = {
    role: "user",
    content:
      "请执行技能：把我们的对话整理成 Editor.js blocks 并填写到编辑器。注意用小标题、列表和短引用提升可读性，不要整篇都是段落。",
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

import type {
  AiAttachment,
  AiChatInput,
  AiChatMessage,
  AiChatResult,
  EditorJsDocument,
} from "@myblog/shared";
import { AgentsError, agentsChat } from "./agents-client.js";
import { getAccessToken } from "./request-context.js";

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

function normalizeAttachments(attachments: AiAttachment[] | undefined): AiAttachment[] {
  if (!attachments?.length) {
    return [];
  }
  const out: AiAttachment[] = [];
  for (const item of attachments.slice(0, 12)) {
    if (item.kind === "image") {
      const url = item.url?.trim();
      if (url) {
        out.push({ kind: "image", name: String(item.name || "图片").slice(0, 120), url });
      }
      continue;
    }
    if (item.kind === "text") {
      const text = String(item.text ?? "");
      if (text.trim()) {
        out.push({
          kind: "text",
          name: String(item.name || "附件").slice(0, 120),
          text: text.slice(0, 12000),
        });
      }
    }
  }
  return out;
}

/** Nest 不吃 document 字段：把正文摘要拼进最后一条 user */
function withDocumentContext(
  messages: AiChatMessage[],
  document: EditorJsDocument | undefined,
): AiChatMessage[] {
  if (!document) {
    return messages;
  }
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") {
    return messages;
  }
  const appendix = `当前 Editor.js 正文摘要：\n${summarizeDocument(document)}`;
  const content = `${last.content}\n\n——\n${appendix}`.slice(0, 8000);
  return [...messages.slice(0, -1), { ...last, content }];
}

/** 转发 Nest `POST /agents/chat`（sync:true） */
export async function runAiChat(
  input: AiChatInput,
  accessToken?: string,
): Promise<AiChatResult> {
  const token = accessToken || getAccessToken();
  if (!token) {
    throw new AgentsError("UNAUTHORIZED", 401);
  }

  const messages = withDocumentContext(normalizeMessages(input.messages), input.document);
  if (messages.length === 0 || messages[messages.length - 1]?.role !== "user") {
    throw new AgentsError("AI_EMPTY", 400);
  }

  return agentsChat(token, {
    messages,
    attachments: normalizeAttachments(input.attachments),
    sync: true,
  });
}

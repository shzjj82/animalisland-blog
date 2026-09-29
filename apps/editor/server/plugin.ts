import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { AiChatInput, AiToEditorInput } from "@myblog/shared";
import { apiFail, apiOk } from "@myblog/shared";
import { aiConfigured, env } from "./env.ts";
import { runAiChat, runAiToEditor } from "./ai.ts";

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 12_000_000) {
        reject(new Error("AI_BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("BAD_JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export async function handleAiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = (req.url ?? "").split("?")[0];
  if (url === "/api/ai/status" && req.method === "GET") {
    send(res, 200, apiOk({ enabled: aiConfigured(), model: aiConfigured() ? env.aiModel : null }));
    return true;
  }
  if (url !== "/api/ai/chat" && url !== "/api/ai/to-editor") {
    return false;
  }
  if (req.method !== "POST") {
    send(res, 405, apiFail("METHOD_NOT_ALLOWED"));
    return true;
  }
  if (!aiConfigured()) {
    send(res, 503, apiFail("AI_NOT_CONFIGURED"));
    return true;
  }
  try {
    const body = (await readJson(req)) as AiChatInput & AiToEditorInput;
    if (url === "/api/ai/chat") {
      const result = await runAiChat(body);
      send(res, 200, apiOk(result));
      return true;
    }
    const result = await runAiToEditor(body);
    send(res, 200, apiOk(result));
    return true;
  } catch (err) {
    const code = err instanceof Error ? err.message : "AI_FAILED";
    const status = code === "AI_NOT_CONFIGURED" ? 503 : code === "AI_TIMEOUT" ? 504 : 400;
    send(res, status, apiFail(code));
    return true;
  }
}

/** 编辑器自己的写作接口，不经过博客服务 */
export function editorAiPlugin(): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    void handleAiRequest(req, res)
      .then((done) => {
        if (!done) {
          next();
        }
      })
      .catch((err: unknown) => {
        const code = err instanceof Error ? err.message : "AI_FAILED";
        send(res, 400, apiFail(code));
      });
  };
  return {
    name: "editor-ai",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

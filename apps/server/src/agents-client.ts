/**
 * Nest 智能体：用户 JWT + X-Biz-Code / X-App-Code，不走 x-docs-key / AI_API_KEY。
 */
import { env, hasGatewayConfig } from "./env.js";
import { gatewayFetch, readGatewayJson, type GatewayEnvelope } from "./gateway-client.js";
import type { AiAttachment, AiChatMessage } from "@myblog/shared";

export class AgentsError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "AgentsError";
  }
}

export type AgentsChatStatus = {
  enabled: boolean;
  model?: string | null;
};

export type AgentsChatBody = {
  messages: AiChatMessage[];
  attachments?: AiAttachment[];
  system?: string;
  sync?: boolean;
};

function agentsHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "X-Biz-Code": env.agentsBizCode,
    "X-App-Code": env.agentsBizCode,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function mapAgentsFailure(status: number, json: GatewayEnvelope<unknown> | null): AgentsError {
  const message = String(json?.message ?? json?.code ?? "").trim();
  if (status === 401) {
    return new AgentsError("UNAUTHORIZED", 401);
  }
  if (status === 403) {
    return new AgentsError(message || "FORBIDDEN", 403);
  }
  if (message) {
    return new AgentsError(message, status || 502);
  }
  if (status === 504) {
    return new AgentsError("AI_TIMEOUT", 504);
  }
  if (status === 503) {
    return new AgentsError("AI_NOT_CONFIGURED", 503);
  }
  return new AgentsError("AI_FAILED", status || 502);
}

export function agentsAvailable(): boolean {
  return hasGatewayConfig() && Boolean(env.gatewayBaseUrl);
}

export async function agentsChatStatus(token: string): Promise<AgentsChatStatus> {
  if (!agentsAvailable()) {
    return { enabled: false, model: null };
  }
  let response: Response;
  try {
    response = await gatewayFetch("/agents/chat/status", {
      method: "GET",
      headers: agentsHeaders(token),
      timeoutMs: Math.min(env.docsTimeoutMs, 15_000),
    });
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String((err as { code: string }).code) : "";
    if (code === "GATEWAY_TIMEOUT") {
      throw new AgentsError("AI_TIMEOUT", 504);
    }
    throw new AgentsError("AI_FAILED", 502);
  }

  const json = await readGatewayJson<AgentsChatStatus>(response);
  if (!response.ok || !json?.success) {
    throw mapAgentsFailure(response.status, json);
  }
  const data = json.data ?? { enabled: false };
  return {
    enabled: Boolean(data.enabled),
    model: data.model ?? null,
  };
}

export async function agentsChat(
  token: string,
  body: AgentsChatBody,
): Promise<{ reply: string }> {
  if (!agentsAvailable()) {
    throw new AgentsError("AI_NOT_CONFIGURED", 503);
  }

  let response: Response;
  try {
    response = await gatewayFetch("/agents/chat", {
      method: "POST",
      headers: agentsHeaders(token),
      body: JSON.stringify({
        messages: body.messages,
        attachments: body.attachments,
        system: body.system,
        sync: body.sync !== false,
      }),
      timeoutMs: env.agentsTimeoutMs,
    });
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String((err as { code: string }).code) : "";
    if (code === "GATEWAY_TIMEOUT") {
      throw new AgentsError("AI_TIMEOUT", 504);
    }
    throw new AgentsError("AI_FAILED", 502);
  }

  const json = await readGatewayJson<{ reply?: string }>(response);
  if (!response.ok || !json?.success) {
    throw mapAgentsFailure(response.status, json);
  }
  const reply = String(json.data?.reply ?? "").trim();
  if (!reply) {
    throw new AgentsError("AI_EMPTY", 502);
  }
  return { reply: reply.slice(0, 12000) };
}

import { useMemo } from "react";
import { renderChatMarkdown } from "@/lib/chatMarkdown";
import { cn } from "@/lib/utils";

type Props = {
  content: string;
  className?: string;
  /** 用户消息可关掉复杂样式，仍识别基础 markdown */
  compact?: boolean;
};

export function ChatMarkdown({ content, className, compact }: Props) {
  const html = useMemo(() => renderChatMarkdown(content), [content]);
  return (
    <div
      className={cn("chat-md", compact && "chat-md--compact", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

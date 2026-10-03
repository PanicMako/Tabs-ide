import { memo } from "react";
import type { ThreadId } from "@tabs/contracts";
import { cn } from "~/lib/utils";

type ChatMessage = {
  id: string;
  text?: string;
};

export interface ChatMessageListProps {
  threadId: ThreadId;
  messages: ChatMessage[];
  className?: string;
  onScrollToBottom?: () => void;
  isNearBottom?: boolean;
  isLoading?: boolean;
  onMessageAction?: (messageId: string, action: string) => void;
}

export const ChatMessageList = memo(function ChatMessageList({
  threadId: _threadId,
  messages,
  className,
  onScrollToBottom: _onScrollToBottom,
  isNearBottom: _isNearBottom = true,
  isLoading = false,
  onMessageAction: _onMessageAction,
}: ChatMessageListProps) {
  if (isLoading) {
    return (
      <div className={cn("flex-1 overflow-y-auto flex items-center justify-center", className)}>
        <div className="text-muted-foreground">Loading messages...</div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className={cn("flex-1 overflow-y-auto flex items-center justify-center", className)}>
        <div className="text-center text-muted-foreground">
          <div className="mb-2">No messages yet</div>
          <div className="text-sm">Start a conversation to see messages here</div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex-1 overflow-y-auto", className)}>
      <div className="space-y-2 p-3">
        {messages.map((message) => (
          <div key={message.id} className="rounded-md border border-border/60 bg-card/30 px-3 py-2">
            {message.text ?? ""}
          </div>
        ))}
      </div>
    </div>
  );
});

ChatMessageList.displayName = "ChatMessageList";

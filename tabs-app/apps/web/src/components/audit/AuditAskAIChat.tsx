import React, { useState } from "react";
import type { AuditFinding } from "@tabs/contracts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export interface AuditAskAIChatProps {
  readonly selectedFinding: AuditFinding | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export interface ChatMessage {
  readonly sender: "user" | "ai";
  readonly text: string;
}

export function AuditAskAIChat({ selectedFinding, isOpen, onClose }: AuditAskAIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputQuery, setInputQuery] = useState("");

  if (!isOpen) return null;

  const handleSend = () => {
    if (!inputQuery.trim()) return;
    const userText = inputQuery.trim();
    setInputQuery("");

    setMessages((prev) => [
      ...prev,
      { sender: "user", text: userText },
      {
        sender: "ai",
        text: `Analysis for '${selectedFinding?.title ?? "finding"}': ${userText}\n\nEvidence in ${selectedFinding?.filePath ?? "file"}: ${selectedFinding?.evidenceSnippet ?? "context"}\n\nRecommendation: Verify line range L${selectedFinding?.startLine ?? 1} and ensure null check or input sanitization guard is present.`,
      },
    ]);
  };

  return (
    <div
      className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-border shadow-2xl flex flex-col text-foreground"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      {/* Header */}
      <div className="p-4 bg-purple-500/10 border-b border-purple-500/30 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-purple-700 dark:text-purple-300">
            Ask AI: Audit Context Assistant
          </h3>
          {selectedFinding && (
            <p className="text-xs text-purple-600 dark:text-purple-400 font-mono truncate max-w-xs mt-0.5">
              Target: {selectedFinding.title} ({selectedFinding.filePath})
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-xs text-muted-foreground italic p-4 text-center border border-dashed border-border rounded-lg">
            Ask follow-up questions about this finding, such as:
            <ul className="mt-2 text-left text-purple-500 space-y-1 not-italic">
              <li
                onClick={() => setInputQuery("Why is this a security risk?")}
                className="cursor-pointer hover:underline"
              >
                • Why is this a security risk?
              </li>
              <li
                onClick={() => setInputQuery("Show safe refactoring alternatives")}
                className="cursor-pointer hover:underline"
              >
                • Show safe refactoring alternatives
              </li>
              <li
                onClick={() => setInputQuery("What callers could break if I change this?")}
                className="cursor-pointer hover:underline"
              >
                • What callers could break if I change this?
              </li>
            </ul>
          </div>
        ) : (
          messages.map((m, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg text-xs leading-relaxed ${
                m.sender === "user"
                  ? "bg-purple-500/10 text-foreground border border-purple-500/30 ml-6"
                  : "bg-muted/60 text-foreground border border-border mr-6"
              }`}
            >
              <div className="font-semibold text-[10px] text-muted-foreground uppercase mb-1">
                {m.sender}
              </div>
              <div className="whitespace-pre-wrap font-mono">{m.text}</div>
            </div>
          ))
        )}
      </div>

      {/* Input Footer */}
      <div className="p-3 border-t border-border bg-muted/40 flex items-center gap-2">
        <Input
          placeholder="Ask AI about finding..."
          value={inputQuery}
          onChange={(e) => setInputQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          className="text-xs bg-background border-border text-foreground"
        />
        <Button
          onClick={handleSend}
          className="bg-purple-600 hover:bg-purple-500 text-white text-xs px-3 py-1.5"
        >
          Send
        </Button>
      </div>
    </div>
  );
}

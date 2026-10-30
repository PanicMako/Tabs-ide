import { useRef, type ReactNode } from "react";
import { useScrollRail } from "./useScrollRail";
import "./user-message.css";

/** Metadata never determines the width of a short prompt. */
export function UserMessageLayout({
  actions,
  scrollContainer = null,
  attachments,
  children,
}: {
  actions: ReactNode;
  scrollContainer?: HTMLDivElement | null;
  attachments?: ReactNode;
  children?: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const beam = useRef<HTMLDivElement>(null);
  useScrollRail(content, beam, scrollContainer);
  return (
    <div className="user-message-row">
      <div className="user-message-frame group">
        <div className="user-message-actions">{actions}</div>
        {attachments}
        {children && (
          <div ref={content} className="user-message-content" dir="auto">
            <div ref={beam} className="user-message-rail-beam" aria-hidden="true" />
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

/** Paragraph layout is display-only: the message and copy action retain their source text. */
export function UserPromptText({ text }: { text: string }) {
  const paragraphs = text
    .replace(/^(?:[\t ]*\r?\n)+|(?:\r?\n[\t ]*)+$/g, "")
    .split(/\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/);
  return (
    <div className="user-prompt-prose">
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

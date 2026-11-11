import { MessagesSquareIcon, SquareTerminalIcon } from "lucide-react";
import type { ThreadSurface } from "~/stores/threadSurfaceStore";
import "./threadSurface.css";

/**
 * Chat / CLI switch for a thread's conversation area. A two-option radio group
 * so arrow keys move between the surfaces like other segmented choices.
 */
export function ThreadSurfaceSwitch({
  surface,
  onChange,
  attention = false,
  shortcutLabel,
}: {
  surface: ThreadSurface;
  onChange: (surface: ThreadSurface) => void;
  /** An agent CLI session in this thread is waiting while Chat is shown. */
  attention?: boolean;
  shortcutLabel?: string | null | undefined;
}) {
  const shortcut = shortcutLabel ? ` (${shortcutLabel})` : "";
  const options = [
    {
      value: "chat",
      label: "Chat",
      title: `Chat UI${shortcut}`,
      Icon: MessagesSquareIcon,
    },
    {
      value: "cli",
      label: "CLI",
      title: attention
        ? "An agent CLI session is waiting for you"
        : `Run the agent's own CLI in a terminal${shortcut}`,
      Icon: SquareTerminalIcon,
    },
  ] as const;
  return (
    <div
      role="radiogroup"
      aria-label="Conversation surface"
      className="thread-surface-switch [-webkit-app-region:no-drag]"
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const next = surface === "chat" ? "cli" : "chat";
        onChange(next);
        const group = event.currentTarget;
        requestAnimationFrame(() =>
          group
            .querySelector<HTMLButtonElement>(`[data-surface="${next}"]`)
            ?.focus({ preventScroll: true }),
        );
      }}
    >
      {options.map(({ value, label, title, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          data-surface={value}
          aria-checked={surface === value}
          aria-label={label}
          tabIndex={surface === value ? 0 : -1}
          title={title}
          data-attention={(value === "cli" && attention && surface !== "cli") || undefined}
          onClick={() => onChange(value)}
        >
          <Icon aria-hidden="true" className="size-3.5" />
          <span className="thread-surface-label">{label}</span>
        </button>
      ))}
    </div>
  );
}

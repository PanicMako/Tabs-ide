import { useEffect, useState } from "react";
import { MercuryChromeLoader } from "../MercuryChromeLoader";

export interface GitCheckingStateProps {
  message?: string;
  size?: number;
  inline?: boolean;
  className?: string;
  rotateMessages?: boolean;
  /**
   * Stay hidden this long before appearing. Most Git reads finish well inside it, so the panel
   * goes straight to its content instead of flashing a spinner; slow ones still show it.
   */
  revealDelayMs?: number;
}

export const GIT_LOADER_REVEAL_DELAY_MS = 300;

const ROTATING_MESSAGES = [
  "Asking GitHub nicely if we can push…",
  "Reticulating Git splines…",
  "Checking for untamed merge conflicts…",
  "Consulting the git log oracle…",
  "Counting commits on detached HEADs…",
  "Bribing the remote server…",
  "Searching for missing push permissions…",
  "Warming up the git engines…",
  "Untangling branch trees…",
  "Double-checking repository access…",
  "Verifying viewer permissions…",
  "Fetching workflow statuses from the cloud…",
  "Aligning local OIDs with remote HEAD…",
  "Pinging origin server…",
];

export function GitCheckingState({
  message,
  size = 32,
  inline = false,
  className,
  rotateMessages = false,
  revealDelayMs = GIT_LOADER_REVEAL_DELAY_MS,
}: GitCheckingStateProps) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(revealDelayMs <= 0);

  useEffect(() => {
    if (revealDelayMs <= 0) return;
    const timer = window.setTimeout(() => setRevealed(true), revealDelayMs);
    return () => window.clearTimeout(timer);
  }, [revealDelayMs]);
  const revealClass = `transition-opacity duration-200 ${revealed ? "opacity-100" : "opacity-0"}`;

  useEffect(() => {
    if (!rotateMessages) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % ROTATING_MESSAGES.length);
    }, 1800);
    return () => clearInterval(timer);
  }, [rotateMessages]);

  const displayMessage = rotateMessages ? ROTATING_MESSAGES[index] : (message ?? "");

  if (inline) {
    return (
      <div
        aria-hidden={revealed ? undefined : true}
        className={`flex items-center gap-2.5 text-xs text-muted-foreground/70 ${revealClass} ${className ?? ""}`}
      >
        <MercuryChromeLoader size={size} color="var(--primary)" />
        <span className="transition-all duration-300">{displayMessage}</span>
      </div>
    );
  }

  return (
    <div
      aria-hidden={revealed ? undefined : true}
      className={`flex flex-col items-center justify-center p-8 gap-4 text-center ${revealClass} ${className ?? ""}`}
    >
      <MercuryChromeLoader size={size} color="var(--primary)" />
      <span className="text-xs text-muted-foreground/70 font-medium transition-all duration-300 min-h-[20px] flex items-center justify-center">
        {displayMessage}
      </span>
    </div>
  );
}

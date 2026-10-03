import { useEffect, useState } from "react";
import { MercuryChromeLoader } from "../MercuryChromeLoader";

export interface GitCheckingStateProps {
  message?: string;
  size?: number;
  inline?: boolean;
  className?: string;
  rotateMessages?: boolean;
}

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
}: GitCheckingStateProps) {
  const [index, setIndex] = useState(0);

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
        className={`flex items-center gap-2.5 text-xs text-muted-foreground/70 ${className ?? ""}`}
      >
        <MercuryChromeLoader size={size} color="var(--primary)" />
        <span className="transition-all duration-300">{displayMessage}</span>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center justify-center p-8 gap-4 text-center ${className ?? ""}`}
    >
      <MercuryChromeLoader size={size} color="var(--primary)" />
      <span className="text-xs text-muted-foreground/70 font-medium transition-all duration-300 min-h-[20px] flex items-center justify-center">
        {displayMessage}
      </span>
    </div>
  );
}

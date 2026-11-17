import type { EnvironmentSpeechFoundModel, EnvironmentSpeechModel } from "@tabs/contracts";
import { CheckIcon, HardDriveIcon } from "lucide-react";

import { Button } from "../ui/button";
import "./voice-settings.css";
import { formatModelBytes } from "./speechModelPicker.logic";

/**
 * Speech models other dictation apps (TypeWhisper, WhisperKit, MacWhisper)
 * already keep on this Mac. Tabs runs GGUF models, so a copy in another format
 * cannot be loaded as it is; each row says so plainly and offers the Tabs model
 * with the same weights in one click.
 */
export function FoundOnThisMac(props: {
  readonly found: ReadonlyArray<EnvironmentSpeechFoundModel>;
  readonly models: ReadonlyArray<EnvironmentSpeechModel>;
  readonly busyModelId: string | null;
  readonly onAction: (modelId: string, action: "download" | "select") => void;
}) {
  if (props.found.length === 0) return null;
  return (
    <div className="found-on-mac" data-slot="found-on-this-mac">
      <div className="found-on-mac-header">
        <HardDriveIcon className="size-3.5" aria-hidden="true" />
        <span>Found on this Mac</span>
      </div>
      <ul className="found-on-mac-list">
        {props.found.map((entry) => {
          const match = props.models.find((model) => model.id === entry.matchModelId);
          const busy = match !== undefined && props.busyModelId === match.id;
          return (
            <li key={`${entry.app}:${entry.path}`} className="found-on-mac-row">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground">{entry.name}</p>
                <p className="truncate text-[11px] text-muted-foreground" title={entry.path}>
                  From {entry.app} · {entry.format}
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                  {entry.usableAsIs
                    ? "Tabs can use this copy directly."
                    : match
                      ? `Tabs runs GGUF models, so it can't load this ${entry.format} copy. The same model is ${formatModelBytes(match.size)} to get.`
                      : `Tabs runs GGUF models, so it can't load this ${entry.format} copy.`}
                </p>
              </div>
              {match ? (
                match.active ? (
                  <span className="found-on-mac-state">
                    <CheckIcon className="size-3" aria-hidden="true" /> In use
                  </span>
                ) : match.state === "installed" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => props.onAction(match.id, "select")}
                  >
                    Use
                  </Button>
                ) : match.state === "downloading" || match.state === "verifying" ? (
                  <span className="found-on-mac-state">Getting it…</span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => props.onAction(match.id, "download")}
                  >
                    Get {match.name}
                  </Button>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

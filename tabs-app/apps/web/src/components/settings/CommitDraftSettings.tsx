import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { DebouncedSettingsInput } from "./DebouncedSettingsInput";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

export function CommitDraftSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  return (
    <SettingsSection title="Local Git generation">
      <SettingsRow
        title="Git writing model"
        description="Runs through Ollama on this computer. The default qwen3:1.7b model is about 1.4 GB and needs no API key. Commit messages, pull request drafts and diff summaries run locally without OpenRouter."
        control={
          <DebouncedSettingsInput
            aria-label="Local Git generation model"
            value={settings.commitDraftLocalModel}
            onPersist={(commitDraftLocalModel) =>
              updateSettings({
                commitDraftLocalModel: commitDraftLocalModel.trim() || "qwen3:1.7b",
              })
            }
            placeholder="qwen3:1.7b"
            spellCheck={false}
          />
        }
      >
        <p
          className="mt-2.5 text-xs text-muted-foreground/80 leading-relaxed font-normal"
          style={{
            fontFamily: "var(--font-supporting, var(--font-sans))",
            fontWeight: "var(--font-supporting-weight, 400)" as React.CSSProperties["fontWeight"],
          }}
        >
          Start Ollama, then download the model once with{" "}
          <code className="font-mono text-[11px] bg-muted/60 px-1 py-0.5 rounded border border-border/40">
            ollama pull qwen3:1.7b
          </code>
          . These preferences apply across your workspaces. Generation never stages or commits
          files.
        </p>
      </SettingsRow>
    </SettingsSection>
  );
}
